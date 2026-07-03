#!/usr/bin/env python3
"""Phase G: performance mark wiring contracts."""
import sys
from pathlib import Path


def read(path):
    return Path(path).read_text(encoding="utf-8")


def main():
    perf = read("js/perf.js")
    auth = read("js/auth.js")
    rc = read("js/read-cache.js")
    sync = read("js/sync-coordinator.js")
    app = read("js/app.js")
    baseline = read("docs/ops/performance-baseline.json")
    html = read("index.html")

    checks = [
        ("perf module", "function ketangPerfMark" in perf and "performance.mark" in perf),
        ("perf measure", "function ketangPerfMeasure" in perf),
        ("perf summary", "function ketangPerfSummary" in perf),
        ("index loads perf", "perf.js" in html and "sql-wasm.js" not in html),
        ("login mark", 'ketangPerfMark("login:start")' in auth),
        ("login ready mark", 'ketangPerfMark("login-ready")' in auth),
        ("login measure", 'ketangPerfMeasure("login"' in auth),
        ("login ready measure", 'ketangPerfMeasure("login-ready"' in auth),
        ("read module mark", 'ketangPerfMark("read:"' in rc),
        ("write refresh mark", 'ketangPerfMark("write-refresh:start")' in rc),
        ("delta mark", 'ketangPerfMark("delta:start")' in sync),
        ("delta measure", 'ketangPerfMeasure("delta"' in sync),
        ("app ready mark", 'ketangPerfMark("app-ready")' in app),
        ("baseline login p95", "login_to_ready_p95_ms" in baseline),
        ("baseline write refresh", "write_refresh_p95_ms" in baseline),
        ("baseline delta sync", "delta_sync_p95_ms" in baseline),
        ("baseline read modules", "read_module_p95_ms" in baseline),
    ]

    failed = [name for name, ok in checks if not ok]
    if failed:
        print("FAIL perf marks:", ", ".join(failed))
        sys.exit(1)
    print("PASS: Phase G performance mark contracts")


if __name__ == "__main__":
    main()
