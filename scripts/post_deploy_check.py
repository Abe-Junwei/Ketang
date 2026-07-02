#!/usr/bin/env python3
"""P1 发布后巡检 | Post-deploy security and health checks."""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

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
        "--allow-access-block",
        action="store_true",
        help="Skip core 200 checks when homepage returns 403 (Cloudflare Access)",
    )
    parser.add_argument(
        "--run-latency",
        action="store_true",
        help="Also run test_prod_latency.py against --base",
    )
    parser.add_argument(
        "--latency-base",
        help="Override base URL for latency probe (e.g. Pages preview domain)",
    )
    parser.add_argument(
        "--write-report",
        help="Optional JSON report path",
    )
    args = parser.parse_args()
    base = args.base.rstrip("/")
    failures: list[str] = []
    warnings: list[str] = []
    report = {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "base": base,
        "blocked": [],
        "core": [],
    }

    print(f"Patrol target: {base}")

    for path in BLOCKED_PATHS:
        status, _ = fetch_status(f"{base}{path}")
        report["blocked"].append({"path": path, "status": status})
        if status not in (403, 404):
            failures.append(f"blocked path {path} returned {status}, expected 403/404")
        else:
            print(f"OK blocked {status} {path}")

    index_status, index_body = fetch_status(f"{base}/index.html")
    report["core"].append({"path": "/index.html", "status": index_status})
    behind_access = index_status == 403

    if index_status != 200:
        if args.allow_access_block and behind_access:
            warnings.append("homepage 403 — assuming Cloudflare Access; skipping core 200 checks")
            print("WARN core checks skipped (Access 403 on /index.html)")
        else:
            failures.append(f"/index.html returned {index_status}")
    else:
        print("OK core 200 /index.html")
        version = extract_db_js_version(index_body)
        if version:
            db_status, _ = fetch_status(f"{base}/js/db.js?v={version}")
            report["core"].append(
                {"path": f"/js/db.js?v={version}", "status": db_status}
            )
            if db_status != 200:
                failures.append(f"/js/db.js?v={version} returned {db_status}")
            else:
                print(f"OK core 200 /js/db.js?v={version}")

        for path in CORE_PATHS[1:]:
            status, _ = fetch_status(f"{base}{path}")
            report["core"].append({"path": path, "status": status})
            if status != 200:
                failures.append(f"{path} returned {status}, expected 200")
            else:
                print(f"OK core 200 {path}")

    if warnings:
        for item in warnings:
            print(f"WARN {item}")

    if failures:
        print("FAIL patrol:")
        for item in failures:
            print(f"  - {item}")
        if args.write_report:
            report["status"] = "fail"
            report["failures"] = failures
            Path(args.write_report).write_text(
                json.dumps(report, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        return 1

    print("OK post-deploy patrol passed")
    report["status"] = "ok"

    if args.run_latency:
        import subprocess

        root = Path(__file__).resolve().parents[1]
        latency_base = (args.latency_base or base).rstrip("/")
        cmd = [
            sys.executable,
            str(root / "test_prod_latency.py"),
            "--base",
            latency_base,
            "--samples",
            "3",
            "--check-baseline",
            str(root / "docs/ops/performance-baseline.json"),
        ]
        proc = subprocess.run(cmd, cwd=str(root), capture_output=True, text=True)
        print(proc.stdout.strip())
        if proc.returncode != 0:
            print(proc.stderr.strip(), file=sys.stderr)
            report["latency_status"] = "fail"
            if args.write_report:
                Path(args.write_report).write_text(
                    json.dumps(report, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
            return proc.returncode
        report["latency_status"] = "ok"
        report["latency_base"] = latency_base

    if args.write_report:
        Path(args.write_report).write_text(
            json.dumps(report, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"Report written: {args.write_report}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
