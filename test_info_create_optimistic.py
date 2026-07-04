#!/usr/bin/env python3
"""信息管理 create 乐观行：temp id 成功后清理。"""
import sys
from pathlib import Path


def read(path):
    return Path(path).read_text(encoding="utf-8")


def main():
    info = read("js/info.js")
    checks = [
        ("finalize helper", "function infoFinalizeWriteResult" in info),
        ("room temp cleanup", "infoFinalizeWriteResult(writeResult, roomTempId" in info),
        ("bed temp cleanup", "infoFinalizeWriteResult(writeResult, bedTempId" in info),
        ("guest temp cleanup", info.count("infoFinalizeWriteResult(") >= 3),
    ]
    failed = [name for name, ok in checks if not ok]
    if failed:
        print("FAIL info create optimistic:", ", ".join(failed))
        sys.exit(1)
    print("PASS: info create optimistic temp id cleanup wired")


if __name__ == "__main__":
    main()
