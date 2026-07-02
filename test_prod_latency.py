#!/usr/bin/env python3
"""生产/预发接口测速 | Benchmark auth and read-model endpoints."""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEFAULT_BASELINE = ROOT / "docs/ops/performance-baseline.json"


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


def request_json(url, method="GET", headers=None, body=None, timeout=60):
    data = None
    req_headers = {
        "Accept": "application/json",
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
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            elapsed_ms = int((time.perf_counter() - started) * 1000)
            payload = json.loads(raw or "{}") if raw else {}
            return resp.status, payload, elapsed_ms, dict(resp.headers)
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        try:
            payload = json.loads(raw or "{}") if raw else {}
        except json.JSONDecodeError:
            payload = {"error": raw[:200]}
        return exc.code, payload, elapsed_ms, dict(exc.headers)


def ttfb_ms(url, timeout=60):
    started = time.perf_counter()
    req = urllib.request.Request(
        url,
        method="GET",
        headers={"User-Agent": "KetangLatencyProbe/1.0"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        resp.read(256)
        return int((time.perf_counter() - started) * 1000)


def load_baseline(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    if "thresholds_ms" not in data:
        raise ValueError("baseline missing thresholds_ms")
    return data


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
        "--write-report",
        help="Optional path to write JSON report",
    )
    args = parser.parse_args()
    base = args.base.rstrip("/")
    timing_q = "?timing=1"
    sample_n = max(1, args.samples)

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
    token = None
    for _ in range(sample_n):
        status, body, ms, _ = request_json(
            f"{base}/api/db",
            method="POST",
            body={"action": "login_role", "role": args.role, "password": args.password},
        )
        login_samples.append(ms)
        if status != 200 or not body.get("token"):
            print(f"FAIL login_role status={status} body={body}")
            return 1
        token = body["token"]
    results["login_role_ms"] = summarize_samples(login_samples)
    results["login_role_timing"] = body.get("_timing")

    session_samples: list[int] = []
    for _ in range(sample_n):
        status, body, ms, _ = request_json(
            f"{base}/api/v1/session{timing_q}",
            headers={"Authorization": f"Bearer {token}"},
        )
        session_samples.append(ms)
        if status != 200:
            print(f"FAIL session status={status} body={body}")
            return 1
    results["session_ms"] = summarize_samples(session_samples)
    results["session_timing"] = body.get("_timing")

    read_samples: list[int] = []
    etag = None
    for _ in range(sample_n):
        status, body, ms, headers = request_json(
            f"{base}/api/v1/read-model{timing_q}",
            headers={"Authorization": f"Bearer {token}"},
        )
        read_samples.append(ms)
        if status != 200:
            print(f"FAIL read-model status={status} body={body}")
            return 1
        etag = headers.get("ETag") or headers.get("etag") or body.get("version")
    results["read_model_ms"] = summarize_samples(read_samples)
    results["read_model_timing"] = body.get("_timing")

    if etag is not None:
        etag_text = str(etag)
        samples_304: list[int] = []
        for _ in range(sample_n):
            status, _, ms, _ = request_json(
                f"{base}/api/v1/read-model{timing_q}",
                headers={
                    "Authorization": f"Bearer {token}",
                    "If-None-Match": etag_text,
                },
            )
            samples_304.append(ms)
            if status != 304:
                print(f"FAIL read-model 304 expected, got {status}")
                return 1
        results["read_model_304_ms"] = summarize_samples(samples_304)
    else:
        print("WARN read-model missing ETag; skipped 304 probe")

    board_samples: list[int] = []
    for _ in range(sample_n):
        status, body, ms, _ = request_json(
            f"{base}/api/v1/board-version",
            headers={"Authorization": f"Bearer {token}"},
        )
        board_samples.append(ms)
        if status != 200:
            print(f"FAIL board-version status={status} body={body}")
            return 1
    results["board_version_ms"] = summarize_samples(board_samples)

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

    print("OK production latency probe")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
