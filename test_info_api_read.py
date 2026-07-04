#!/usr/bin/env python3
"""信息管理 Phase C：列表应走 read-module API，不再本地 saveDB/optimistic patch。"""
import re
import sys


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


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


def main():
    src = read("js/info.js")
    info_body = fn_body(src, "infoUseApiData") or ""
    checks = [
        ("infoUseApiData", "function infoUseApiData" in src),
        ("info online path", "useOnlineDataPath()" in info_body),
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
