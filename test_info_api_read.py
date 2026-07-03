#!/usr/bin/env python3
"""信息管理 Phase C：列表应走 read-module API，不再本地 saveDB/optimistic patch。"""
import re
import sys


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def main():
    src = read("js/info.js")
    checks = [
        ("infoUseApiData", "function infoUseApiData" in src),
        ("infoEnsureModuleData", "async function infoEnsureModuleData" in src),
        ("rcFetch usage", "rcFetch(moduleKey" in src),
        ("no useRemoteWriteApi", "useRemoteWriteApi" not in src),
        ("no saveDB", "saveDB" not in src),
        ("no applyRemoteLocalPatch", "applyRemoteLocalPatch" not in src),
        ("server write patches", "infoApplyWritePatches" in src),
        ("cache-first render", "infoRcTabDataReady" in src),
        ("no blocking delta await", "await syncRemoteDeltaSince" not in src),
    ]
    failed = [name for name, ok in checks if not ok]
    if failed:
        print("FAIL info.js online read path:", ", ".join(failed))
        sys.exit(1)
    if re.search(r"if\s*\(\s*useRemoteWriteApi", src):
        print("FAIL info.js still branches on useRemoteWriteApi")
        sys.exit(1)
    print("PASS: info.js uses API module read path")


if __name__ == "__main__":
    main()
