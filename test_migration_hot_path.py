#!/usr/bin/env python3
"""生产热路径不得做 migration discovery（PRAGMA / 逐列自愈）。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def main() -> None:
    d1 = read("functions/_shared/d1.js")
    records = read("functions/api/v1/admin/records.js")
    write_resp = read("functions/_shared/write-response.js")
    sync_meta = read("functions/_shared/sync-meta.js")
    migrate = read("functions/api/v1/admin/migrate.js")

    failed = []

    if "export async function ensureDatabaseReady" not in d1:
        failed.append("missing ensureDatabaseReady")
    if "schema_ready_version" not in d1:
        failed.append("missing schema_ready_version gate")
    if "markSchemaReadyInMemory" not in d1:
        failed.append("missing markSchemaReadyInMemory")

    light = d1.split("async function ensureDatabaseForAuthLight")[1].split(
        "async function "
    )[0]
    if "ensureSyncMetaSchema" in light or "ensureRowSyncSchema" in light:
        failed.append("light path still runs schema ensures")
    if "PRAGMA table_info" in light:
        failed.append("light path contains PRAGMA")

    probe = d1.split("async function probeProductionDatabaseReady")[1].split(
        "async function "
    )[0]
    if "PRAGMA table_info" in probe:
        failed.append("ready probe must not use PRAGMA")
    if "schema_ready_version" not in probe and "SCHEMA_READY_KEY" not in probe:
        failed.append("ready probe must read schema_ready_version")

    if "ensureDatabaseReady" not in records:
        failed.append("admin/records must use ensureDatabaseReady")
    if "initRemoteDatabase(env)" in records:
        failed.append("admin/records must not call initRemoteDatabase directly")
    if "allowMigrationFallback: false" not in records:
        failed.append("admin/records must disable migration fallback")

    if "batchLogSyncMeta" not in write_resp:
        failed.append("write-response must batch sync meta logs")
    if "batchLogSyncMeta" not in sync_meta:
        failed.append("sync-meta missing batchLogSyncMeta")

    if "allowMigrationFallback: true" not in migrate:
        failed.append("admin/migrate must allow migration fallback")

    # Business entrypoints should prefer ensureDatabaseReady
    for path in [
        "functions/api/v1/admin/users.js",
        "functions/api/v1/admin/rooming-plans.js",
        "functions/api/v1/read-model.js",
        "functions/api/v1/sync/delta.js",
        "functions/api/public/reservations.js",
    ]:
        src = read(path)
        if "ensureDatabaseReady" not in src:
            failed.append(f"{path} missing ensureDatabaseReady")

    if failed:
        print("FAIL migration hot path:", ", ".join(failed))
        raise SystemExit(1)
    print("PASS: migration hot path guards")


if __name__ == "__main__":
    main()
