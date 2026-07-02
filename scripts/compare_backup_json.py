#!/usr/bin/env python3
"""P0-2 备份 JSON 对比 | Compare two backup JSON files for restore drill."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from ketang_backup_utils import (  # noqa: E402
    compare_counts,
    fail,
    load_backup,
    print_counts,
    table_counts,
    validate_backup,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Compare two Ketang backup JSON files")
    parser.add_argument("before", help="Baseline JSON (e.g. post-migration export)")
    parser.add_argument("after", help="JSON after restore drill")
    parser.add_argument(
        "--ignore",
        default="audit_logs,app_meta",
        help="Comma-separated count keys to ignore (default: audit_logs,app_meta)",
    )
    args = parser.parse_args()

    before_path = Path(args.before)
    after_path = Path(args.after)
    for path in (before_path, after_path):
        if not path.is_file():
            fail(f"找不到文件 {path}")
            return 1

    try:
        before_payload = load_backup(before_path)
        after_payload = load_backup(after_path)
    except ValueError as exc:
        fail(str(exc))
        return 1

    for label, payload in (("after", after_payload),):
        errors = validate_backup(payload)
        if errors:
            fail(f"{label} 备份校验失败: {errors[0]}")
            return 1

    before_counts = table_counts(before_payload["tables"])
    after_counts = table_counts(after_payload["tables"])
    print_counts(before_counts, f"基线 {before_path.name}")
    print_counts(after_counts, f"恢复后 {after_path.name}")

    ignore = {part.strip() for part in args.ignore.split(",") if part.strip()}
    diffs = compare_counts(before_counts, after_counts, ignore=ignore)
    if diffs:
        print("数量差异：")
        for line in diffs:
            print(f"  - {line}")
        fail("恢复后数量与基线不一致")
        return 1

    print("OK 恢复演练：关键表数量与基线一致")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
