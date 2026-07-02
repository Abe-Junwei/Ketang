#!/usr/bin/env python3
"""P0 运维脚本静态检查 | Verify P0 ops scripts exist and release build works."""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent

REQUIRED = [
    "scripts/ketang_backup_utils.py",
    "scripts/verify_migration_json.py",
    "scripts/compare_backup_json.py",
    "scripts/verify_release_dir.py",
    "scripts/build_pages_release.sh",
    "scripts/post_deploy_check.py",
    "scripts/run_p0_checklist.sh",
]

missing = [p for p in REQUIRED if not (ROOT / p).exists()]
if missing:
    print("FAIL missing P0 scripts:")
    for p in missing:
        print(" -", p)
    sys.exit(1)

proc = subprocess.run(
    ["bash", str(ROOT / "scripts/build_pages_release.sh")],
    cwd=str(ROOT),
    capture_output=True,
    text=True,
)
if proc.returncode != 0:
    print("FAIL build_pages_release.sh:")
    print(proc.stdout)
    print(proc.stderr)
    sys.exit(1)

if not (ROOT / ".release/functions/_middleware.js").is_file():
    print("FAIL release missing functions/_middleware.js")
    sys.exit(1)

for forbidden in ["docs/roadmap.md", "test_headless.py", "wrangler.toml"]:
    if (ROOT / ".release" / forbidden).exists():
        print(f"FAIL forbidden file in release: {forbidden}")
        sys.exit(1)

print("OK P0 ops scripts")
