#!/usr/bin/env python3
"""在线写后同步范围：info/events 须刷新多模块，避免 rc 与 sql.js 陈旧。"""
import sys
from pathlib import Path


def read(path):
    return Path(path).read_text(encoding="utf-8")


def main():
    rc = read("js/read-cache.js")
    sync = read("js/sync-coordinator.js")
    events = read("js/events.js")
    info = read("js/info.js")

    checks = [
        ("rcModulesForInfoTab", "function rcModulesForInfoTab" in rc),
        ("rcInvalidateForInfoTab", "function rcInvalidateForInfoTab" in rc),
        ("events tab modules", '"events"' in rc and "reservations" in rc),
        ("resolveScopedModuleKeys", "function resolveScopedModuleKeys" in sync),
        ("scoped multi-module sync", "scopedModules.length" in sync and "syncRemoteByModules(modules" in sync),
        ("domainsToModules no single-scope shortcut", "return [scoped]" not in sync),
        ("rcEventMembers", "function rcEventMembers" in rc),
        ("eventReadReady", "function eventReadReady" in events),
        ("batch cancel awaits sync", "await refreshTask" in events and "batchCancelEventMembers" in events),
        ("info rc invalidate", "rcInvalidateForInfoTab" in info),
        ("boardReadCacheReady uses rcReadReady", "rcReadReady()" in rc and "function boardReadCacheReady" in rc),
        ("rcFlexEmptyRooms", "function rcFlexEmptyRooms" in rc),
    ]
    failed = [name for name, ok in checks if not ok]
    if failed:
        print("FAIL online sync scope:", ", ".join(failed))
        sys.exit(1)
    events_mods = rc.split("RC_INFO_TAB_MODULES", 1)[1].split("events:", 1)[1][:120]
    if events_mods.count('"') < 6:
        print("FAIL: events tab should list multiple read modules")
        sys.exit(1)
    print("PASS: online write sync scope guards present")


if __name__ == "__main__":
    main()
