#!/usr/bin/env python3
"""静态检查线上 API 文件是否齐全 | Verify online API file structure."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
REQUIRED = [
    'functions/_shared/http.js',
    'functions/_shared/schema.js',
    'functions/_shared/auth.js',
    'functions/_shared/password.js',
    'functions/_shared/d1.js',
    'functions/_shared/person.js',
    'functions/_shared/rate-limit.js',
    'functions/_shared/lodgers.js',
    'functions/_shared/meals.js',
    'functions/_shared/housekeeping.js',
    'functions/_shared/users.js',
    'functions/_shared/admin-records.js',
    'functions/_shared/read-model.js',
    'functions/_shared/password.js',
    'functions/api/db.js',
    'functions/api/v1/check-in.js',
    'functions/api/v1/checkout.js',
    'functions/api/v1/change-bed.js',
    'functions/api/v1/extend-stay.js',
    'functions/api/v1/assign-bed.js',
    'functions/api/v1/edit-lodger.js',
    'functions/api/v1/delete-lodger.js',
    'functions/api/v1/save-meals.js',
    'functions/api/v1/set-house-status.js',
    'functions/api/v1/upsert-reservation.js',
    'functions/api/v1/reservation-status.js',
    'functions/api/v1/batch-event-members.js',
    'functions/api/v1/board-version.js',
    'functions/api/v1/read-model.js',
    'functions/_shared/reservations.js',
    'functions/api/v1/session.js',
    'functions/api/v1/admin/users.js',
    'functions/api/v1/admin/records.js',
    'functions/api/public/reservations.js',
    'js/api-client.js',
    'wrangler.toml',
]

missing = [p for p in REQUIRED if not (ROOT / p).exists()]
if missing:
    print('FAIL missing files:')
    for p in missing:
        print(' -', p)
    sys.exit(1)

index = (ROOT / 'index.html').read_text(encoding='utf-8')
if 'api-client.js' not in index:
    print('FAIL index.html missing api-client.js script')
    sys.exit(1)

schema = (ROOT / 'functions/_shared/schema.js').read_text(encoding='utf-8')
if 'PRAGMA foreign_keys' in schema:
    print('FAIL remote D1 schema must not include PRAGMA foreign_keys')
    sys.exit(1)

d1 = (ROOT / 'functions/_shared/d1.js').read_text(encoding='utf-8')
if 'KETANG_DB.exec(SCHEMA_SQL)' in d1:
    print('FAIL remote D1 schema must run statements individually')
    sys.exit(1)

print('OK online API structure (%d files)' % len(REQUIRED))
