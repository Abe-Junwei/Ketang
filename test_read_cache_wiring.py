#!/usr/bin/env python3
"""在线-only 读路径：read-cache 接线 + syncRemoteReadModel 走模块 API。"""
import sys


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def main():
    index = read("index.html")
    db = read("js/db.js")
    rc = read("js/read-cache.js")

    checks = [
        ("index loads read-cache before sync-coordinator", "read-cache.js" in index),
        (
            "read-cache after api-client",
            index.find("api-client.js") < index.find("read-cache.js"),
        ),
        ("db sync uses rcEnsureAppData", "rcEnsureAppData" in db),
        ("db forwards bootstrapOnly", "bootstrapOnly: bootstrapOnly" in db),
        ("index db.js versioned", "js/db.js?v=" in index),
        ("rcEnsureAppData defined", "async function rcEnsureAppData" in rc),
        ("board module in bootstrap", '"board"' in rc and "RC_APP_MODULES" in rc),
        ("lodgers_lookup in deferred", '"lodgers_lookup"' in rc and "RC_DEFERRED_MODULES" in rc),
        ("lodgers_records not in deferred", "RC_DEFERRED_MODULES" in rc and
         '"lodgers_records"' not in rc.split("RC_DEFERRED_MODULES")[1].split("];")[0]),
        (
            "write patch only touches version when patch_complete",
            "patch_complete === true" in rc
            and "touchBoardVersionFromWrite(writeResult)" in rc,
        ),
        (
            "write-refresh is visible-only timing",
            "write-visible-refresh" in rc and "write-reconcile" in rc,
        ),
        (
            "patch_complete skips reconcile",
            "patch_complete === true" in rc
            and "write-reconcile:start" in rc,
        ),
        (
            "patch whitelist existing tables only",
            "!Array.isArray(mod.tables[table])) return" in rc,
        ),
        (
            "report range full lodgers fallback",
            "function rcEnsureLodgersForReportRange" in rc
            and "RC_LODGERS_RECENT_DAYS" in rc,
        ),
        (
            "write refresh rerenders after background sync",
            "syncTask" in rc and "refreshOnce()" in rc and ".then(function" in rc,
        ),
    ]
    failed = [name for name, ok in checks if not ok]
    if failed:
        print("FAIL read-cache wiring:", ", ".join(failed))
        sys.exit(1)
    print("PASS: read-cache wired for online module read bootstrap")


if __name__ == "__main__":
    main()
