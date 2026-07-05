#!/usr/bin/env python3
"""在线写路径：业务模块应用 isLocalForceDb，不再 if(useRemoteWriteApi) 双轨。"""
import re
import sys
from pathlib import Path


def read(path):
    return Path(path).read_text(encoding="utf-8")


def main():
    api = read("js/api-client.js")
    if "function isLocalForceDb" not in api:
        print("FAIL: isLocalForceDb missing in api-client.js")
        sys.exit(1)

    business = [
        "js/checkin.js",
        "js/lodger-actions.js",
        "js/events.js",
        "js/reservations.js",
        "js/meals.js",
        "js/housekeeping.js",
        "js/rooming-plans.js",
    ]
    failed = []
    for rel in business:
        src = read(rel)
        if re.search(r"if\s*\(\s*useRemoteWriteApi\s*\(", src):
            failed.append(rel + " still uses if(useRemoteWriteApi())")
        if (
            "isLocalForceDb" not in src
            and "saveDB" in src
            and "useOnlineDataPath" not in src
        ):
            failed.append(rel + " missing isLocalForceDb with saveDB")
    if failed:
        print("FAIL online write guard:")
        for f in failed:
            print(" ", f)
        sys.exit(1)
    print("PASS: business modules use isLocalForceDb write guard")


if __name__ == "__main__":
    main()
