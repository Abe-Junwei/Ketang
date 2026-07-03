#!/usr/bin/env python3
"""Phase C-L2：房务状态局部乐观更新与失败回滚。"""
import sys
from pathlib import Path


def read(path):
    return Path(path).read_text(encoding="utf-8")


def main():
    hk = read("js/housekeeping.js")
    rc = read("js/read-cache.js")
    checks = [
        ("buttons pass source", "setHkAndRender(event.currentTarget" in hk),
        ("set function accepts source", "async function setHkAndRender(source, bedId, status)" in hk),
        ("pending guard", "beginActionPending(source" in hk and "finishPending()" in hk),
        ("bed pending survives render", "HOUSEKEEPING_PENDING_BEDS" in hk and "disabled>保存中" in hk),
        ("optimistic helper", "function applyHousekeepingOptimistic" in hk),
        ("optimistic marker", "_optimistic: true" in hk),
        ("latest status ignores optimistic", "!h._optimistic" in rc),
        ("optimistic patches rc", "rcApplyDeltaPatches" in hk and "housekeeping" in hk),
        ("renders immediately", "renderHousekeeping();" in hk),
        ("success removes optimistic row", "rollbackHousekeepingOptimistic(optimistic)" in hk),
        ("failure force fetches board", "rcEnsureViewModules(\"housekeeping\", true)" in hk),
        ("refresh failure surfaced", "房务状态已保存，但刷新失败" in hk),
    ]
    failed = [name for name, ok in checks if not ok]
    if failed:
        print("FAIL housekeeping optimistic:")
        for item in failed:
            print(" ", item)
        sys.exit(1)
    print("PASS: housekeeping optimistic update and rollback wired")


if __name__ == "__main__":
    main()