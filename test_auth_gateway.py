#!/usr/bin/env python3
"""认证与 SQL 网关静态检查 | Auth and SQL gateway static checks."""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parent


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding='utf-8')


def test_upgrade_password_run_signature():
    auth = read('functions/_shared/auth.js')
    if re.search(r"await runD1\(env,\s*'UPDATE users SET password", auth):
        print('FAIL upgradePasswordHashIfLegacy still calls runD1(env, ...)')
        sys.exit(1)


def test_zhike_users_select_blocked():
    d1 = read('functions/_shared/d1.js')
    if '不允许查询用户表' not in d1:
        print('FAIL missing zhike users table block')
        sys.exit(1)
    if not re.search(r"isQuery\)[\s\S]*\\busers\\b", d1):
        print('FAIL zhike users regex guard not found after isQuery branch')
        sys.exit(1)


def test_session_init_migration():
    session = read('functions/api/v1/session.js')
    if 'initRemoteDatabase' not in session:
        print('FAIL session.js missing initRemoteDatabase')
        sys.exit(1)


def test_admin_update_returns_token():
    users_api = read('functions/api/v1/admin/users.js')
    users_shared = read('functions/_shared/users.js')
    if 'signSession' not in users_api:
        print('FAIL admin/users.js missing signSession on update')
        sys.exit(1)
    if 'result.user' not in users_shared:
        print('FAIL users.js updateUser missing result.user for self password change')
        sys.exit(1)


def test_frontend_unauthorized_handler():
    api_client = read('js/api-client.js')
    auth = read('js/auth.js')
    if 'handleApiUnauthorized' not in api_client:
        print('FAIL api-client.js missing handleApiUnauthorized')
        sys.exit(1)
    if 'function handleApiUnauthorized' not in auth:
        print('FAIL auth.js missing handleApiUnauthorized')
        sys.exit(1)
    if 'window._ketang_last_login_password' in auth:
        print('FAIL auth.js still uses window._ketang_last_login_password')
        sys.exit(1)


def test_session_query_binding():
    session_api = read('functions/api/v1/session.js')
    users_shared = read('functions/_shared/users.js')
    if 'getSessionUser(env, request, queryD1)' not in session_api:
        print('FAIL session.js must pass raw queryD1 to getSessionUser')
        sys.exit(1)
    if 'verifySession(request, env, (sql, params)' not in users_shared:
        print('FAIL getSessionUser must bind env before verifySession')
        sys.exit(1)


def test_user_role_migration_guard():
    d1 = read('functions/_shared/d1.js')
    if "ddl.includes(\"'admin','zhike'\") && !ddl.includes(\"'kitchen'\")" not in d1:
        print('FAIL d1.js user role migration guard too broad (runs every init)')
        sys.exit(1)
    if 'repairUsersTableState' not in d1:
        print('FAIL d1.js missing repairUsersTableState')
        sys.exit(1)


def test_role_login_gateway():
    db_api = read('functions/api/db.js')
    auth = read('js/auth.js')
    if 'payload.action === "login_role"' not in db_api:
        print('FAIL api/db.js missing login_role action')
        sys.exit(1)
    if 'action: "login_role"' not in auth or 'loginByRole' not in auth:
        print('FAIL auth.js missing role-based login call')
        sys.exit(1)
    if 'upgradePasswordHashBestEffort' not in db_api:
        print('FAIL api/db.js login must not fail when legacy hash upgrade fails')
        sys.exit(1)
    if 'requireSession(request, env, bindQuery)' in db_api:
        print('FAIL api/db.js passes bindQuery factory instead of bound query function')
        sys.exit(1)


def test_anonymous_users_action_does_not_enumerate_accounts():
    db_api = read('functions/api/db.js')
    users_action = re.search(r'if \(payload\.action === "users"\) \{([\s\S]*?)\n    \}', db_api)
    if not users_action:
        print('FAIL api/db.js missing users action')
        sys.exit(1)
    if 'FROM users' in users_action.group(1):
        print('FAIL anonymous users action still queries real user accounts')
        sys.exit(1)


TESTS = [
    test_upgrade_password_run_signature,
    test_zhike_users_select_blocked,
    test_session_init_migration,
    test_admin_update_returns_token,
    test_frontend_unauthorized_handler,
    test_session_query_binding,
    test_user_role_migration_guard,
    test_role_login_gateway,
    test_anonymous_users_action_does_not_enumerate_accounts,
]

for test in TESTS:
    test()

print('OK auth gateway checks passed')
