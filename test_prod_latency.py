#!/usr/bin/env python3
"""生产/预发接口测速 | Benchmark auth and read-model endpoints."""
from __future__ import annotations

import argparse
import gzip
import http.cookiejar
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEFAULT_BASELINE = ROOT / "docs/ops/performance-baseline.json"
_COOKIE_JAR = http.cookiejar.CookieJar()
_URL_OPENER = urllib.request.build_opener(
    urllib.request.HTTPCookieProcessor(_COOKIE_JAR),
)


def percentile(values: list[int], pct: float) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    rank = (pct / 100) * (len(ordered) - 1)
    lower = int(rank)
    upper = min(lower + 1, len(ordered) - 1)
    weight = rank - lower
    return int(round(ordered[lower] * (1 - weight) + ordered[upper] * weight))


def summarize_samples(samples: list[int]) -> dict:
    return {
        "samples": samples,
        "p50_ms": percentile(samples, 50),
        "p95_ms": percentile(samples, 95),
        "max_ms": max(samples),
    }


def decode_response_body(raw: bytes, headers: dict) -> str:
    encoding = (headers.get("Content-Encoding") or headers.get("content-encoding") or "").lower()
    if encoding == "gzip":
        raw = gzip.decompress(raw)
    return raw.decode("utf-8")


def request_json(url, method="GET", headers=None, body=None, timeout=120):
    data = None
    req_headers = {
        "Accept": "application/json",
        "Accept-Encoding": "gzip, identity",
        "User-Agent": "KetangLatencyProbe/1.0",
    }
    if headers:
        req_headers.update(headers)
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        req_headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=req_headers, method=method)
    started = time.perf_counter()
    try:
        with _URL_OPENER.open(req, timeout=timeout) as resp:
            chunks: list[bytes] = []
            while True:
                chunk = resp.read(65536)
                if not chunk:
                    break
                chunks.append(chunk)
            raw = b"".join(chunks)
            elapsed_ms = int((time.perf_counter() - started) * 1000)
            hdrs = dict(resp.headers)
            text = decode_response_body(raw, hdrs)
            payload = json.loads(text or "{}") if text else {}
            return resp.status, payload, elapsed_ms, hdrs
    except urllib.error.HTTPError as exc:
        chunks: list[bytes] = []
        while True:
            chunk = exc.read(65536)
            if not chunk:
                break
            chunks.append(chunk)
        raw = b"".join(chunks)
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        hdrs = dict(exc.headers)
        try:
            text = decode_response_body(raw, hdrs)
            payload = json.loads(text or "{}") if text else {}
        except (json.JSONDecodeError, UnicodeDecodeError):
            payload = {"error": raw[:200].decode("utf-8", errors="replace")}
        return exc.code, payload, elapsed_ms, hdrs


