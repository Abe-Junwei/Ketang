#!/usr/bin/env python3
"""read-shim 在线缓存未就绪时不得调用 query()。"""
import sys
from pathlib import Path


def read(path):
    return Path(path).read_text(encoding="utf-8")


def main():
    src = read("js/read-shim.js")
    checks = [
        ("readUseOnlineDataPath helper", "function readUseOnlineDataPath" in src),
        ("online gate matches db", "isRemoteDB()" in src.split("function readUseOnlineDataPath", 1)[1].split("function readRcModuleCached", 1)[0]),
        ("multi-module cache helper", "function readUseCachedModules" in src),
        ("readOnlineCachePending helper", "function readOnlineCachePending" in src),
        ("readLocalQuery helper", "function readLocalQuery" in src),
        ("readUseRc online gate", "useOnlineDataPath()" in src.split("function readUseRc")[1].split("function readOnlineCachePending")[0]),
        ("events cached read", "readUseCachedModule(\"events\")" in src and "function readEventById" in src),
        (
            "event genders cached read",
            "function readEventMemberGenders" in src
            and 'readUseCachedModules(["events", "lodgers_active", "reservations"])' in src
            and "rcEventMembers(eventId)" in src,
        ),
        ("event delete safe count", "if (readUseOnlineDataPath()) return 1" in src),
        ("lodger pending null", "readOnlineCachePending()) return null" in src),
        ("meals pending empty", "readOnlineCachePending()) return []" in src),
        (
            "avail rooms online rc",
            "roomingAvailRoomsGrouped(evt)" in src
            and "function readAvailRoomsGroupedForEvent" in src,
        ),
        ("export reservations helper", "readEventMemberReservationsForExport" in src),
    ]
    failed = [name for name, ok in checks if not ok]
    if failed:
        print("FAIL read-shim online guard:", ", ".join(failed))
        sys.exit(1)
    print("PASS: read-shim guards online cache pending without query()")


if __name__ == "__main__":
    main()
