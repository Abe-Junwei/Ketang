#!/usr/bin/env python3
"""P1 发布后巡检 | Post-deploy security and health checks."""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request

BLOCKED_PATHS = [
    "/docs/roadmap.md",
    "/data/ketang-cloud-import.json",
    "/scripts/export_ketang_db_to_json.py",
    "/functions/_middleware.js",
    "/test_headless.py",
    "/wrangler.toml",
    "/README.md",
    "/ketang.db",
]

CORE_PATHS = [
    "/index.html",
    "/styles.css",
    "/js/db.js",
    "/js/app.js",
    "/role-permissions.defaults.json",
]


def fetch_status(url: str, timeout: int = 30) -> tuple[int, str]:
    req = urllib.request.Request(
        url,
        method="GET",
        headers={
            "Accept": "*/*",
            "User-Agent": "KetangPostDeployCheck/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read(512).decode("utf-8", errors="replace")
            return resp.status, body
    except urllib.error.HTTPError as exc:
        body = exc.read(512).decode("utf-8", errors="replace")
        return exc.code, body


def extract_db_js_version(index_html: str) -> str | None:
    match = re.search(r"js/db\.js\?v=(\d+)", index_html)
    return match.group(1) if match else None


def main() -> int:
    parser = argparse.ArgumentParser(description="Post-deploy patrol for Ketang")
    parser.add_argument(
        "--base",
        default="https://wulingkt.net",
        help="Site base URL",
    )
    parser.add_argument(
        "--run-latency",
        action="store_true",
        help="Also run test_prod_latency.py against --base",
    )
    args = parser.parse_args()
    base = args.base.rstrip("/")
    failures: list[str] = []

    print(f"Patrol target: {base}")

    for path in BLOCKED_PATHS:
        status, _ = fetch_status(f"{base}{path}")
        if status not in (403, 404):
            failures.append(f"blocked path {path} returned {status}, expected 403/404")
        else:
            print(f"OK blocked {status} {path}")

    index_status, index_body = fetch_status(f"{base}/index.html")
    if index_status != 200:
        failures.append(f"/index.html returned {index_status}")
    else:
        print("OK core 200 /index.html")
        version = extract_db_js_version(index_body)
        if version:
            db_status, _ = fetch_status(f"{base}/js/db.js?v={version}")
            if db_status != 200:
                failures.append(f"/js/db.js?v={version} returned {db_status}")
            else:
                print(f"OK core 200 /js/db.js?v={version}")

    for path in CORE_PATHS[1:]:
        status, _ = fetch_status(f"{base}{path}")
        if status != 200:
            failures.append(f"{path} returned {status}, expected 200")
        else:
            print(f"OK core 200 {path}")

    if failures:
        print("FAIL patrol:")
        for item in failures:
            print(f"  - {item}")
        return 1

    print("OK post-deploy patrol passed")

    if args.run_latency:
        import subprocess
        from pathlib import Path

        root = Path(__file__).resolve().parents[1]
        proc = subprocess.run(
            [sys.executable, str(root / "test_prod_latency.py"), "--base", base],
            cwd=str(root),
            capture_output=True,
            text=True,
        )
        print(proc.stdout.strip())
        if proc.returncode != 0:
            print(proc.stderr.strip(), file=sys.stderr)
            return proc.returncode

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
