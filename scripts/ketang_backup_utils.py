#!/usr/bin/env python3
"""JSON 备份校验工具 | Shared backup/migration validation helpers."""
from __future__ import annotations

import json
import random
import sys
from pathlib import Path
from typing import Any

REQUIRED_IMPORT_TABLES = ("users", "rooms", "beds")
KEY_TABLES = (
    "users",
    "rooms",
    "beds",
    "guests",
    "events",
    "lodgers",
    "reservations",
    "meals",
    "payments",
    "housekeeping",
    "audit_logs",
    "schema_version",
    "app_meta",
)
VALID_LODGER_ACTIVE = "在住"


def load_backup(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or "tables" not in payload:
        raise ValueError("备份格式无效：缺少 tables")
    tables = payload["tables"]
    if not isinstance(tables, dict):
        raise ValueError("备份格式无效：tables 必须是对象")
    return payload


def table_counts(tables: dict[str, Any]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for name in KEY_TABLES:
        rows = tables.get(name)
        counts[name] = len(rows) if isinstance(rows, list) else 0
    counts["lodgers_active"] = sum(
        1
        for row in tables.get("lodgers") or []
        if isinstance(row, dict) and (row.get("status") or VALID_LODGER_ACTIVE) == VALID_LODGER_ACTIVE
    )
    counts["beds_assignable"] = sum(
        1
        for row in tables.get("beds") or []
        if isinstance(row, dict) and row.get("status") not in ("维修", "备用")
    )
    return counts


def id_set(rows: list[dict[str, Any]] | None) -> set[str]:
    out: set[str] = set()
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        if row.get("id") is not None:
            out.add(str(row["id"]))
    return out


def validate_backup(payload: dict[str, Any]) -> list[str]:
    """Return list of error messages (empty = OK)."""
    errors: list[str] = []
    tables = payload.get("tables") or {}

    for table in REQUIRED_IMPORT_TABLES:
        rows = tables.get(table)
        if not isinstance(rows, list) or not rows:
            errors.append(f"缺少必需表 {table} 或数据为空")

    users = tables.get("users") or []
    if isinstance(users, list):
        has_admin = any(
            isinstance(u, dict)
            and u.get("role") == "admin"
            and u.get("is_active", 1) != 0
            for u in users
        )
        if not has_admin:
            errors.append("users 必须包含至少一名有效管理员")

    room_ids = id_set(tables.get("rooms"))
    bed_ids = id_set(tables.get("beds"))
    guest_ids = id_set(tables.get("guests"))
    event_ids = id_set(tables.get("events"))
    lodger_ids = id_set(tables.get("lodgers"))
    reservation_ids = id_set(tables.get("reservations"))

    active_by_bed: dict[str, int] = {}
    for index, row in enumerate(tables.get("lodgers") or []):
        if not isinstance(row, dict):
            continue
        if (row.get("status") or VALID_LODGER_ACTIVE) != VALID_LODGER_ACTIVE:
            continue
        bed_id = row.get("bed_id")
        if bed_id is None:
            continue
        key = str(bed_id)
        if key in active_by_bed:
            errors.append(
                f"lodgers 第 {active_by_bed[key] + 1} 行与第 {index + 1} 行重复占用床位 {key}"
            )
        else:
            active_by_bed[key] = index

    for index, row in enumerate(tables.get("beds") or []):
        if not isinstance(row, dict):
            continue
        room_id = row.get("room_id")
        if room_id is not None and str(room_id) not in room_ids:
            errors.append(f"beds 第 {index + 1} 行 room_id {room_id} 不存在")

    for index, row in enumerate(tables.get("lodgers") or []):
        if not isinstance(row, dict):
            continue
        bed_id = row.get("bed_id")
        guest_id = row.get("guest_id")
        event_id = row.get("event_id")
        if bed_id is not None and str(bed_id) not in bed_ids:
            errors.append(f"lodgers 第 {index + 1} 行 bed_id {bed_id} 不存在")
        if guest_id is not None and str(guest_id) not in guest_ids:
            errors.append(f"lodgers 第 {index + 1} 行 guest_id {guest_id} 不存在")
        if event_id is not None and str(event_id) not in event_ids:
            errors.append(f"lodgers 第 {index + 1} 行 event_id {event_id} 不存在")

    for index, row in enumerate(tables.get("reservations") or []):
        if not isinstance(row, dict):
            continue
        guest_id = row.get("guest_id")
        event_id = row.get("event_id")
        if guest_id is not None and str(guest_id) not in guest_ids:
            errors.append(f"reservations 第 {index + 1} 行 guest_id {guest_id} 不存在")
        if event_id is not None and str(event_id) not in event_ids:
            errors.append(f"reservations 第 {index + 1} 行 event_id {event_id} 不存在")

    for index, row in enumerate(tables.get("meals") or []):
        if not isinstance(row, dict):
            continue
        lodger_id = row.get("lodger_id")
        if lodger_id is not None and str(lodger_id) not in lodger_ids:
            errors.append(f"meals 第 {index + 1} 行 lodger_id {lodger_id} 不存在")

    for index, row in enumerate(tables.get("payments") or []):
        if not isinstance(row, dict):
            continue
        lodger_id = row.get("lodger_id")
        reservation_id = row.get("reservation_id")
        if lodger_id is not None and str(lodger_id) not in lodger_ids:
            errors.append(f"payments 第 {index + 1} 行 lodger_id {lodger_id} 不存在")
        if reservation_id is not None and str(reservation_id) not in reservation_ids:
            errors.append(
                f"payments 第 {index + 1} 行 reservation_id {reservation_id} 不存在"
            )

    for index, row in enumerate(tables.get("housekeeping") or []):
        if not isinstance(row, dict):
            continue
        bed_id = row.get("bed_id")
        if bed_id is not None and str(bed_id) not in bed_ids:
            errors.append(f"housekeeping 第 {index + 1} 行 bed_id {bed_id} 不存在")

    schema_rows = tables.get("schema_version") or []
    if not schema_rows:
        errors.append("缺少 schema_version")
    app_meta = tables.get("app_meta") or []
    if not app_meta:
        errors.append("缺少 app_meta")

    return errors


def spot_check_samples(
    tables: dict[str, Any],
    *,
    rooms: int = 10,
    lodgers: int = 20,
    beds: int = 10,
    seed: int = 42,
) -> dict[str, Any]:
    """Return sample rows for manual review."""
    rng = random.Random(seed)
    rooms_rows = [r for r in (tables.get("rooms") or []) if isinstance(r, dict)]
    beds_rows = [r for r in (tables.get("beds") or []) if isinstance(r, dict)]
    lodgers_rows = [
        r
        for r in (tables.get("lodgers") or [])
        if isinstance(r, dict) and (r.get("status") or VALID_LODGER_ACTIVE) == VALID_LODGER_ACTIVE
    ]

    def pick(items: list[dict[str, Any]], n: int) -> list[dict[str, Any]]:
        if not items:
            return []
        if len(items) <= n:
            return items
        return rng.sample(items, n)

    bed_by_id = {str(b.get("id")): b for b in beds_rows if b.get("id") is not None}
    room_by_id = {str(r.get("id")): r for r in rooms_rows if r.get("id") is not None}

    sample_rooms = []
    for room in pick(rooms_rows, rooms):
        rid = str(room.get("id"))
        room_beds = [b for b in beds_rows if str(b.get("room_id")) == rid]
        active = 0
        for lodger in lodgers_rows:
            bed = bed_by_id.get(str(lodger.get("bed_id")))
            if bed and str(bed.get("room_id")) == rid:
                active += 1
        sample_rooms.append(
            {
                "id": room.get("id"),
                "name": room.get("name"),
                "beds": len(room_beds),
                "active_lodgers": active,
            }
        )

    sample_lodgers = []
    for lodger in pick(lodgers_rows, lodgers):
        bed = bed_by_id.get(str(lodger.get("bed_id")), {})
        room = room_by_id.get(str(bed.get("room_id")), {})
        sample_lodgers.append(
            {
                "id": lodger.get("id"),
                "name": lodger.get("name"),
                "bed_id": lodger.get("bed_id"),
                "room": room.get("name"),
                "bed_number": bed.get("bed_number"),
                "check_in_date": lodger.get("check_in_date"),
            }
        )

    sample_beds = []
    for bed in pick(beds_rows, beds):
        room = room_by_id.get(str(bed.get("room_id")), {})
        occupied = any(
            str(l.get("bed_id")) == str(bed.get("id")) for l in lodgers_rows
        )
        sample_beds.append(
            {
                "id": bed.get("id"),
                "room": room.get("name"),
                "bed_number": bed.get("bed_number"),
                "status": bed.get("status"),
                "occupied": occupied,
            }
        )

    return {
        "rooms": sample_rooms,
        "lodgers": sample_lodgers,
        "beds": sample_beds,
    }


def compare_counts(
    left: dict[str, int],
    right: dict[str, int],
    *,
    ignore: set[str] | None = None,
) -> list[str]:
    ignore = ignore or set()
    diffs: list[str] = []
    keys = sorted(set(left) | set(right))
    for key in keys:
        if key in ignore:
            continue
        if left.get(key, 0) != right.get(key, 0):
            diffs.append(f"{key}: {left.get(key, 0)} -> {right.get(key, 0)}")
    return diffs


def print_counts(counts: dict[str, int], title: str) -> None:
    print(title)
    for key in KEY_TABLES:
        print(f"  - {key}: {counts.get(key, 0)}")
    print(f"  - lodgers_active: {counts.get('lodgers_active', 0)}")
    print(f"  - beds_assignable: {counts.get('beds_assignable', 0)}")


def fail(msg: str) -> None:
    print(f"FAIL: {msg}", file=sys.stderr)
