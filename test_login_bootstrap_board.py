#!/usr/bin/env python3
"""G-6: login embeds board read module to save one RTT on first paint."""
import sys
from pathlib import Path


def read(path):
    return Path(path).read_text(encoding="utf-8")


def main():
    login = read("functions/api/v1/auth/login.js")
    auth = read("js/auth.js")
    rc = read("js/read-cache.js")

    checks = [
        ("login wantsBootstrapBoard", "wantsBootstrapBoard" in login),
        ("login buildReadModule", "buildReadModule" in login),
        ("login read_modules", "read_modules" in login),
        ("login read_board_ms stage", "read_board_ms" in login),
        ("auth bootstrap_board", "bootstrap_board: true" in auth),
        ("auth rcApplyLoginBootstrap", "rcApplyLoginBootstrap" in auth),
        ("rc rcHasSeededBoard", "rcHasSeededBoard" in rc),
        ("rc keep seeded on force", "bootstrapOnly && rcHasSeededBoard()" in rc),
        ("rc rcApplyLoginBootstrap", "function rcApplyLoginBootstrap" in rc),
        ("rc seeded mark", "read:board:seeded" in rc),
    ]

    failed = [name for name, ok in checks if not ok]
    if failed:
        print("FAIL login bootstrap board:", ", ".join(failed))
        sys.exit(1)
    print("PASS: login bootstrap board contracts")


if __name__ == "__main__":
    main()
