#!/usr/bin/env python3
"""营期写路径：atomicWriteBatch、完整 patches、批量成员单次 bed 查询。"""
from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def fn_body(src: str, fn_name: str):
    import re

    m = re.search(
        rf"(?:export\s+)?(?:async\s+)?function {re.escape(fn_name)}\(", src
    )
    if not m:
        return None
    start = m.start()
    depth = 0
    i = src.find("{", m.end() - 1)
    if i < 0:
        return None
    while i < len(src):
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth == 0:
                return src[start : i + 1]
        i += 1
    return None


def main() -> None:
    admin = read("functions/_shared/admin-records.js")
    resv = read("functions/_shared/reservations.js")
    sync_meta = read("functions/_shared/sync-meta.js")
    rc = read("js/read-cache.js")
    upsert = fn_body(admin, "upsertEvent") or ""
    batch = fn_body(resv, "apiBatchEventMembers") or ""

    write_resp = read("functions/_shared/write-response.js")
    checks = [
        ("upsert uses atomicWriteBatch", "recordWriteBatch" in upsert or "atomicWriteBatch" in upsert),
        ("upsert audit in batch", "auditLogStatement" in upsert),
        ("create uses last_insert_rowid audit", "useLastInsertRowId" in upsert),
        ("create uses in-memory patchRow", "patchRow: buildEventPatchRow" in upsert),
        ("create single-batch insert", "INSERT INTO events" in upsert and "runD1" not in upsert.split("function buildEventPatchRow")[-1]),
        ("room patchRow helper", "buildRoomPatchRow" in admin),
        ("room create single batch", "useLastInsertRowId" in admin and "buildRoomPatchRow" in admin),
        ("bed create housekeeping batch", "last_insert_rowid()" in admin),
        ("guest patchRow helper", "buildGuestPatchRow" in admin),
        ("upsert cancel lodger patches", "patchRowIds.lodgers" in upsert),
        ("upsert cancel no lodger deletions", "lodgerDeletions" not in upsert),
        ("upsert cancel meal deletions", "fetchMealDeletionsForLodgers" in upsert),
        ("upsert cancel housekeeping patches", "fetchLatestHousekeepingPatches" in upsert),
        ("upsert cancel reservation patches", "patchRowIds.reservations" in upsert),
        ("batch members single IN query", "id IN (" in batch),
        ("batch members lodger patches", "patchRowIds.lodgers" in batch),
        ("batch members meal deletions", "fetchMealDeletionsForLodgers" in batch),
        ("batch members housekeeping", "fetchLatestHousekeepingPatches" in batch),
        ("housekeeping patch helper", "fetchLatestHousekeepingPatches" in write_resp),
        ("meal deletion helper", "fetchMealDeletionsForLodgers" in write_resp),
        ("sync meta schema cached", "_syncMetaReady" in sync_meta),
        (
            "rcApplyWriteResult requires patch_complete",
            "patch_complete === true" in rc
            and "touchBoardVersionFromWrite" in rc,
        ),
        ("enrichWriteResponse patchComplete", "patchComplete" in write_resp),
        (
            "settings room patch_complete",
            'patchComplete: true' in read("functions/_shared/admin-records.js"),
        ),
        (
            "housekeeping patch_complete",
            "patchComplete: true" in read("functions/_shared/housekeeping.js"),
        ),
        (
            "meals patch_complete",
            "patchComplete: true" in read("functions/_shared/meals.js"),
        ),
        (
            "reservations patch_complete",
            "patchComplete: true" in read("functions/_shared/reservations.js"),
        ),
        (
            "lodger finish attaches housekeeping",
            "fetchLatestHousekeepingPatches" in read("functions/_shared/lodgers.js"),
        ),
        (
            "lodger finish patch_complete default",
            "patchComplete: patch.complete !== false"
            in read("functions/_shared/lodgers.js"),
        ),
        (
            "rooming plans patch_complete",
            "patchComplete: true" in read("functions/_shared/rooming-plans.js"),
        ),
        (
            "rooming publish patch_complete",
            "patchComplete: true" in read("functions/_shared/rooming-publish.js"),
        ),
        (
            "queue checkin patch_complete",
            "processRoomingQueueCheckin" in read("functions/_shared/rooming-publish.js")
            and "fetchLatestHousekeepingPatches" in read("functions/_shared/rooming-publish.js"),
        ),
        (
            "delete bed rooming patches",
            "rooming_assignments" in read("functions/_shared/admin-records.js")
            and 'table_name: "housekeeping"' in read("functions/_shared/admin-records.js"),
        ),
        (
            "rc housekeeping delete by bed_id",
            "item.bed_id" in read("js/read-cache.js"),
        ),
        ("rc housekeeping match bed_id", 'table === "housekeeping"' in rc),
        ("rc drop inactive from board", 'moduleKey === "lodgers_active"' in rc),
        (
            "domain events includes event_rooming",
            'events: ["events", "event_rooming"]'
            in read("functions/_shared/sync-modules.js"),
        ),
    ]
    failed = [name for name, ok in checks if not ok]
    if failed:
        print("FAIL event write path:", ", ".join(failed))
        raise SystemExit(1)
    print("PASS: event write path optimizations")


if __name__ == "__main__":
    main()
