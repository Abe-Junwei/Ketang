#!/usr/bin/env python3
"""客户端不得再调用 POST /api/db | Client must not reference legacy /api/db."""
import sys
from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def main() -> int:
    failed = []
    js = read("js/api-client.js")
    if "/api/db" in js:
        failed.append("api-client.js still references /api/db")
    if "remoteDBRequestAsync" in js:
        failed.append("api-client.js still defines remoteDBRequestAsync")

    for rel in sorted(Path("js").glob("*.js")):
        text = rel.read_text(encoding="utf-8")
        if "/api/db" in text:
            failed.append(f"{rel} references /api/db")

    db_api = read("functions/api/db.js")
    if "410" not in db_api:
        failed.append("functions/api/db.js must return 410")
    if 'payload.action === "init"' in db_api:
        failed.append("functions/api/db.js must not handle init inline")
    if 'payload.action === "users"' in db_api:
        failed.append("functions/api/db.js must not handle users inline")

    wr = read("functions/_shared/write-response.js")
    if "patchRowIds" in wr:
        failed.append("write-response.js must not retain patchRowIds fallback")
    if "options.rowId" in wr:
        failed.append("write-response.js must not retain rowId SELECT fallback")

    shim = read("js/read-shim.js")
    if "function readLocalQuery" not in shim:
        failed.append("read-shim.js missing readLocalQuery helper")
    if "useOnlineDataPath()" not in shim.split("function readUseRc")[1].split("}")[0]:
        failed.append("readUseRc must gate on useOnlineDataPath()")

    if failed:
        print("FAIL no-api-db / cleanup guards:")
        for item in failed:
            print(" ", item)
        return 1
    print("PASS: legacy /api/db retired; write/read cleanup guards")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
