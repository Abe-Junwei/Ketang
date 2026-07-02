#!/usr/bin/env python3
"""静态检查线上 API 文件是否齐全 | Verify online API file structure."""
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
REQUIRED = [
    '_headers',
    '_routes.json',
    'functions/_middleware.js',
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
    'functions/_shared/permissions.js',
    'functions/_shared/timing.js',
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
    'functions/api/v1/batch-check-in.js',
    'functions/api/v1/board-version.js',
    'functions/api/v1/read-model.js',
    'functions/_shared/reservations.js',
    'functions/api/v1/session.js',
    'functions/api/v1/admin/users.js',
    'functions/api/v1/admin/records.js',
    'functions/api/public/reservations.js',
    'js/api-client.js',
    'js/permissions.js',
    'role-permissions.defaults.json',
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
if 'permissions.js' not in index:
    print('FAIL index.html missing permissions.js script')
    sys.exit(1)

schema = (ROOT / 'functions/_shared/schema.js').read_text(encoding='utf-8')
if 'PRAGMA foreign_keys' in schema:
    print('FAIL remote D1 schema must not include PRAGMA foreign_keys')
    sys.exit(1)

d1 = (ROOT / 'functions/_shared/d1.js').read_text(encoding='utf-8')
if 'KETANG_DB.exec(SCHEMA_SQL)' in d1:
    print('FAIL remote D1 schema must run statements individually')
    sys.exit(1)

middleware = (ROOT / 'functions/_middleware.js').read_text(encoding='utf-8')
for path in [
    '/docs/*',
    '/backup/*',
    '/data/*',
    '/functions/*',
    '/_headers',
    '/_routes.json',
    '/.gitignore',
    '/package.json',
    '/wrangler.toml',
    '/test_cdp.py',
    '/ketang.db',
]:
    path_token = path[:-1] if path.endswith('*') else path
    if path_token not in middleware:
        print('FAIL functions/_middleware.js missing public-surface block for %s' % path)
        sys.exit(1)

if 'status: 404' not in middleware or 'context.next()' not in middleware:
    print('FAIL functions/_middleware.js must 404 blocked paths and continue allowed paths')
    sys.exit(1)

if 'globalThis.URL' not in middleware:
    print('FAIL functions/_middleware.js must use globalThis.URL for ESLint-safe URL parsing')
    sys.exit(1)

headers = (ROOT / '_headers').read_text(encoding='utf-8')
for header in [
    'X-Frame-Options: DENY',
    'X-Content-Type-Options: nosniff',
    'Referrer-Policy: no-referrer',
    'Permissions-Policy:',
]:
    if header not in headers:
        print('FAIL _headers missing security header %s' % header)
        sys.exit(1)

routes = json.loads((ROOT / '_routes.json').read_text(encoding='utf-8'))
if routes.get('version') != 1:
    print('FAIL _routes.json version must be 1')
    sys.exit(1)
if routes.get('include') != ['/*']:
    print('FAIL _routes.json must include ["/*"] to route all requests through middleware')
    sys.exit(1)
if routes.get('exclude') != []:
    print('FAIL _routes.json must not exclude any paths from middleware')
    sys.exit(1)

print('OK online API structure (%d files)' % len(REQUIRED))
