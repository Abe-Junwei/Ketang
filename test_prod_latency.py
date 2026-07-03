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
from typing import Any, Callable

ROOT = Path(__file__).resolve().parent
DEFAULT_BASELINE = ROOT / "docs/ops/performance-baseline.json"
DEFAULT_SAMPLES = 9
DEFAULT_WARMUP = 2
OUTLIER_RETRY_MS = 12000
OUTLIER_P50_FACTOR = 2.5
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
        "p75_ms": percentile(samples, 75),
        "p95_ms": percentile(samples, 95),
        "max_ms": max(samples),
    }


def decode_response_body(raw: bytes, headers: dict) -> tuple[str, bytes]:
    encoding = (headers.get("Content-Encoding") or headers.get("content-encoding") or "").lower()
    wire = raw
    if encoding == "gzip":
        raw = gzip.decompress(raw)
    return raw.decode("utf-8"), wire


def response_meta(headers: dict, wire_bytes: bytes, decoded_bytes: bytes) -> dict:
    encoding = headers.get("Content-Encoding") or headers.get("content-encoding") or "identity"
    cf_ray = headers.get("CF-RAY") or headers.get("cf-ray")
    colo = cf_ray.split("-")[-1] if cf_ray and "-" in cf_ray else None
    meta = {
        "content_encoding": encoding.lower(),
        "bytes": len(wire_bytes),
        "decoded_bytes": len(decoded_bytes),
    }
    if cf_ray:
        meta["cf_ray"] = cf_ray
    if colo:
        meta["cf_colo"] = colo
    server_timing = headers.get("Server-Timing") or headers.get("server-timing")
    if server_timing:
        meta["server_timing_header"] = server_timing
    request_id = headers.get("X-Ketang-Request-Id") or headers.get("x-ketang-request-id")
    if request_id:
        meta["request_id"] = request_id
    return meta


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
            wire = b"".join(chunks)
            elapsed_ms = int((time.perf_counter() - started) * 1000)
            hdrs = dict(resp.headers)
            text, _wire = decode_response_body(wire, hdrs)
            decoded = text.encode("utf-8")
            payload = json.loads(text or "{}") if text else {}
            meta = response_meta(hdrs, wire, decoded)
            return resp.status, payload, elapsed_ms, hdrs, meta
    except urllib.error.HTTPError as exc:
        chunks: list[bytes] = []
        while True:
            chunk = exc.read(65536)
            if not chunk:
                break
            chunks.append(chunk)
        wire = b"".join(chunks)
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        hdrs = dict(exc.headers)
        try:
            text, _wire = decode_response_body(wire, hdrs)
            decoded = text.encode("utf-8")
            payload = json.loads(text or "{}") if text else {}
        except (json.JSONDecodeError, UnicodeDecodeError):
            payload = {"error": wire[:200].decode("utf-8", errors="replace")}
            decoded = wire[:200]
        meta = response_meta(hdrs, wire, decoded if isinstance(decoded, bytes) else decoded)
        return exc.code, payload, elapsed_ms, hdrs, meta


def ttfb_ms(url, timeout=60) -> tuple[int, dict]:
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
        wire = resp.read(256)
        ms = int((time.perf_counter() - started) * 1000)
        hdrs = dict(resp.headers)
        meta = response_meta(hdrs, wire, wire)
        return ms, meta


