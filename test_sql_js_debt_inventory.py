#!/usr/bin/env python3
"""sql.js / 本地 DB 兼容债务清单与回归守门（P4-④ 去 sql.js 前置）。"""
import re
import sys
from pathlib import Path

JS = Path("js")

# isLocalForceDb() 出现次数上限；债务清理时应下调，不得无声上涨
LOCAL_BRANCH_CEILING = {
    "app.js": 6,
    "auth.js": 9,
    "checkin.js": 5,
    "db.js": 2,
    "events.js": 5,
    "forecast.js": 5,
    "guests.js": 1,
    "history.js": 3,
    "housekeeping.js": 4,
    "lodger-actions.js": 5,
    "meals.js": 5,
    "mobile-ui.js": 1,
    "permissions.js": 1,
    "read-cache.js": 1,
    "read-shim.js": 1,
    "reports.js": 7,
    "reservations.js": 6,
    "rooming-adjustments.js": 2,
    "rooming-conflicts.js": 1,
    "rooming-plans.js": 4,
    "rooming-publish.js": 5,
    "rooming-read.js": 1,
    "sync-coordinator.js": 1,
    "validation.js": 1,
    "api-client.js": 2,
}


def read(path):
    return Path(path).read_text(encoding="utf-8")


def fn_body(src, fn_name):
    m = re.search(rf"function {re.escape(fn_name)}\([^)]*\)\s*\{{", src)
    if not m:
        return None
    depth = 0
    i = m.end() - 1
    while i < len(src):
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth == 0:
                return src[m.start() : i + 1]
        i += 1
    return None


def count_local_branches(rel):
    return read(JS / rel).count("isLocalForceDb()")


def check_online_path_helper():
    api = read("js/api-client.js")
    failed = []
    if "function useOnlineDataPath" not in api:
        failed.append("useOnlineDataPath missing in api-client.js")
    if "return useOnlineDataPath();" not in api:
        failed.append("useRemoteWriteApi must delegate to useOnlineDataPath")
    return failed


def check_info_online_guard():
    body = fn_body(read("js/info.js"), "infoUseApiData") or ""
    if "useOnlineDataPath()" not in body:
        return ["infoUseApiData must call useOnlineDataPath()"]
    return []


def check_read_shim_online_guard():
    shim = read("js/read-shim.js")
    failed = []
    if "function readOnlineCachePending" not in shim:
        failed.append("readOnlineCachePending missing in read-shim.js")
    if shim.count("readOnlineCachePending()") < 10:
        failed.append("read-shim should guard multiple helpers with readOnlineCachePending")
    return failed


def check_render_ops_notice():
    body = fn_body(read("js/app.js"), "renderOpsNotice") or ""
    if body.count("if (!isLocalForceDb())") != 1:
        return [
            "renderOpsNotice should have exactly one online branch "
            f"(found {body.count('if (!isLocalForceDb())')})"
        ]
    return []


def check_local_branch_ceiling():
    failed = []
    for rel, ceiling in sorted(LOCAL_BRANCH_CEILING.items()):
        count = count_local_branches(rel)
        if count > ceiling:
            failed.append(f"{rel}: isLocalForceDb()={count} exceeds ceiling {ceiling}")
    return failed


def print_inventory():
    db_lines = len(read("js/db.js").splitlines())
    shim_lines = len(read("js/read-shim.js").splitlines())
    local_files = sorted(
        p.name for p in JS.glob("*.js") if "isLocalForceDb()" in p.read_text(encoding="utf-8")
    )
    print(f"inventory: db.js={db_lines} lines, read-shim.js={shim_lines} lines")
    print(f"inventory: {len(local_files)} js modules with isLocalForceDb() branches")
    for rel in local_files:
        print(f"  - {rel}: {count_local_branches(rel)}")


def main():
    failed = []
    failed.extend(check_online_path_helper())
    failed.extend(check_info_online_guard())
    failed.extend(check_read_shim_online_guard())
    failed.extend(check_render_ops_notice())
    failed.extend(check_local_branch_ceiling())
    if failed:
        print("FAIL sql.js debt inventory:")
        for item in failed:
            print(" ", item)
        sys.exit(1)
    print_inventory()
    print("PASS: sql.js debt inventory guards")


if __name__ == "__main__":
    main()
