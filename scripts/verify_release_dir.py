#!/usr/bin/env python3
"""P0-3 发布目录白名单扫描 | Scan Pages release output for forbidden paths."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

FORBIDDEN_PREFIXES = (
    "docs/",
    "data/",
    "backup/",
    "scripts/",
    "node_modules/",
    ".git/",
    ".github/",
    ".wrangler/",
    "lib/sql-wasm",
)

FORBIDDEN_NAMES = {
    "ketang.db",
    "wrangler.toml",
    "package.json",
    "package-lock.json",
    "README.md",
    "AGENTS.md",
    "AI_QUICKSTART.md",
    "eslint.config.mjs",
    "test_api_structure.py",
    "test_auth_gateway.py",
    "test_headless.py",
    "test_cdp.py",
    "test_prod_latency.py",
}

REQUIRED_PATHS = (
    "index.html",
    "styles.css",
    "_headers",
    "_routes.json",
    "role-permissions.defaults.json",
    "js/db.js",
    "js/app.js",
    "js/api-client.js",
    "functions/_middleware.js",
    "functions/api/db.js",
    "functions/api/v1/read-model.js",
)


def scan_release(root: Path) -> tuple[list[str], list[str]]:
    missing: list[str] = []
    forbidden: list[str] = []

    for rel in REQUIRED_PATHS:
        if not (root / rel).exists():
            missing.append(rel)

    for path in root.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(root).as_posix()
        name = path.name
        if name in FORBIDDEN_NAMES:
            forbidden.append(rel)
            continue
        for prefix in FORBIDDEN_PREFIXES:
            if rel.startswith(prefix) or f"/{prefix}" in f"/{rel}/":
                forbidden.append(rel)
                break
        if rel.startswith("test_") and rel.endswith(".py"):
            forbidden.append(rel)

    return missing, sorted(set(forbidden))


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify Ketang Pages release directory")
    parser.add_argument(
        "release_dir",
        nargs="?",
        default=str(Path(__file__).resolve().parents[1] / ".release"),
        help="Release directory to scan",
    )
    args = parser.parse_args()
    root = Path(args.release_dir)
    if not root.is_dir():
        print(f"FAIL: 发布目录不存在 {root}", file=sys.stderr)
        return 1

    missing, forbidden = scan_release(root)
    if missing:
        print("缺少必需文件：")
        for item in missing:
            print(f"  - {item}")
        return 1
    if forbidden:
        print("发现禁止发布的文件：")
        for item in forbidden:
            print(f"  - {item}")
        return 1

    file_count = sum(1 for path in root.rglob("*") if path.is_file())
    print(f"OK release directory verified ({file_count} files) -> {root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
