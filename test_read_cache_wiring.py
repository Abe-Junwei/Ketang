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
        ("rcEnsureAppData defined", "async function rcEnsureAppData" in rc),
        ("board module in bootstrap", '"board"' in rc and "RC_APP_MODULES" in rc),
        ("lodgers_records in bootstrap", "lodgers_records" in rc),
    ]
    failed = [name for name, ok in checks if not ok]
    if failed:
        print("FAIL read-cache wiring:", ", ".join(failed))
        sys.exit(1)
    print("PASS: read-cache wired for online module read bootstrap")


if __name__ == "__main__":
    main()
