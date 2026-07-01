#!/usr/bin/env python3
"""将本地 ketang.db 导出为云端 JSON 备份格式（schema v15）。

用法:
  python3 scripts/export_ketang_db_to_json.py [输入.db] [输出.json]

默认: ketang.db -> data/ketang-cloud-import.json
"""
from __future__ import annotations

import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCHEMA_VERSION = 15
DEFAULT_USERS = [
    {
        'id': 1,
        'username': 'admin',
        'display_name': '管理员',
        'role': 'admin',
        'is_advanced': 0,
        'permissions': None,
        'password': 'sha256$ketang_default_salt$8d62959035f9b60a02e709f9826f3f996d07a09a4f5091e2884642fa01adf8a3',
        'is_active': 1,
        'auth_version': 1,
        'must_change_password': 0,
        'created_at': None,
    },
    {
        'id': 2,
        'username': 'zhike',
        'display_name': '知客师',
        'role': 'zhike',
        'is_advanced': 0,
        'permissions': None,
        'password': 'sha256$ketang_default_salt$fc286955fb12bec3fb16b4f2619f9b675337b1240537bc21d830b5f495121565',
        'is_active': 1,
        'auth_version': 1,
        'must_change_password': 0,
        'created_at': None,
    },
]

EXPORT_TABLES = [
    'users', 'rooms', 'beds', 'guests', 'events', 'lodgers', 'reservations',
    'meals', 'payments', 'housekeeping', 'audit_logs', 'schema_version', 'app_meta',
]

USER_EXPORT_COLUMNS = [
    'id', 'username', 'display_name', 'role', 'is_advanced', 'permissions',
    'password', 'is_active', 'auth_version', 'must_change_password', 'created_at',
]


def table_exists(conn: sqlite3.Connection, name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1", (name,)
    ).fetchone()
    return row is not None


def table_columns(conn: sqlite3.Connection, name: str) -> set[str]:
    return {row[1] for row in conn.execute(f'PRAGMA table_info({name})')}


def fetch_rows(conn: sqlite3.Connection, table: str) -> list[dict]:
    conn.row_factory = sqlite3.Row
    return [dict(row) for row in conn.execute(f'SELECT * FROM {table}')]


def normalize_user_row(row: dict, cols: set[str]) -> dict:
    username = str(row.get('username') or '').strip()
    role = str(row.get('role') or 'zhike').strip() or 'zhike'
    password = row.get('password')
    if not password or not str(password).strip():
        password = DEFAULT_USERS[0]['password'] if username == 'admin' else DEFAULT_USERS[1]['password']
    normalized = {
        'id': row.get('id'),
        'username': username,
        'display_name': row.get('display_name') or username,
        'role': role,
        'is_advanced': row.get('is_advanced', 0) if 'is_advanced' in cols else 0,
        'permissions': row.get('permissions') if 'permissions' in cols else None,
        'password': password,
        'is_active': row.get('is_active', 1) if 'is_active' in cols else 1,
        'auth_version': row.get('auth_version', 1) if 'auth_version' in cols else 1,
        'must_change_password': row.get('must_change_password', 0) if 'must_change_password' in cols else 0,
        'created_at': row.get('created_at'),
    }
    return {key: normalized[key] for key in USER_EXPORT_COLUMNS}


def export_users(conn: sqlite3.Connection) -> list[dict]:
    if not table_exists(conn, 'users'):
        return [dict(row) for row in DEFAULT_USERS]
    cols = table_columns(conn, 'users')
    rows = fetch_rows(conn, 'users')
    if not rows:
        return [dict(row) for row in DEFAULT_USERS]
    users = [normalize_user_row(row, cols) for row in rows if str(row.get('username') or '').strip()]
    if not any(user['role'] == 'admin' and user.get('is_active', 1) != 0 for user in users):
        users.insert(0, dict(DEFAULT_USERS[0]))
    return users


def parse_group_code(code: str | None) -> tuple[str | None, str | None]:
    if not code or not str(code).strip():
        return None, None
    code = str(code).strip()
    sep = code.find('-')
    if sep > 0:
        return code[:sep].strip() or None, code[sep + 1 :].strip() or None
    return code, None


def build_events(conn: sqlite3.Connection) -> tuple[list[dict], dict[str, int], dict[str, str | None]]:
    """从 group_code 生成 events，并返回 event_id / class_name 映射。"""
    codes: set[str] = set()
    for table in ('lodgers', 'reservations'):
        if not table_exists(conn, table):
            continue
        cols = table_columns(conn, table)
        if 'group_code' not in cols:
            continue
        for row in conn.execute(
            f"SELECT DISTINCT group_code FROM {table} WHERE group_code IS NOT NULL AND trim(group_code) != ''"
        ):
            codes.add(row[0])

    events: list[dict] = []
    event_map: dict[str, int] = {}
    class_map: dict[str, str | None] = {}
    next_id = 1
    for code in sorted(codes):
        event_name, class_name = parse_group_code(code)
        class_map[code] = class_name
        if not event_name:
            continue
        if event_name in event_map:
            event_map[code] = event_map[event_name]
            continue
        event_type = '法会' if '法会' in event_name else '禅营'
        events.append({
            'id': next_id,
            'name': event_name,
            'event_type': event_type,
            'gender_type': '混合',
            'expected_count': 0,
            'start_date': None,
            'end_date': None,
            'status': '进行中',
            'notes': f'原团体批次号：{code}',
            'created_at': None,
        })
        event_map[code] = next_id
        event_map[event_name] = next_id
        next_id += 1
    return events, event_map, class_map


