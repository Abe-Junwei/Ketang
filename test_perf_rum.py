#!/usr/bin/env python3
"""Phase G-1 RUM contracts | perf-rum.js + metrics/perf API."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def main() -> None:
    rum = read("js/perf-rum.js")
    html = read("index.html")
    perf_api = read("functions/api/v1/metrics/perf.js")
    store = read("functions/_shared/perf-rum-store.js")
    timing = read("functions/_shared/timing.js")
    auth = read("functions/_shared/auth.js")
    app = read("js/app.js")
    auth_js = read("js/auth.js")

    checks = [
        ("perf-rum module", "function perfRumInit" in rum and "sendBeacon" in rum),
        ("rum sampling", "_perfRumSampleHit" in rum and "perfRumForceSample" in rum),
        ("rum admin after login", "perfRumShouldReport()" in rum),
        ("rum no PII", "phone" not in rum and "guest" not in rum.lower()),
        ("rum measures", "first-view-ready" in rum and "long_task_max_ms" in rum),
        ("index loads perf-rum", "perf-rum.js" in html),
        ("app version meta", 'name="ketang-app-version"' in html),
        ("app wires rum init", "perfRumInit()" in app),
        ("app wires first view", "perfRumOnFirstViewReady()" in app),
        ("auth wires login ready", "ketang:login-ready" in auth_js or "login-ready" in auth_js),
        ("metrics perf api", "onRequestPost" in perf_api and "kind !== \"perf\"" in perf_api),
        ("perf store ddl", "perf_rum_samples" in store),
        ("allowed metric keys", "first_view_ready_ms" in store),
        ("optional session", "optionalSession" in auth),
        ("server timing header", "Server-Timing" in timing),
        ("request id header", "X-Ketang-Request-Id" in timing),
        ("render rooms marks", 'ketangPerfMark("render-rooms:start")' in app),
    ]

    failures = [name for name, ok in checks if not ok]
    if failures:
        print("FAIL perf RUM contracts:")
        for name in failures:
            print(f"  - {name}")
        raise SystemExit(1)
    print("PASS: Phase G-1 RUM contracts")


if __name__ == "__main__":
    main()
