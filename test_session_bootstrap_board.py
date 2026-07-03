#!/usr/bin/env python3
"""G-6: login + session/restore embed board read module (opt-in bootstrap_board)."""
import sys
from pathlib import Path


def read(path):
    return Path(path).read_text(encoding="utf-8")


def main():
    login = read("functions/api/v1/auth/login.js")
    session = read("functions/api/v1/session.js")
    refresh = read("functions/api/v1/auth/refresh.js")
    shared = read("functions/_shared/auth-bootstrap-board.js")
    auth = read("js/auth.js")
    api = read("js/api-client.js")
    rc = read("js/read-cache.js")
    probe = read("test_prod_latency.py")

    checks = [
        ("shared wantsBootstrapBoardFlag", "wantsBootstrapBoardFlag" in shared),
        ("shared buildAuthBootstrapBoardExtra", "buildAuthBootstrapBoardExtra" in shared),
        ("login uses shared", "auth-bootstrap-board" in login),
        ("session bootstrap_board query", "bootstrap_board" in session),
        ("session buildAuthBootstrapBoardExtra", "buildAuthBootstrapBoardExtra" in session),
        ("refresh bootstrap_board body", "bootstrap_board" in refresh),
        ("auth shouldRequestRestoreBootstrapBoard", "shouldRequestRestoreBootstrapBoard" in auth),
        ("auth applyRestoreBootstrapBoard", "applyRestoreBootstrapBoard" in auth),
        ("auth session restore bootstrap", "bootstrapBoard: restoreBootstrap" in auth),
        ("auth no restore kickoff", "rcKickoffBoardBootstrap" not in auth),
        ("api session query", "bootstrap_board=1" in api),
        ("api refresh body", "bootstrap_board: true" in api),
        ("rc rcApplyLoginBootstrap", "function rcApplyLoginBootstrap" in rc),
        ("probe login_bootstrap_ms", "login_bootstrap_ms" in probe),
    ]

    failed = [name for name, ok in checks if not ok]
    if failed:
        print("FAIL session bootstrap board:", ", ".join(failed))
        sys.exit(1)
    print("PASS: session bootstrap board contracts")


if __name__ == "__main__":
    main()