def migrate_lodgers(conn: sqlite3.Connection, event_map: dict[str, int], class_map: dict[str, str | None]) -> list[dict]:
    rows = fetch_rows(conn, 'lodgers')
    has_group = 'group_code' in table_columns(conn, 'lodgers')
    out = []
    for row in rows:
        code = row.get('group_code') if has_group else None
        out.append({
            'id': row['id'],
            'guest_id': row.get('guest_id'),
            'event_id': event_map.get(code or '') if code else None,
            'name': row['name'],
            'dharma_name': row.get('dharma_name'),
            'gender': row.get('gender'),
            'phone': row.get('phone'),
            'id_card': row.get('id_card'),
            'check_in_date': row.get('check_in_date'),
            'expected_check_out': row.get('expected_check_out'),
            'actual_check_out': row.get('actual_check_out'),
            'bed_id': row.get('bed_id'),
            'role': row.get('role'),
            'class_name': class_map.get(code or '') if code else row.get('class_name'),
            'status': row.get('status') or '在住',
            'source': row.get('source'),
            'notes': row.get('notes'),
            'meal_default_breakfast': row.get('meal_default_breakfast', 1),
            'meal_default_lunch': row.get('meal_default_lunch', 1),
            'meal_default_dinner': row.get('meal_default_dinner', 1),
            'created_at': row.get('created_at'),
        })
    return out


def migrate_reservations(conn: sqlite3.Connection, event_map: dict[str, int], class_map: dict[str, str | None]) -> list[dict]:
    if not table_exists(conn, 'reservations'):
        return []
    rows = fetch_rows(conn, 'reservations')
    has_group = 'group_code' in table_columns(conn, 'reservations')
    out = []
    for row in rows:
        code = row.get('group_code') if has_group else None
        out.append({
            'id': row['id'],
            'guest_id': row.get('guest_id'),
            'event_id': event_map.get(code or '') if code else row.get('event_id'),
            'name': row['name'],
            'dharma_name': row.get('dharma_name'),
            'gender': row.get('gender'),
            'phone': row.get('phone'),
            'id_card': row.get('id_card'),
            'role': row.get('role'),
            'class_name': class_map.get(code or '') if code else row.get('class_name'),
            'expected_check_in': row.get('expected_check_in'),
            'expected_check_out': row.get('expected_check_out'),
            'room_preference': row.get('room_preference'),
            'source': row.get('source'),
            'status': row.get('status') or '预约',
            'meal_breakfast': row.get('meal_breakfast', 1),
            'meal_lunch': row.get('meal_lunch', 1),
            'meal_dinner': row.get('meal_dinner', 1),
            'notes': row.get('notes'),
            'created_at': row.get('created_at'),
        })
    return out


def export_db(src: Path) -> dict:
    conn = sqlite3.connect(src)
    try:
        events, event_map, class_map = build_events(conn)
        tables: dict[str, list] = {
            'users': export_users(conn),
            'rooms': fetch_rows(conn, 'rooms') if table_exists(conn, 'rooms') else [],
            'beds': fetch_rows(conn, 'beds') if table_exists(conn, 'beds') else [],
            'guests': fetch_rows(conn, 'guests') if table_exists(conn, 'guests') else [],
            'events': events,
            'lodgers': migrate_lodgers(conn, event_map, class_map),
            'reservations': migrate_reservations(conn, event_map, class_map),
            'meals': fetch_rows(conn, 'meals') if table_exists(conn, 'meals') else [],
            'payments': fetch_rows(conn, 'payments') if table_exists(conn, 'payments') else [],
            'housekeeping': fetch_rows(conn, 'housekeeping') if table_exists(conn, 'housekeeping') else [],
            'audit_logs': fetch_rows(conn, 'audit_logs') if table_exists(conn, 'audit_logs') else [],
            'schema_version': [{'version': SCHEMA_VERSION}],
            'app_meta': [{'key': 'board_version', 'value': '0'}],
        }
        return {
            'exported_at': datetime.now(timezone.utc).isoformat(),
            'source': str(src),
            'schema_version': SCHEMA_VERSION,
            'tables': tables,
        }
    finally:
        conn.close()


def main() -> int:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'ketang.db'
    dst = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / 'data' / 'ketang-cloud-import.json'
    if not src.is_file():
        print(f'FAIL: 找不到数据库文件 {src}', file=sys.stderr)
        return 1
    dst.parent.mkdir(parents=True, exist_ok=True)
    payload = export_db(src)
    tables = payload['tables']
    summary = {name: len(tables.get(name) or []) for name in EXPORT_TABLES}
    dst.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'OK: 已导出到 {dst} (schema v{SCHEMA_VERSION})')
    for name in EXPORT_TABLES:
        print(f'  - {name}: {summary[name]}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
