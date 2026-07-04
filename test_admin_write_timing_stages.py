#!/usr/bin/env python3
"""Phase 0/G：admin/records 必须拆分 handler/write_tail/patch 计时；探针走 v1 登录。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent

# 结构守门阈值（非线上探针）；与 migration-request-lifecycle.md 过渡目标对齐
WARM_INIT_MS_P95_MAX = 50
WARM_BIZ_MS_P95_MAX = 3000
WARM_WRITE_TAIL_MS_P95_MAX = 800
WARM_PATCH_MS_P95_MAX = 500


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def main() -> int:
    records = read("functions/api/v1/admin/records.js")
    admin = read("functions/_shared/admin-records.js")
    probe = read("test_admin_write_latency.py")
    db_api = read("functions/api/db.js")
    login_v1 = read("functions/api/v1/auth/login.js")
    failed = []

    for key in ("handler_ms", "write_tail_ms", "patch_ms"):
        if f'timer.mark("{key}"' not in records:
            failed.append(f"admin/records missing timer.mark({key})")
    if '"biz_ms"' not in records or "timer.mark(" not in records:
        failed.append("admin/records missing biz_ms aggregate timing")
    if "recordWriteBatch" not in admin or "recordEnrichWrite" not in admin:
        failed.append("admin-records must wrap write tail and patch with timing helpers")
    if "handleAdminRecord(env, session, body, timing)" not in admin:
        failed.append("handleAdminRecord must accept timing object")
    if "/api/v1/auth/login" not in probe:
        failed.append("test_admin_write_latency must login via /api/v1/auth/login")
    if 'action": "login_role"' in probe:
        failed.append("test_admin_write_latency must not use /api/db login_role")
    if "410" not in db_api or "login_role" not in db_api:
        failed.append("db.js must retire login/login_role with 410")
    if "authenticateByRole" not in login_v1 or "authenticateByUsername" not in login_v1:
        failed.append("v1 auth/login must use auth-login helpers")

    doc = read("docs/architecture/migration-request-lifecycle.md")
    if "write_tail_ms" not in doc or "patch_ms" not in doc:
        failed.append("migration-request-lifecycle.md must document sub-stage timing")

    if failed:
        print("FAIL admin write timing stages:")
        for item in failed:
            print(" ", item)
        return 1

    print("PASS: admin write timing stages contract")
    print(
        "thresholds (manual probe): warm init_ms p95<=%s biz_ms p95<=%s "
        "write_tail_ms p95<=%s patch_ms p95<=%s"
        % (
            WARM_INIT_MS_P95_MAX,
            WARM_BIZ_MS_P95_MAX,
            WARM_WRITE_TAIL_MS_P95_MAX,
            WARM_PATCH_MS_P95_MAX,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
