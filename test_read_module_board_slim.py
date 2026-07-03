#!/usr/bin/env python3
"""read/board 模块首屏瘦身：在住 lodgers + 非净房 housekeeping。"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def main() -> int:
    src = read("functions/_shared/read-modules.js")
    checks = [
        ("board lodgers filter", "moduleKey === \"board\" && table === \"lodgers\"" in src),
        ("board lodgers in-house", "status = '在住'" in src),
        ("board hk filter", "moduleKey === \"board\" && table === \"housekeeping\"" in src),
        ("board hk non-clean", "status != '净房'" in src),
        ("moduleKey passed", "fetchModuleTableRows(env, table, permissions, key)" in src),
    ]
    failed = [name for name, ok in checks if not ok]
    if failed:
        print("FAIL read module board slim:", ", ".join(failed))
        return 1
    print("PASS: read/board payload slim filters")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
