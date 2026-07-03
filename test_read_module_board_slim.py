#!/usr/bin/env python3
"""read/board 模块首屏瘦身：行过滤 + 字段投影（Phase G-3）。"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def main() -> int:
    src = read("functions/_shared/read-modules.js")
    checks = [
        ("board lodgers filter", 'moduleKey === "board" && table === "lodgers"' in src),
        ("board lodgers in-house", "status = '在住'" in src),
        ("board hk filter", 'moduleKey === "board" && table === "housekeeping"' in src),
        ("board hk non-clean", "status != '净房'" in src),
        ("moduleKey passed", "fetchModuleTableRows(env, table, permissions, key)" in src),
        ("board field projection", "BOARD_TABLE_FIELDS" in src),
        ("projectBoardRow", "function projectBoardRow" in src),
        ("projection applied", 'if (key === "board") return projectBoardRow' in src),
        ("rooms dorm_type", '"dorm_type"' in src),
        ("lodgers event_id", '"event_id"' in src),
        ("hk bed_id only", "h.bed_id, h.status, h.changed_at" in src),
    ]
    failed = [name for name, ok in checks if not ok]
    if failed:
        print("FAIL read module board slim:", ", ".join(failed))
        return 1
    print("PASS: read/board payload slim filters + field projection")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
