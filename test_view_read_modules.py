#!/usr/bin/env python3
"""视图级读模块：history/forecast/reports 应走 rcEnsureViewModules。"""
import sys


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def main():
    rc = read("js/read-cache.js")
    checks = [
        ("RC_VIEW_MODULES", "var RC_VIEW_MODULES" in rc),
        ("rcEnsureViewModules", "async function rcEnsureViewModules" in rc),
        ("history view key", "history:" in rc and "lodgers" in rc),
        ("reports view key", "reports:" in rc and "meals" in rc),
        ("historyLoadAndRender", "async function historyLoadAndRender" in read("js/history.js")),
        ("forecastLoadTab", "async function forecastLoadTab" in read("js/forecast.js")),
        ("reportsInitAndLoad", "async function reportsInitAndLoad" in read("js/reports.js")),
        ("prefetchViewData", "async function prefetchViewData" in read("js/app.js")),
        ("checkin rc picker", "rcBoardRoomsWithStats" in read("js/checkin.js")),
        ("board rc stats", "rcGetBoardBedStats" in rc),
        ("boardReadCacheReady", "function boardReadCacheReady" in rc),
        ("app uses rc lodgers", "rcActiveLodgersEnriched" in read("js/app.js")),
        ("housekeepingLoadAndRender", "housekeepingLoadAndRender" in read("js/housekeeping.js")),
    ]
    failed = [name for name, ok in checks if not ok]
    if failed:
        print("FAIL view read modules:", ", ".join(failed))
        sys.exit(1)
    print("PASS: view-scoped read module loaders present")


if __name__ == "__main__":
    main()
