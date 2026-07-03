#!/usr/bin/env python3
"""Phase G-4：探针观测 ingest 契约。"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def main() -> int:
    checks = [
        ("perf-ae.js", "recordPerfObservation" in read("functions/_shared/perf-ae.js")),
        ("waitUntil param", "waitUntil" in read("functions/_shared/perf-ae.js")),
        ("perf-probe-store", "storeProbeBatch" in read("functions/_shared/perf-probe-store.js")),
        ("metrics probe auth", "requireSession" in read("functions/api/v1/metrics/probe.js")),
        ("timing observe waitUntil", "waitUntil" in read("functions/_shared/timing.js")),
        ("history skip 304", "isHistoryPage" in read("functions/api/v1/read/[module].js")),
        ("probe ingest helper", "ingest_probe_samples" in read("test_prod_latency.py")),
        ("login bootstrap guard", "check_login_bootstrap_read_guard" in read("test_prod_latency.py")),
        ("guard fail level", "login_bootstrap_extra_read_module" in read("docs/ops/performance-baseline.json")),
    ]
    failed = [name for name, ok in checks if not ok]
    if failed:
        print("FAIL perf probe contracts:", ", ".join(failed))
        return 1
    print("PASS: perf probe / AE contracts")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