def load_baseline(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    if "thresholds_ms" not in data:
        raise ValueError("baseline missing thresholds_ms")
    return data


PHASE_G_METRIC_MAP = {
    "delta_sync_p95_ms": "sync_delta_ms",
    "read_module_p95_ms": "read_lodgers_active_ms",
    "reports_history_query_p95_ms": "read_events_ms",
}


def parse_timing_header(headers: dict) -> dict | None:
    raw = headers.get("X-Ketang-Timing") or headers.get("x-ketang-timing")
    if raw:
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            pass
    server = headers.get("Server-Timing") or headers.get("server-timing")
    if not server:
        return None
    stages: dict[str, int] = {}
    for part in server.split(","):
        piece = part.strip()
        if not piece:
            continue
        name, _, dur = piece.partition(";")
        if "dur=" in dur:
            try:
                ms = int(float(dur.split("dur=")[-1].strip()))
                key = name.strip().replace("-", "_") + "_ms"
                stages[key] = ms
            except ValueError:
                continue
    return stages or None


def extract_timing(payload: dict | None, headers: dict, status: int) -> dict | None:
    if isinstance(payload, dict) and payload.get("_timing"):
        return payload["_timing"]
    if status == 304:
        return parse_timing_header(headers)
    return None


def run_external_ms(external_ms: int, timing: dict | None, meta: dict) -> dict:
    server_total = int(timing["total_ms"]) if timing and timing.get("total_ms") is not None else None
    gap = external_ms - server_total if server_total is not None else None
    run = {
        "external_ms": external_ms,
        "server_total_ms": server_total,
        "network_gap_ms": gap,
        "content_encoding": meta.get("content_encoding"),
        "bytes": meta.get("bytes"),
        "decoded_bytes": meta.get("decoded_bytes"),
    }
    if meta.get("cf_ray"):
        run["cf_ray"] = meta["cf_ray"]
    if meta.get("cf_colo"):
        run["cf_colo"] = meta["cf_colo"]
    if meta.get("request_id"):
        run["request_id"] = meta["request_id"]
    return run


def summarize_probe_runs(runs: list[dict]) -> dict:
    externals = [r["external_ms"] for r in runs]
    metric = summarize_samples(externals)
    gaps = [r["network_gap_ms"] for r in runs if r.get("network_gap_ms") is not None]
    servers = [r["server_total_ms"] for r in runs if r.get("server_total_ms") is not None]
    if gaps:
        metric["network_gap_ms"] = percentile(gaps, 95)
    if servers:
        metric["server_total_ms"] = percentile(servers, 95)
    last = runs[-1]
    metric["content_encoding"] = last.get("content_encoding")
    metric["bytes"] = last.get("bytes")
    metric["decoded_bytes"] = last.get("decoded_bytes")
    if last.get("cf_ray"):
        metric["cf_ray"] = last["cf_ray"]
    if last.get("cf_colo"):
        metric["cf_colo"] = last["cf_colo"]
    if runs[-1].get("server_timing"):
        metric["server_timing"] = runs[-1]["server_timing"]
    retries = [r["retry_ms"] for r in runs if r.get("retry_ms") is not None]
    if retries:
        metric["retry_ms"] = retries
    return metric


def classify_outliers(metric_key: str, runs: list[dict], baseline_limit: int | None) -> list[dict]:
    if len(runs) < 2:
        return []
    p50 = percentile([r["external_ms"] for r in runs], 50)
    threshold = max(int(p50 * OUTLIER_P50_FACTOR), OUTLIER_RETRY_MS)
    if baseline_limit:
        threshold = max(threshold, int(baseline_limit * 1.5))
    outliers = []
    for r in runs:
        ext = r["external_ms"]
        if ext <= threshold:
            continue
        srv = r.get("server_total_ms")
        gap = r.get("network_gap_ms")
        classification = "edge_or_network_tail"
        if srv and gap is not None and gap > max(srv, 3000):
            classification = "edge_or_network_tail"
        elif srv and ext <= srv * 2:
            classification = "server_or_cold_start"
        outliers.append(
            {
                "metric": metric_key,
                "sample_ms": ext,
                "server_total_ms": srv,
                "network_gap_ms": gap,
                "retry_ms": r.get("retry_ms"),
                "classification": classification,
            }
        )
    return outliers


def probe_repeat(
    metric_key: str,
    sample_n: int,
    fetch_once: Callable[[], dict],
    baseline_limit: int | None = None,
) -> tuple[dict, list[dict]]:
    runs: list[dict] = []
    for _ in range(sample_n):
        run = fetch_once()
        if run["external_ms"] >= OUTLIER_RETRY_MS:
            retry = fetch_once()
            run["retry_ms"] = retry["external_ms"]
        runs.append(run)
    return summarize_probe_runs(runs), classify_outliers(metric_key, runs, baseline_limit)


def attach_server_timing(metric: dict, timing: dict | None) -> None:
    if not isinstance(metric, dict) or not isinstance(timing, dict):
        return
    if timing.get("total_ms") is not None and "server_total_ms" not in metric:
        metric["server_total_ms"] = int(timing["total_ms"])
    metric["server_timing"] = timing


def phase_g_actual_ms(key: str, results: dict) -> int | None:
    if key == "login_to_ready_p95_ms":
        frontend = results.get("frontend_login_ready_ms")
        if isinstance(frontend, dict) and frontend.get("p95_ms") is not None:
            return frontend.get("p95_ms")
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
        if key in ("extra_module_fetch_after_write_max", "d1_error_rate_max_pct"):
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


def check_baseline_graded(results: dict, baseline: dict) -> tuple[list[str], list[str], list[str]]:
    """FAIL / WARN / INFO 分级 | Graded baseline checks."""
    thresholds = baseline.get("thresholds_ms", {})
    levels = baseline.get("probe_check_levels", {})
    warn_keys = set(levels.get("warn", []))
    fails: list[str] = []
    warns: list[str] = []
    infos: list[str] = []
    outliers = results.get("outliers") or []
    if outliers:
        recovered = [o for o in outliers if o.get("retry_ms") is not None]
        if recovered:
            infos.append(f"{len(recovered)} outlier(s) retried")
    for key, limit in thresholds.items():
        metric = results.get(key)
        if not isinstance(metric, dict):
            fails.append(f"missing metric {key}")
            continue
        actual = metric.get("p95_ms", metric.get("max_ms", 0))
        server = metric.get("server_total_ms")
        if actual <= limit:
            continue
        msg = f"{key} p95={actual}ms exceeds {limit}ms"
        if key in warn_keys and server is not None and server <= limit:
            warns.append(msg + " (server ok, external gap)")
        else:
            fails.append(msg)
    return fails, warns, infos


def check_login_bootstrap_read_guard(
    results: dict, baseline: dict
) -> tuple[list[str], list[str]]:
    """G-6：登录首屏不得再发独立 read module（board 应内嵌于 login）。"""
    if results.get("frontend_probe_skip"):
        return [], []
    marks = results.get("read_module_marks")
    if marks is None:
        return [], []

    levels = baseline.get("probe_check_levels", {})
    fail_keys = set(levels.get("fail", []))
    warn_keys = set(levels.get("warn", []))
    fails: list[str] = []
    warns: list[str] = []

    bad_marks: list[str] = []
    if isinstance(marks, list):
        for mark in marks:
            if not isinstance(mark, str):
                continue
            if not mark.startswith("ketang:read:"):
                continue
            if "seeded" in mark:
                continue
            bad_marks.append(mark)

    read_board = results.get("frontend_read_board_ms")
    has_read_board_measure = (
        isinstance(read_board, dict) and read_board.get("p95_ms") is not None
    )

    if not bad_marks and not has_read_board_measure:
        return [], []

    parts: list[str] = []
    if bad_marks:
        parts.append(f"read_module_marks={bad_marks}")
    if has_read_board_measure:
        parts.append(f"frontend_read_board_ms={read_board.get('p95_ms')}ms")
    msg = (
        "login_bootstrap_extra_read_module: "
        + "; ".join(parts)
        + " (G-6: board embedded in login; expect no separate /read/board after submitLogin)"
    )

    key = "login_bootstrap_extra_read_module"
    if key in fail_keys:
        fails.append(msg)
    elif key in warn_keys:
        warns.append(msg)
    else:
        fails.append(msg)
    return fails, warns


def probe_frontend_metrics(frontend_base: str | None, api_base: str) -> dict:
    """CDP 前端 Phase G：login-ready、write-refresh、read module marks。"""
    if os.environ.get("KETANG_SKIP_ONLINE_E2E") == "1":
        return {"_skip": "KETANG_SKIP_ONLINE_E2E=1"}
    try:
        import subprocess

        import websocket

        from test_cdp import CDP_PORT, PORT, cdp_ws_url, evaluate, recv_by_id, start_server, wait_for_cdp
        from test_file_protocol import chrome_binary
    except ImportError as exc:
        return {"_skip": f"import:{exc}"}

    chrome = chrome_binary()
    if not chrome:
        return {"_skip": "chrome_not_found"}

    page_base = (frontend_base or f"http://127.0.0.1:{PORT}").rstrip("/")
    use_local_server = page_base.startswith("http://127.0.0.1") or page_base.startswith("http://localhost")
    server = start_server() if use_local_server else None

    proc = subprocess.Popen(
        [
            chrome,
            f"--remote-debugging-port={CDP_PORT}",
            "--remote-allow-origins=*",
            "--headless=new",
            "--disable-gpu",
            "--no-sandbox",
            "--disable-dev-shm-usage",
            f"{page_base}/index.html",
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
        # Production cold load (restoreRemoteSession + CDN) can exceed 30s.
        init_wait_iters = 120 if not use_local_server else 60
        for _ in range(init_wait_iters):
            if evaluate(ws, "window.ketangReady").get("value"):
                break
            time.sleep(0.5)
        else:
            return {"_skip": "app_init_timeout"}

        if use_local_server:
            online = evaluate(
                ws,
                """({
                  isRemoteDB: typeof isRemoteDB === 'function' && isRemoteDB(),
                  useRemoteWriteApi: typeof useRemoteWriteApi === 'function' && useRemoteWriteApi(),
                })""",
            ).get("value", {})
            if not online.get("isRemoteDB"):
                return {"_skip": "not_remote_db", "detail": online, "frontend_base": page_base}

        expr = """
        (async () => {
          performance.clearMarks();
          performance.clearMeasures();
          document.getElementById('login-username').value = 'admin';
          document.getElementById('login-password').value = 'admin';
          await submitLogin();
          for (let i = 0; i < 100; i++) {
            if (typeof isLoggedIn === 'function' && isLoggedIn()) break;
            await new Promise(r => setTimeout(r, 250));
          }
          if (!(typeof isLoggedIn === 'function' && isLoggedIn())) {
            return { error: 'login failed' };
          }
          const measures = performance.getEntriesByType('measure');
          const loginReady = measures.filter(e => e.name === 'ketang:login-ready');
          const firstView = measures.filter(e => e.name === 'ketang:first-view-ready');
          const readBoard = measures.filter(e => e.name === 'ketang:read:board');
          const readModules = measures
            .filter(e => e.name.startsWith('ketang:read:') && e.name.endsWith(':end') === false)
            .map(e => ({ name: e.name, ms: Math.round(e.duration || 0) }));
          const readModuleNames = [...new Set(
            measures.map(e => e.name).filter(n => n.startsWith('ketang:read:'))
          )];
          let writeRefreshMs = null;
          if (typeof rcRefreshAfterWrite === 'function') {
            const t0 = performance.now();
            const task = rcRefreshAfterWrite(
              { patches: {}, deletions: [] },
              { scope: 'board', skipViewRefresh: false },
            );
            if (task && typeof task.then === 'function') await task;
            await new Promise(r => setTimeout(r, 500));
            const wr = performance.getEntriesByType('measure')
              .filter(e => e.name === 'ketang:write-refresh');
            writeRefreshMs = wr.length
              ? Math.round(wr[wr.length - 1].duration)
              : Math.round(performance.now() - t0);
          }
          return {
            loginReadyMs: loginReady.length
              ? Math.round(loginReady[loginReady.length - 1].duration)
              : null,
            firstViewReadyMs: firstView.length
              ? Math.round(firstView[firstView.length - 1].duration)
              : null,
            readBoardMs: readBoard.length
              ? Math.round(readBoard[readBoard.length - 1].duration)
              : null,
            writeRefreshMs,
            readModuleMarks: readModuleNames,
            hasLoginReady: loginReady.length > 0 || firstView.length > 0,
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
            recv_by_id(ws, 2, 300)
            .get("result", {})
            .get("result", {})
            .get("value", {})
        )
        ws.close()
        if result.get("error"):
            return {"_skip": result["error"], "detail": result, "frontend_base": page_base}
        if not result.get("hasLoginReady"):
            return {"_skip": "login_ready_mark_missing", "detail": result, "frontend_base": page_base}

        out: dict[str, Any] = {
            "frontend_base": page_base,
            "api_base": api_base,
            "read_module_marks": result.get("readModuleMarks") or [],
        }
        first_ms = result.get("firstViewReadyMs")
        login_ms = result.get("loginReadyMs")
        ready_ms = first_ms if first_ms is not None else login_ms
        if ready_ms is not None:
            out["frontend_login_ready_ms"] = {
                "samples": [ready_ms],
                "p50_ms": ready_ms,
                "p95_ms": ready_ms,
                "max_ms": ready_ms,
                "source": "cdp_ketang:first-view-ready"
                if first_ms is not None
                else "cdp_ketang:login-ready",
            }
        if first_ms is not None and login_ms is not None and first_ms != login_ms:
            out["frontend_login_ready_full_ms"] = {
                "samples": [login_ms],
                "p50_ms": login_ms,
                "p95_ms": login_ms,
                "max_ms": login_ms,
                "source": "cdp_ketang:login-ready",
            }
        if result.get("readBoardMs") is not None:
            ms = int(result["readBoardMs"])
            out["frontend_read_board_ms"] = {
                "samples": [ms],
                "p50_ms": ms,
                "p95_ms": ms,
                "max_ms": ms,
                "source": "cdp_ketang:read:board",
            }
        if result.get("writeRefreshMs") is not None:
            ms = int(result["writeRefreshMs"])
            out["frontend_write_refresh_ms"] = {
                "samples": [ms],
                "p50_ms": ms,
                "p95_ms": ms,
                "max_ms": ms,
                "source": "cdp_rcRefreshAfterWrite",
            }
        return out
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()
        if server:
            server.terminate()
            try:
                server.wait(timeout=3)
            except subprocess.TimeoutExpired:
                server.kill()


def ingest_probe_samples(base: str, results: dict) -> None:
    """POST synthetic probe summary to metrics/probe (best-effort)."""
    samples = []
    for key, endpoint in (
        ("read_board_ms", "read/board"),
        ("read_lodgers_active_ms", "read/lodgers_active"),
        ("read_lodgers_lookup_ms", "read/lodgers_lookup"),
        ("read_events_ms", "read/events"),
        ("sync_delta_ms", "sync/delta"),
        ("login_role_ms", "auth/login"),
    ):
        metric = results.get(key)
        if not metric:
            continue
        timing = metric.get("server_timing") or results.get(key.replace("_ms", "_timing"))
        server_ms = metric.get("server_total_ms")
        if server_ms is None and isinstance(timing, dict):
            server_ms = timing.get("total_ms")
        samples.append(
            {
                "endpoint": endpoint,
                "external_ms": metric.get("p95_ms"),
                "server_ms": server_ms,
                "network_gap_ms": metric.get("network_gap_ms"),
                "bytes": metric.get("bytes"),
                "cf_colo": metric.get("cf_colo"),
                "source": "prod_probe",
            }
        )
    if not samples:
        return
    status, body, _, _, _ = request_json(
        f"{base.rstrip('/')}/api/v1/metrics/probe",
        method="POST",
        body={"kind": "probe", "samples": samples},
    )
    if status not in (200, 204):
        print(f"WARN probe ingest status={status} body={body}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Ketang production latency probe")
    parser.add_argument(
        "--base",
        default="https://wulingkt.net",
        help="API/site base URL for HTTP probes",
    )
    parser.add_argument(
        "--frontend-base",
        help="CDP page base (default: local dev_server; use https://wulingkt.net for prod UI)",
    )
    parser.add_argument("--role", default="admin", help="Login role")
    parser.add_argument("--password", default="admin", help="Login password")
    parser.add_argument(
        "--samples",
        type=int,
        default=DEFAULT_SAMPLES,
        help=f"Repeat count for P50/P95 (default {DEFAULT_SAMPLES})",
    )
    parser.add_argument(
        "--warmup",
        type=int,
        default=DEFAULT_WARMUP,
        help=f"Warm-up requests excluded from samples (default {DEFAULT_WARMUP})",
    )
    parser.add_argument(
        "--check-baseline",
        nargs="?",
        const=str(DEFAULT_BASELINE),
        help="Fail when P95 exceeds docs/ops/performance-baseline.json",
    )
    parser.add_argument(
        "--check-baseline-graded",
        action="store_true",
        help="Print FAIL/WARN/INFO baseline levels (probe_check_levels in baseline JSON)",
    )
    parser.add_argument(
        "--check-phase-g",
        action="store_true",
        help="Fail when P95 exceeds phase_g_targets_ms in baseline",
    )
    parser.add_argument(
        "--probe-frontend",
        action="store_true",
        help="CDP probe for login-ready / write-refresh (requires Chrome)",
    )
    parser.add_argument(
        "--write-report",
        help="Optional path to write JSON report",
    )
    parser.add_argument(
        "--write-history",
        nargs="?",
        const="auto",
        help="Append to docs/ops/perf-history/YYYY-MM-DD.json (default path when flag alone)",
    )
    parser.add_argument(
        "--ingest-probe",
        action="store_true",
        help="POST probe summary to /api/v1/metrics/probe (uses login session)",
    )
    args = parser.parse_args()
    base = args.base.rstrip("/")
    timing_q = "?timing=1"
    sample_n = max(1, args.samples)
    warmup_n = max(0, args.warmup)
    probe_frontend = args.probe_frontend or args.check_phase_g
    baseline_path = Path(args.check_baseline or DEFAULT_BASELINE) if args.check_baseline else DEFAULT_BASELINE
    baseline = load_baseline(baseline_path) if baseline_path.exists() else {"thresholds_ms": {}}
    thresholds = baseline.get("thresholds_ms", {})

    print(f"Target: {base} (samples={sample_n}, warmup={warmup_n}, gzip=on)")
    results: dict = {}
    all_outliers: list[dict] = []

    try:
        ttfb_ms(f"{base}/index.html")
        index_runs = []
        for _ in range(sample_n):
            ms, meta = ttfb_ms(f"{base}/index.html")
            index_runs.append({"external_ms": ms, **meta})
        results["index_ttfb_ms"] = summarize_probe_runs(index_runs)
    except Exception as exc:
        print(f"FAIL index TTFB: {exc}")
        return 1

    def login_fetch():
        status, body, ms, hdrs, meta = request_json(
            f"{base}/api/db{timing_q}",
            method="POST",
            body={"action": "login_role", "role": args.role, "password": args.password},
        )
        if status != 200 or not body.get("user"):
            raise RuntimeError(f"login_role status={status} body={body}")
        timing = extract_timing(body, hdrs, status)
        run = run_external_ms(ms, timing, meta)
        if timing:
            run["server_timing"] = timing
        return run

    try:
        for _ in range(warmup_n):
            login_fetch()
        metric, outliers = probe_repeat(
            "login_role_ms", sample_n, login_fetch, thresholds.get("login_role_ms")
        )
        results["login_role_ms"] = metric
        results["login_role_timing"] = metric.get("server_timing")
        all_outliers.extend(outliers)
    except RuntimeError as exc:
        print(f"FAIL {exc}")
        return 1

    def session_fetch():
        status, body, ms, hdrs, meta = request_json(f"{base}/api/v1/session{timing_q}")
        if status != 200:
            raise RuntimeError(f"session status={status} body={body}")
        timing = extract_timing(body, hdrs, status)
        run = run_external_ms(ms, timing, meta)
        if timing:
            run["server_timing"] = timing
        return run

    metric, outliers = probe_repeat(
        "session_ms", sample_n, session_fetch, thresholds.get("session_ms")
    )
    results["session_ms"] = metric
    results["session_timing"] = metric.get("server_timing")
    all_outliers.extend(outliers)

    etag_holder: dict[str, Any] = {"etag": None}

    def read_model_fetch():
        status, body, ms, hdrs, meta = request_json(f"{base}/api/v1/read-model{timing_q}")
        if status != 200:
            raise RuntimeError(f"read-model status={status} body={body}")
        etag_holder["etag"] = hdrs.get("ETag") or hdrs.get("etag") or body.get("version")
        timing = extract_timing(body, hdrs, status)
        run = run_external_ms(ms, timing, meta)
        if timing:
            run["server_timing"] = timing
        return run

    metric, outliers = probe_repeat(
        "read_model_ms", sample_n, read_model_fetch, thresholds.get("read_model_ms")
    )
    results["read_model_ms"] = metric
    results["read_model_timing"] = metric.get("server_timing")
    all_outliers.extend(outliers)

    if etag_holder["etag"] is not None:
        etag_text = str(etag_holder["etag"])

        def read_model_304_fetch():
            status, body, ms, hdrs, meta = request_json(
                f"{base}/api/v1/read-model{timing_q}",
                headers={"If-None-Match": etag_text},
            )
            if status != 304:
                raise RuntimeError(f"read-model 304 expected, got {status}")
            timing = extract_timing(body, hdrs, status)
            run = run_external_ms(ms, timing, meta)
            if timing:
                run["server_timing"] = timing
            return run

        metric, outliers = probe_repeat(
            "read_model_304_ms",
            sample_n,
            read_model_304_fetch,
            thresholds.get("read_model_304_ms"),
        )
        results["read_model_304_ms"] = metric
        results["read_model_304_timing"] = metric.get("server_timing")
        all_outliers.extend(outliers)
    else:
        print("WARN read-model missing ETag; skipped 304 probe")

    def board_version_fetch():
        status, body, ms, hdrs, meta = request_json(f"{base}/api/v1/board-version")
        if status != 200:
            raise RuntimeError(f"board-version status={status} body={body}")
        return run_external_ms(ms, None, meta)

    metric, outliers = probe_repeat(
        "board_version_ms", sample_n, board_version_fetch, thresholds.get("board_version_ms")
    )
    results["board_version_ms"] = metric
    all_outliers.extend(outliers)

    def module_fetch(path: str, key: str):
        def _fetch():
            status, body, ms, hdrs, meta = request_json(f"{base}{path}{timing_q}")
            if status != 200 or not body.get("tables"):
                raise RuntimeError(f"{key} status={status} body={body}")
            timing = extract_timing(body, hdrs, status)
            run = run_external_ms(ms, timing, meta)
            if timing:
                run["server_timing"] = timing
            return run

        return _fetch

    for path, key in (
        ("/api/v1/read/lodgers_active", "read_lodgers_active_ms"),
        ("/api/v1/read/lodgers_lookup", "read_lodgers_lookup_ms"),
        ("/api/v1/read/board", "read_board_ms"),
        ("/api/v1/read/events", "read_events_ms"),
    ):
        metric, outliers = probe_repeat(
            key, sample_n, module_fetch(path, key), thresholds.get(key)
        )
        results[key] = metric
        results[key.replace("_ms", "_timing")] = metric.get("server_timing")
        all_outliers.extend(outliers)

    board_version_holder: dict[str, Any] = {"v": 0}
    status, body, _, _, _ = request_json(f"{base}/api/v1/read/board{timing_q}")
    if status == 200:
        board_version_holder["v"] = body.get("board_version") or 0

    def delta_fetch():
        status, payload, ms, hdrs, meta = request_json(
            f"{base}/api/v1/sync/delta{timing_q}",
            headers={"If-None-Match": str(board_version_holder["v"])},
        )
        if status not in (200, 304):
            raise RuntimeError(f"sync/delta status={status} body={payload}")
        timing = extract_timing(payload, hdrs, status)
        run = run_external_ms(ms, timing, meta)
        if timing:
            run["server_timing"] = timing
        return run

    metric, outliers = probe_repeat(
        "sync_delta_ms", sample_n, delta_fetch, thresholds.get("sync_delta_ms")
    )
    results["sync_delta_ms"] = metric
    results["sync_delta_timing"] = metric.get("server_timing")
    all_outliers.extend(outliers)

    if all_outliers:
        results["outliers"] = all_outliers

    if probe_frontend:
        frontend = probe_frontend_metrics(args.frontend_base, base)
        if frontend.get("_skip"):
            results["frontend_probe_skip"] = frontend
            print(f"WARN frontend probe skipped: {frontend.get('_skip')}")
        else:
            for k in (
                "frontend_login_ready_ms",
                "frontend_write_refresh_ms",
                "frontend_read_board_ms",
                "read_module_marks",
                "frontend_base",
            ):
                if k in frontend:
                    results[k] = frontend[k]

    print(json.dumps(results, ensure_ascii=False, indent=2))

    report = {
        "base": base,
        "frontend_base": args.frontend_base,
        "samples": sample_n,
        "probe_gzip": True,
        "results": results,
    }
    if args.write_report:
        report_path = Path(args.write_report)
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Report written: {report_path}")

    history_path = None
    if args.write_history:
        if args.write_history == "auto":
            history_path = ROOT / "docs/ops/perf-history" / f"{time.strftime('%Y-%m-%d')}.json"
        else:
            history_path = Path(args.write_history)
        history_path.parent.mkdir(parents=True, exist_ok=True)
        history_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"History written: {history_path}")

    if args.ingest_probe:
        try:
            ingest_probe_samples(base, results)
            print("OK probe samples ingested")
        except Exception as exc:
            print(f"WARN probe ingest failed: {exc}")

    if args.check_baseline or args.check_baseline_graded:
        if args.check_baseline_graded:
            fails, warns, infos = check_baseline_graded(results, baseline)
            guard_fails, guard_warns = check_login_bootstrap_read_guard(
                results, baseline
            )
            fails.extend(guard_fails)
            warns.extend(guard_warns)
            if infos:
                print("INFO baseline:")
                for item in infos:
                    print(f"  - {item}")
            if warns:
                print("WARN baseline thresholds:")
                for item in warns:
                    print(f"  - {item}")
            if fails:
                print("FAIL baseline thresholds:")
                for item in fails:
                    print(f"  - {item}")
                if all_outliers:
                    print(f"NOTE: {len(all_outliers)} outlier sample(s) in results.outliers")
                return 1
            if not warns:
                print(f"OK within baseline ({baseline_path.name})")
        elif args.check_baseline:
            failures = check_baseline(results, baseline)
            if failures:
                print("FAIL baseline thresholds:")
                for item in failures:
                    print(f"  - {item}")
                if all_outliers:
                    print(f"NOTE: {len(all_outliers)} outlier sample(s) recorded in results.outliers")
                return 1
            print(f"OK within baseline ({baseline_path.name})")

    if args.check_phase_g:
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
