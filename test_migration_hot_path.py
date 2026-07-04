#!/usr/bin/env python3
"""生产热路径不得做 migration discovery（PRAGMA / 逐列自愈）。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent

WRITE_API_PATHS = [
    "functions/api/v1/check-in.js",
    "functions/api/v1/checkout.js",
    "functions/api/v1/extend-stay.js",
    "functions/api/v1/change-bed.js",
    "functions/api/v1/assign-bed.js",
    "functions/api/v1/edit-lodger.js",
    "functions/api/v1/delete-lodger.js",
    "functions/api/v1/batch-check-in.js",
    "functions/api/v1/batch-event-members.js",
    "functions/api/v1/save-meals.js",
    "functions/api/v1/set-house-status.js",
    "functions/api/v1/upsert-reservation.js",
    "functions/api/v1/reservation-status.js",
    "functions/api/public/reservations.js",
    "functions/api/v1/admin/records.js",
    "functions/api/v1/admin/users.js",
    "functions/api/v1/admin/rooming-plans.js",
    "functions/api/v1/admin/operational-settings.js",
    "functions/api/v1/admin/role-permissions.js",
    "functions/api/v1/read-model.js",
    "functions/api/v1/sync/delta.js",
]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def main() -> None:
    d1 = read("functions/_shared/d1.js")
    records = read("functions/api/v1/admin/records.js")
    write_resp = read("functions/_shared/write-response.js")
    sync_meta = read("functions/_shared/sync-meta.js")
    migrate = read("functions/api/v1/admin/migrate.js")
    admin = read("functions/_shared/admin-records.js")
    lodgers = read("functions/_shared/lodgers.js")
    info = read("js/info.js")

    failed = []

    if "export async function ensureDatabaseReady" not in d1:
        failed.append("missing ensureDatabaseReady")
    if "export async function ensureBusinessDatabaseReady" not in d1:
        failed.append("missing ensureBusinessDatabaseReady")
    if "bumpBoardVersion" in d1:
        failed.append("bumpBoardVersion should be removed (use write batch bump)")
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

    if "syncMetaStatementsFromMeta" not in write_resp:
        failed.append("write-response must use syncMetaStatementsFromMeta")
    if "BOARD_VERSION_SELECT_SQL" not in write_resp:
        failed.append("write-response must read board_version in write batch")
    if "isInsertStatement" not in write_resp:
        failed.append("atomicWriteBatch must guard last_row_id to INSERT only")
    if "syncMetaStatementsFromMeta" not in sync_meta:
        failed.append("sync-meta missing syncMetaStatementsFromMeta")
    if "patchRow" not in write_resp:
        failed.append("enrichWriteResponse must accept in-memory patchRow")
    if "finishWrite" not in write_resp or "deletion" not in write_resp.split(
        "export async function finishWrite", 1
    )[1].split("export async function enrichWriteResponse", 1)[0]:
        failed.append("finishWrite must accept optional deletion")

    if "allowMigrationFallback: true" not in migrate:
        failed.append("admin/migrate must allow migration fallback")

    for path in WRITE_API_PATHS:
        src = read(path)
        if path.startswith("functions/api/v1/admin/migrate"):
            continue
        if "ensureBusinessDatabaseReady" not in src and "ensureDatabaseReady" not in src:
            failed.append(f"{path} missing database ready gate")
        if "allowMigrationFallback: true" in src and "data-backup" not in path:
            failed.append(f"{path} must not allow migration fallback on business path")

    for path in WRITE_API_PATHS:
        if path.startswith("functions/api/v1/admin/data-backup"):
            continue
        src = read(path)
        if "onRequestPost" in src and "ensureBusinessDatabaseReady(env)" not in src:
            if not (
                "ensureDatabaseReady(env, { allowMigrationFallback: false })"
                in src
            ):
                failed.append(f"{path} POST must call ensureBusinessDatabaseReady")

    if "buildRoomPatchRow" not in admin:
        failed.append("admin-records missing buildRoomPatchRow")
    if "patchRow: buildRoomPatchRow" not in admin:
        failed.append("room upsert must use in-memory patchRow")
    if admin.count("useLastInsertRowId") < 2:
        failed.append("settings create should batch audit with last_insert_rowid")

    if "recordSyncDeletion" in lodgers:
        failed.append("lodgers delete must not call recordSyncDeletion separately")

    if "infoFinalizeWriteResult" not in info:
        failed.append("info.js missing infoFinalizeWriteResult")
    if info.count("infoFinalizeWriteResult(writeResult") < 3:
        failed.append("info create paths must finalize optimistic temp ids")

    event_read = read("functions/api/v1/read/event/[id].js")
    if "skipInit: true" in event_read:
        failed.append("read/event detail must not skip database ready gate")

    if failed:
        print("FAIL migration hot path:", ", ".join(failed))
        raise SystemExit(1)
    print("PASS: migration hot path guards")


if __name__ == "__main__":
    main()
