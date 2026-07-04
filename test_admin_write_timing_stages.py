#!/usr/bin/env python3
"""Phase 0/G：admin/records 必须拆分 handler/write_tail/patch 计时；探针走 v1 登录。"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "scripts"))
from admin_write_thresholds import (  # noqa: E402
    WARM_BIZ_MS_P95_MAX,
    WARM_INIT_MS_P95_MAX,
    WARM_PATCH_MS_P95_MAX,
    WARM_WRITE_TAIL_MS_P95_MAX,
)


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
    if "buildLodgerPatchRow" not in admin:
        failed.append("admin-records must build in-memory lodger patch rows")
    rooming = read("functions/_shared/rooming-publish.js")
    if "patchRows: assignPatchRows" not in rooming:
        failed.append("rooming queue checkin must use in-memory patchRows")
    update_lodger = admin.split("async function updateLodgerRecord")[1].split(
        "export async function handleAdminRecord", 1
    )[0]
    if "patchRow: buildLodgerPatchRow" not in update_lodger:
        failed.append("updateLodgerRecord must use patchRow instead of rowId SELECT")
    meals = read("functions/_shared/meals.js")
    if "patchRow:" not in meals or "rowId: lodgerId" in meals:
        failed.append("saveMeals must patch lodger in-memory without rowId SELECT")

    baseline_path = ROOT / "docs/ops/performance-baseline.json"
    baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
    warm = baseline.get("admin_write_warm_ms") or {}
    for key, val in (
        ("init_ms_p95", WARM_INIT_MS_P95_MAX),
        ("biz_ms_p95", WARM_BIZ_MS_P95_MAX),
        ("write_tail_ms_p95", WARM_WRITE_TAIL_MS_P95_MAX),
        ("patch_ms_p95", WARM_PATCH_MS_P95_MAX),
    ):
        if warm.get(key) != val:
            failed.append(f"performance-baseline.json admin_write_warm_ms.{key} must be {val}")
    probe_script = read("test_admin_write_latency.py")
    if "--enforce-thresholds" not in probe_script:
        failed.append("test_admin_write_latency must support --enforce-thresholds")

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