def ttfb_ms(url, timeout=60):
    started = time.perf_counter()
    req = urllib.request.Request(
        url,
        method="GET",
        headers={
            "User-Agent": "KetangLatencyProbe/1.0",
            "Accept-Encoding": "gzip, identity",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        resp.read(256)
        return int((time.perf_counter() - started) * 1000)


def load_baseline(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    if "thresholds_ms" not in data:
        raise ValueError("baseline missing thresholds_ms")
    return data


PHASE_G_METRIC_MAP = {
    "delta_sync_p95_ms": "sync_delta_ms",
    "read_module_p95_ms": "read_lodgers_records_ms",
    "reports_history_query_p95_ms": "read_events_ms",
}


def parse_timing_header(headers: dict) -> dict | None:
    raw = headers.get("X-Ketang-Timing") or headers.get("x-ketang-timing")
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def attach_server_timing(metric: dict, timing: dict | None) -> None:
    if not isinstance(metric, dict) or not isinstance(timing, dict):
        return
    total = timing.get("total_ms")
    if total is not None:
        metric["server_total_ms"] = int(total)
    metric["server_timing"] = timing


def phase_g_actual_ms(key: str, results: dict) -> int | None:
    if key == "login_to_ready_p95_ms":
        # 代理口径：max(登录, 首屏 board 读)；非浏览器 login-ready mark
        parts = []
        for src in ("login_role_ms", "read_board_ms"):
            metric = results.get(src)
            if isinstance(metric, dict):
                parts.append(metric.get("p95_ms", metric.get("max_ms", 0)))
        return max(parts) if parts else None
    if key == "write_refresh_p95_ms":
        metric = results.get("frontend_write_refresh_ms")
        if isinstance(metric, dict):
            return metric.get("p95_ms", metric.get("max_ms"))
        return None
    src = PHASE_G_METRIC_MAP.get(key)
    if not src:
        return None
    metric = results.get(src)
    if not isinstance(metric, dict):
        return None
    return metric.get("p95_ms", metric.get("max_ms"))


def check_phase_g(results: dict, baseline: dict) -> list[str]:
    targets = baseline.get("phase_g_targets_ms", {})
    failures: list[str] = []
    for key, limit in targets.items():
        if key == "extra_module_fetch_after_write_max":
            continue
        if key == "d1_error_rate_max_pct":
            continue
        if not str(key).endswith("_ms"):
            continue
        actual = phase_g_actual_ms(key, results)
        if actual is None:
            if key == "write_refresh_p95_ms":
                failures.append(
                    "write_refresh_p95_ms not collected (needs --probe-frontend with Chrome/CDP)"
                )
                continue
            failures.append(f"missing phase G metric {key}")
            continue
        if actual > limit:
            failures.append(f"{key} p95={actual}ms exceeds {limit}ms")
    return failures


def check_baseline(results: dict, baseline: dict) -> list[str]:
    thresholds = baseline.get("thresholds_ms", {})
    failures: list[str] = []
    for key, limit in thresholds.items():
        metric = results.get(key)
        if not isinstance(metric, dict):
            failures.append(f"missing metric {key}")
            continue
        actual = metric.get("p95_ms", metric.get("max_ms", 0))
        if actual > limit:
            failures.append(f"{key} p95={actual}ms exceeds {limit}ms")
    return failures


def probe_frontend_write_refresh() -> dict | None:
    """CDP: login + rcRefreshAfterWrite → ketang:write-refresh measure (local dev + cloud API)."""
    if os.environ.get("KETANG_SKIP_ONLINE_E2E") == "1":
        return {"_skip": "KETANG_SKIP_ONLINE_E2E=1"}
    try:
        import subprocess
        import time

        import websocket

        from test_cdp import CDP_PORT, PORT, cdp_ws_url, evaluate, recv_by_id, start_server, wait_for_cdp
        from test_file_protocol import chrome_binary
    except ImportError as exc:
        return {"_skip": f"import:{exc}"}

    chrome = chrome_binary()
    if not chrome:
        return {"_skip": "chrome_not_found"}

    server = start_server()
    proc = subprocess.Popen(
        [
            chrome,
            f"--remote-debugging-port={CDP_PORT}",
            "--remote-allow-origins=*",
            "--headless=new",
            "--disable-gpu",
            "--no-sandbox",
            "--disable-dev-shm-usage",
            f"http://127.0.0.1:{PORT}/index.html",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        if not wait_for_cdp():
            return {"_skip": "cdp_not_ready"}
        ws_url = cdp_ws_url()
        if not ws_url:
            return {"_skip": "cdp_no_page"}
        ws = websocket.create_connection(ws_url, timeout=30)
        ws.send(json.dumps({"id": 1, "method": "Runtime.enable"}))
        ws.recv()
        for _ in range(40):
            if evaluate(ws, "window.ketangReady").get("value"):
                break
            time.sleep(0.5)
        else:
            return {"_skip": "app_init_timeout"}

        online = evaluate(
            ws,
            """({
              isRemoteDB: typeof isRemoteDB === 'function' && isRemoteDB(),
              useRemoteWriteApi: typeof useRemoteWriteApi === 'function' && useRemoteWriteApi(),
              forceLocal: typeof isLocalForceDb === 'function' && isLocalForceDb(),
            })""",
        ).get("value", {})
        if not online.get("isRemoteDB"):
            return {"_skip": "not_remote_db", "detail": online}

        expr = """
        (async () => {
          performance.clearMarks();
          performance.clearMeasures();
          document.getElementById('login-username').value = 'admin';
          document.getElementById('login-password').value = 'admin';
          await submitLogin();
          for (let i = 0; i < 80; i++) {
            if (typeof isLoggedIn === 'function' && isLoggedIn()) break;
            await new Promise(r => setTimeout(r, 250));
          }
          if (!(typeof isLoggedIn === 'function' && isLoggedIn())) {
            return { error: 'login failed' };
          }
          if (typeof rcRefreshAfterWrite !== 'function') {
            return { error: 'rcRefreshAfterWrite missing' };
          }
          performance.clearMarks();
          performance.clearMeasures();
          const task = rcRefreshAfterWrite(
            { patches: {}, deletions: [] },
            { scope: 'board', skipViewRefresh: false },
          );
          if (task && typeof task.then === 'function') await task;
          await new Promise(r => setTimeout(r, 1000));
          const entries = performance.getEntriesByType('measure')
            .filter(e => e.name === 'ketang:write-refresh');
          const loginReady = performance.getEntriesByType('measure')
            .filter(e => e.name === 'ketang:login-ready');
          return {
            writeRefreshMs: entries.length
              ? Math.round(entries[entries.length - 1].duration)
              : null,
            loginReadyMs: loginReady.length
              ? Math.round(loginReady[loginReady.length - 1].duration)
              : null,
            hasWriteRefresh: entries.length > 0,
            marks: performance.getEntriesByType('mark').map(m => m.name),
          };
        })().catch(e => ({ error: e.message || String(e) }))
        """
        ws.send(
            json.dumps(
                {
                    "id": 2,
                    "method": "Runtime.evaluate",
                    "params": {
                        "expression": expr,
                        "awaitPromise": True,
                        "returnByValue": True,
                    },
                }
            )
        )
        result = (
            recv_by_id(ws, 2, 240)
            .get("result", {})
            .get("result", {})
            .get("value", {})
        )
        ws.close()
        if result.get("error"):
            return {"_skip": result["error"], "detail": result}
        if not result.get("hasWriteRefresh"):
            return {"_skip": "write_refresh_mark_missing", "detail": result}
        ms = result.get("writeRefreshMs")
        if ms is None:
            return {"_skip": "write_refresh_ms_null", "detail": result}
        return {
            "samples": [ms],
            "p50_ms": ms,
            "p95_ms": ms,
            "max_ms": ms,
            "login_ready_ms": result.get("loginReadyMs"),
            "source": "cdp_rcRefreshAfterWrite",
        }
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()
        server.terminate()
        try:
            server.wait(timeout=3)
        except subprocess.TimeoutExpired:
            server.kill()


def main() -> int:
    parser = argparse.ArgumentParser(description="Ketang production latency probe")
    parser.add_argument(
        "--base",
        default="https://wulingkt.net",
        help="Site base URL (use Pages preview if main domain has Access)",
    )
    parser.add_argument("--role", default="admin", help="Login role")
    parser.add_argument("--password", default="admin", help="Login password")
    parser.add_argument("--samples", type=int, default=3, help="Repeat count for P50/P95")
    parser.add_argument(
        "--check-baseline",
        nargs="?",
        const=str(DEFAULT_BASELINE),
        help="Fail when P95 exceeds docs/ops/performance-baseline.json",
    )
    parser.add_argument(
        "--check-phase-g",
        action="store_true",
        help="Fail when P95 exceeds phase_g_targets_ms in baseline",
    )
    parser.add_argument(
        "--probe-frontend",
        action="store_true",
        help="CDP probe for ketang:write-refresh (requires Chrome; skipped if unavailable)",
    )
    parser.add_argument(
        "--write-report",
        help="Optional path to write JSON report",
    )
    args = parser.parse_args()
    base = args.base.rstrip("/")
    timing_q = "?timing=1"
    sample_n = max(1, args.samples)
    probe_frontend = args.probe_frontend or args.check_phase_g

    print(f"Target: {base} (samples={sample_n})")
    results: dict = {}

    try:
        ttfb_ms(f"{base}/index.html")  # warm-up | 忽略冷启动首包
        index_samples = [ttfb_ms(f"{base}/index.html") for _ in range(sample_n)]
        results["index_ttfb_ms"] = summarize_samples(index_samples)
    except Exception as exc:
        print(f"FAIL index TTFB: {exc}")
        return 1

    login_samples: list[int] = []
    login_timing = None
    for _ in range(sample_n):
        status, body, ms, _ = request_json(
            f"{base}/api/db{timing_q}",
            method="POST",
            body={"action": "login_role", "role": args.role, "password": args.password},
        )
        login_samples.append(ms)
        if status != 200 or not body.get("user"):
            print(f"FAIL login_role status={status} body={body}")
            return 1
        login_timing = body.get("_timing")
    results["login_role_ms"] = summarize_samples(login_samples)
    results["login_role_timing"] = login_timing
    attach_server_timing(results["login_role_ms"], login_timing)

    session_samples: list[int] = []
    for _ in range(sample_n):
        status, body, ms, _ = request_json(
            f"{base}/api/v1/session{timing_q}",
        )
        session_samples.append(ms)
        if status != 200:
            print(f"FAIL session status={status} body={body}")
            return 1
    results["session_ms"] = summarize_samples(session_samples)
    results["session_timing"] = body.get("_timing")
    attach_server_timing(results["session_ms"], body.get("_timing"))

    read_samples: list[int] = []
    etag = None
    for _ in range(sample_n):
        status, body, ms, headers = request_json(
            f"{base}/api/v1/read-model{timing_q}",
        )
        read_samples.append(ms)
        if status != 200:
            print(f"FAIL read-model status={status} body={body}")
            return 1
        etag = headers.get("ETag") or headers.get("etag") or body.get("version")
    results["read_model_ms"] = summarize_samples(read_samples)
    results["read_model_timing"] = body.get("_timing")
    attach_server_timing(results["read_model_ms"], body.get("_timing"))

    if etag is not None:
        etag_text = str(etag)
        samples_304: list[int] = []
        timing_304 = None
        for _ in range(sample_n):
            status, _, ms, headers = request_json(
                f"{base}/api/v1/read-model{timing_q}",
                headers={"If-None-Match": etag_text},
            )
            samples_304.append(ms)
            if status != 304:
                print(f"FAIL read-model 304 expected, got {status}")
                return 1
            timing_304 = parse_timing_header(headers) or timing_304
        results["read_model_304_ms"] = summarize_samples(samples_304)
        results["read_model_304_timing"] = timing_304
        attach_server_timing(results["read_model_304_ms"], timing_304)
    else:
        print("WARN read-model missing ETag; skipped 304 probe")

    board_samples: list[int] = []
    for _ in range(sample_n):
        status, body, ms, _ = request_json(
            f"{base}/api/v1/board-version",
        )
        board_samples.append(ms)
        if status != 200:
            print(f"FAIL board-version status={status} body={body}")
            return 1
    results["board_version_ms"] = summarize_samples(board_samples)

    module_samples: list[int] = []
    for _ in range(sample_n):
        status, body, ms, _ = request_json(
            f"{base}/api/v1/read/lodgers_records{timing_q}",
        )
        module_samples.append(ms)
        if status != 200 or not body.get("tables"):
            print(f"FAIL read/lodgers_records status={status} body={body}")
            return 1
    results["read_lodgers_records_ms"] = summarize_samples(module_samples)
    results["read_lodgers_records_timing"] = body.get("_timing")
    attach_server_timing(results["read_lodgers_records_ms"], body.get("_timing"))

    board_mod_samples: list[int] = []
    for _ in range(sample_n):
        status, body, ms, _ = request_json(
            f"{base}/api/v1/read/board{timing_q}",
        )
        board_mod_samples.append(ms)
        if status != 200 or not body.get("tables"):
            print(f"FAIL read/board status={status} body={body}")
            return 1
    results["read_board_ms"] = summarize_samples(board_mod_samples)
    results["read_board_timing"] = body.get("_timing")
    attach_server_timing(results["read_board_ms"], body.get("_timing"))

    events_mod_samples: list[int] = []
    for _ in range(sample_n):
        status, body, ms, _ = request_json(
            f"{base}/api/v1/read/events{timing_q}",
        )
        events_mod_samples.append(ms)
        if status != 200 or not body.get("tables"):
            print(f"FAIL read/events status={status} body={body}")
            return 1
    results["read_events_ms"] = summarize_samples(events_mod_samples)
    results["read_events_timing"] = body.get("_timing")
    attach_server_timing(results["read_events_ms"], body.get("_timing"))

    delta_samples: list[int] = []
    version = body.get("board_version")
    delta_timing = None
    for _ in range(sample_n):
        status, payload, ms, headers = request_json(
            f"{base}/api/v1/sync/delta{timing_q}",
            headers={"If-None-Match": str(version or 0)},
        )
        delta_samples.append(ms)
        if status not in (200, 304):
            print(f"FAIL sync/delta status={status} body={payload}")
            return 1
        if status == 200:
            delta_timing = payload.get("_timing") or delta_timing
        else:
            delta_timing = parse_timing_header(headers) or delta_timing
    results["sync_delta_ms"] = summarize_samples(delta_samples)
    results["sync_delta_timing"] = delta_timing
    attach_server_timing(results["sync_delta_ms"], delta_timing)

    if probe_frontend:
        frontend = probe_frontend_write_refresh()
        if frontend and frontend.get("_skip"):
            results["frontend_probe_skip"] = frontend
            print(f"WARN frontend probe skipped: {frontend.get('_skip')}")
        elif frontend:
            results["frontend_write_refresh_ms"] = frontend
            if frontend.get("login_ready_ms") is not None:
                results["frontend_login_ready_ms"] = {
                    "samples": [frontend["login_ready_ms"]],
                    "p50_ms": frontend["login_ready_ms"],
                    "p95_ms": frontend["login_ready_ms"],
                    "max_ms": frontend["login_ready_ms"],
                    "source": "cdp_ketang:login-ready",
                }
        else:
            print("WARN frontend probe skipped (unknown)")

    print(json.dumps(results, ensure_ascii=False, indent=2))

    if args.write_report:
        report_path = Path(args.write_report)
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(
            json.dumps(
                {
                    "base": base,
                    "samples": sample_n,
                    "results": results,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        print(f"Report written: {report_path}")

    if args.check_baseline:
        baseline_path = Path(args.check_baseline)
        baseline = load_baseline(baseline_path)
        failures = check_baseline(results, baseline)
        if failures:
            print("FAIL baseline thresholds:")
            for item in failures:
                print(f"  - {item}")
            return 1
        print(f"OK within baseline ({baseline_path.name})")

    if args.check_phase_g:
        baseline_path = Path(args.check_baseline or DEFAULT_BASELINE)
        baseline = load_baseline(baseline_path)
        pg_failures = check_phase_g(results, baseline)
        if pg_failures:
            print("FAIL phase G targets:")
            for item in pg_failures:
                print(f"  - {item}")
            return 1
        print("OK within phase G targets")

    print("OK production latency probe")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
