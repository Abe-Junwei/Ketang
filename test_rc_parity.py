#!/usr/bin/env python3
"""P2.5 rc 读层与 sql 过渡层静态契约 | rc read layer static guards."""
import sys
from pathlib import Path


def read(path):
    return Path(path).read_text(encoding="utf-8")


def main():
    rc = read("js/read-cache.js")
    shim = read("js/read-shim.js")
    info = read("js/info.js")
    rooming = read("js/rooming-read.js")
    sync = read("js/sync-coordinator.js")
    app = read("js/app.js")

    checks = [
        ("unified event detail", "rcEventDetailKey" in rc and "rcFetchEventDetail" in rc),
        ("no _infoModuleData", "_infoModuleData" not in info),
        ("no _roomingEventDetail", "_roomingEventDetail" not in rooming),
        ("hydrateSql gate", "hydrateSql" in rc and "isLocalForceDb" in rc),
        ("read shim", "readUseRc" in shim and "readLodgerEnriched" in shim),
        ("delta rc patch", "rcApplyDeltaPatches" in rc),
        ("force sync rcEnsureAppData", "rcEnsureAppData(true" in sync),
        ("online board stats rc", "if (!isLocalForceDb())" in app and "rcGetBoardBedStats" in app),
        ("public reserve page", Path("reserve.html").is_file()),
        ("scheduled backup", Path("functions/_scheduled.js").is_file()),
    ]
    failed = [name for name, ok in checks if not ok]
    if failed:
        print("FAIL rc parity:", ", ".join(failed))
        sys.exit(1)
    print("PASS: P1-P3 read layer + backup static guards")


if __name__ == "__main__":
    main()
