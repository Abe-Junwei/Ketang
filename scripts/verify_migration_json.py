#!/usr/bin/env python3
"""P0-1 迁移 JSON 导入前校验 | Pre-import migration verification."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from ketang_backup_utils import (  # noqa: E402
    fail,
    load_backup,
    print_counts,
    spot_check_samples,
    table_counts,
    validate_backup,
)

DEFAULT_EXPECT = {
    "rooms": 64,
    "beds": 522,
    "lodgers_active": 311,
}


def load_expect(path: Path | None) -> dict[str, int]:
    if path is None:
        return dict(DEFAULT_EXPECT)
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("期望数量文件必须是 JSON 对象")
    return {str(k): int(v) for k, v in data.items()}


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify Ketang cloud import JSON")
    parser.add_argument(
        "json_path",
        nargs="?",
        default=str(ROOT / "data" / "ketang-cloud-import.json"),
        help="Migration JSON path",
    )
    parser.add_argument(
        "--expect",
        help="Optional JSON file with expected table counts",
    )
    parser.add_argument(
        "--strict-expect",
        action="store_true",
        help="Fail when counts differ from --expect defaults/file",
    )
    parser.add_argument(
        "--samples-out",
        help="Write spot-check samples JSON for manual review",
    )
    args = parser.parse_args()

    path = Path(args.json_path)
    if not path.is_file():
        fail(f"找不到文件 {path}")
        return 1

    try:
        payload = load_backup(path)
    except ValueError as exc:
        fail(str(exc))
        return 1

    errors = validate_backup(payload)
    if errors:
        print("校验失败：")
        for item in errors[:20]:
            print(f"  - {item}")
        if len(errors) > 20:
            print(f"  ... 另有 {len(errors) - 20} 项")
        return 1

    counts = table_counts(payload["tables"])
    print_counts(counts, f"OK 结构校验通过: {path.name}")
    print(f"  schema_version: {payload.get('schema_version')}")
    print(f"  exported_at: {payload.get('exported_at')}")

    expect_path = Path(args.expect) if args.expect else None
    expect = load_expect(expect_path)
    mismatches = []
    for key, expected in expect.items():
        actual = counts.get(key, 0)
        if actual != expected:
            mismatches.append(f"{key}: 期望 {expected}, 实际 {actual}")
    if mismatches:
        print("数量对照（与期望差异）：")
        for line in mismatches:
            print(f"  - {line}")
        if args.strict_expect:
            fail("关键数量与期望不一致")
            return 1
    else:
        print("数量对照：与期望一致")

    samples = spot_check_samples(payload["tables"])
    if args.samples_out:
        out = Path(args.samples_out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(samples, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"抽查样本已写入 {out}")
    else:
        print("抽查样本（导入后请人工核对）：")
        print(json.dumps(samples, ensure_ascii=False, indent=2))

    print("下一步：")
    print("  1. 在线「系统设置 → 从 JSON 恢复数据」导入此文件")
    print("  2. 导入后立即导出基线 JSON")
    print("  3. python3 scripts/post_deploy_check.py --base https://wulingkt.net")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
