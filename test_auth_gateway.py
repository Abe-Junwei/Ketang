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


def test_session_skips_full_init():
    session = read('functions/api/v1/session.js')
    if 'initRemoteDatabase' in session:
        print('FAIL session.js must not call initRemoteDatabase')
        sys.exit(1)
    if 'createRequestTimer' not in session:
        print('FAIL session.js missing stage timing helper')
        sys.exit(1)


def test_users_action_skips_init():
    db_api = read('functions/api/db.js')
    users_action = re.search(r'if \(payload\.action === "users"\) \{([\s\S]*?)\n    \}', db_api)
    if not users_action:
        print('FAIL api/db.js missing users action')
        sys.exit(1)
    if 'initRemoteDatabase' in users_action.group(1):
        print('FAIL users action must not call initRemoteDatabase')
        sys.exit(1)
    if 'checkMemoryRateLimit' not in users_action.group(1):
        print('FAIL users action must use in-memory rate limit')
        sys.exit(1)


def test_login_action_has_timing():
    db_api = read('functions/api/db.js')
    login_action = re.search(r'if \(payload\.action === "login"\) \{([\s\S]*?)\n    \}', db_api)
    if not login_action:
        print('FAIL api/db.js missing login action')
        sys.exit(1)
    block = login_action.group(1)
    if 'createRequestTimer' not in block or 'buildLoginSuccess' not in block:
        print('FAIL login action must use staged timing and shared login success builder')
        sys.exit(1)


def test_role_permissions_defaults_sync():
    import json
    expected = json.loads((ROOT / 'role-permissions.defaults.json').read_text(encoding='utf-8'))
    backend = read('functions/_shared/permissions.js')
    frontend = read('js/permissions.js')
    if 'role-permissions.defaults.json' not in backend:
        print('FAIL backend permissions must import role-permissions.defaults.json')
        sys.exit(1)
    if 'role-permissions.defaults.json' not in frontend:
        print('FAIL js/permissions.js must load role-permissions.defaults.json')
        sys.exit(1)
    if expected.get('kitchen') != ['meals.read', 'meals.write']:
        print('FAIL kitchen defaults must not include board.read')
        sys.exit(1)


def test_permissions_cache_helpers():
    perms = read('functions/_shared/permissions.js')
    if 'customPermissionsCache' not in perms or 'invalidateRolePermissionsCache' not in perms:
        print('FAIL permissions.js must cache custom role permissions')
        sys.exit(1)
    if 'session._permissions' not in perms:
        print('FAIL getSessionPermissions must cache on session object')
        sys.exit(1)


def test_remote_init_marks_ready_after_existing_db():
    d1 = read('functions/_shared/d1.js')
    if 'remoteInitReady = true' not in d1:
        print('FAIL initRemoteDatabase must mark remoteInitReady when DB already initialized')
        sys.exit(1)


def test_permissions_layer_exists():
    perms = read('functions/_shared/permissions.js')
    if 'requirePermission' not in perms or 'getSessionPermissions' not in perms:
        print('FAIL permissions.js missing core helpers')
        sys.exit(1)
    check_in = read('functions/api/v1/check-in.js')
    if 'requirePermission' not in check_in or 'lodging.checkin' not in check_in:
        print('FAIL check-in.js missing lodging.checkin permission guard')
        sys.exit(1)
    delete_lodger = read('functions/api/v1/delete-lodger.js')
    if 'lodging.edit' not in delete_lodger:
        print('FAIL delete-lodger.js missing lodging.edit permission guard')
        sys.exit(1)
    backup = read('functions/api/v1/admin/data-backup.js')
    if 'backup.read' not in backup or 'backup.write' not in backup:
        print('FAIL data-backup.js missing backup permission guards')
        sys.exit(1)


def test_read_model_role_tables():
    model = read('functions/_shared/read-model.js')
    if 'ROLE_READ_TABLES' not in model or 'sanitizeRowForRole' not in model:
        print('FAIL read-model.js missing role table/filter helpers')
        sys.exit(1)
    tables_block = model.split('READ_MODEL_TABLES = [', 1)[1].split('];', 1)[0]
    if '"users"' in tables_block:
        print('FAIL read-model must not sync users table (password never shipped to client)')
        sys.exit(1)
    if "'payments'" in model and 'kitchen:' in model:
        kitchen_block = re.search(r'kitchen:\s*\[([\s\S]*?)\],', model)
        if not kitchen_block or 'payments' in kitchen_block.group(1):
            print('FAIL kitchen read-model must not include payments')
            sys.exit(1)
    if 'name !== "payments"' not in model or 'zhike:' not in model:
        print('FAIL zhike read-model must exclude payments table')
        sys.exit(1)
    for role in ('kitchen', 'housekeeping', 'viewer'):
        block = re.search(rf"{role}:\s*\[([\s\S]*?)\],", model)
        if block and 'app_meta' in block.group(1):
            print(f'FAIL {role} read-model must not include app_meta')
            sys.exit(1)
    if 'canSyncReadModel' not in model:
        print('FAIL read-model.js missing canSyncReadModel helper')
        sys.exit(1)
    if 'tablesForRole' not in model:
        print('FAIL read-model.js missing tablesForRole export')
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
    if 'getSessionUser(env, request,' not in session_api:
        print('FAIL session.js must pass bound query function to getSessionUser')
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


def test_login_ui_has_no_fake_identity_loading():
    index = read('index.html')
    auth = read('js/auth.js')
    if '正在加载身份' in auth or '正在加载身份' in index:
        print('FAIL login role selector must render fixed identities without fake loading')
        sys.exit(1)
    if 'login-submit-btn' not in index:
        print('FAIL login submit button missing stable id for pending state')
        sys.exit(1)
    if 'setLoginPending' not in auth or '登录中' not in auth or 'aria-busy' not in auth:
        print('FAIL auth.js missing login pending UI state')
        sys.exit(1)


def test_remote_init_cached_for_auth_latency():
    d1 = read('functions/_shared/d1.js')
    if 'remoteInitPromise' not in d1 or 'remoteInitReady' not in d1:
        print('FAIL initRemoteDatabase must cache successful initialization')
        sys.exit(1)
    if 'async function initRemoteDatabaseOnce' not in d1:
        print('FAIL initRemoteDatabase must delegate full setup to one-shot initializer')
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


def test_data_backup_import_hardening():
    backup = read('functions/api/v1/admin/data-backup.js')
    if 'batchD1' not in backup:
        print('FAIL data-backup.js must import with D1 batch writes')
        sys.exit(1)
    if 'BEGIN IMMEDIATE' in backup:
        print('FAIL data-backup.js must not use explicit SQL transactions on D1')
        sys.exit(1)
    if 'validateForeignKeys' not in backup or 'validateBackupCompleteness' not in backup:
        print('FAIL data-backup.js missing import pre-validation helpers')
        sys.exit(1)
    if 'summarizeImport' not in backup:
        print('FAIL data-backup.js missing post-import summary')
        sys.exit(1)
    if 'TABLE_IMPORT_COLUMNS' not in backup:
        print('FAIL data-backup.js missing table column whitelist')
        sys.exit(1)


def test_remote_snapshot_user_password_placeholder():
    db_js = read('js/db.js')
    if 'remote_sync_placeholder' not in db_js:
        print('FAIL db.js must placeholder users.password when applying read-model snapshot')
        sys.exit(1)
    if 'const nextDb = new SQL.Database()' not in db_js:
        print('FAIL db.js applyRemoteSnapshot must build fresh DB before swap')
        sys.exit(1)


def test_login_waits_for_read_model():
    auth = read('js/auth.js')
    login_block = re.search(r'async function submitLogin\(\) \{([\s\S]*?)\n\}', auth)
    if not login_block:
        print('FAIL auth.js missing submitLogin')
        sys.exit(1)
    block = login_block.group(1)
    hide_idx = block.find('hideLoginOverlay()')
    render_idx = block.find('await renderAll()')
    if hide_idx < 0 or render_idx < 0 or hide_idx < render_idx:
        print('FAIL submitLogin must await renderAll before hideLoginOverlay')
        sys.exit(1)


def test_read_model_parallel_and_no_audit_logs():
    model = read('functions/_shared/read-model.js')
    if 'await Promise.all' not in model:
        print('FAIL buildReadModel must query tables in parallel')
        sys.exit(1)
    tables_block = model.split('READ_MODEL_TABLES = [', 1)[1].split('];', 1)[0]
    if 'audit_logs' in tables_block:
        print('FAIL read-model must not sync audit_logs (not queried by frontend)')
        sys.exit(1)


def test_read_model_etag_and_client_304():
    read_model_api = read('functions/api/v1/read-model.js')
    if 'If-None-Match' not in read_model_api or 'status: 304' not in read_model_api:
        print('FAIL read-model endpoint must support If-None-Match / 304')
        sys.exit(1)
    api_client = read('js/api-client.js')
    db_js = read('js/db.js')
    if 'If-None-Match' not in api_client or 'notModified' not in api_client:
        print('FAIL api-client.js must handle read-model 304 responses')
        sys.exit(1)
    if 'payload.notModified' not in db_js:
        print('FAIL db.js syncRemoteReadModel must skip snapshot apply on 304')
        sys.exit(1)


def test_batch_check_in_api():
    batch_api = read('functions/api/v1/batch-check-in.js')
    lodgers = read('functions/_shared/lodgers.js')
    checkin = read('js/checkin.js')
    if 'lodging.checkin' not in batch_api:
        print('FAIL batch-check-in.js missing lodging.checkin permission guard')
        sys.exit(1)
    if 'export async function apiBatchCheckIn' not in lodgers:
        print('FAIL lodgers.js missing apiBatchCheckIn export')
        sys.exit(1)
    if 'apiBatchCheckIn' not in checkin or '云端模式暂不支持 CSV 批量导入' in checkin:
        print('FAIL checkin.js must call apiBatchCheckIn in remote mode')
        sys.exit(1)


def test_login_uses_lightweight_auth_init():
    db_api = read('functions/api/db.js')
    d1 = read('functions/_shared/d1.js')
    if 'ensureDatabaseForAuth' not in d1:
        print('FAIL d1.js missing ensureDatabaseForAuth helper')
        sys.exit(1)
    login_role = re.search(
        r'if \(payload\.action === "login_role"\) \{([\s\S]*?)\n    \}',
        db_api,
    )
    if not login_role or 'ensureDatabaseForAuth' not in login_role.group(1):
        print('FAIL login_role must use ensureDatabaseForAuth instead of full init')
        sys.exit(1)
    login = re.search(
        r'if \(payload\.action === "login"\) \{([\s\S]*?)\n    \}',
        db_api,
    )
    if not login or 'ensureDatabaseForAuth' not in login.group(1):
        print('FAIL login must use ensureDatabaseForAuth instead of full init')
        sys.exit(1)


def test_remote_loaddb_skips_init():
    db_js = read('js/db.js')
    block = re.search(r'async function loadDB\(\) \{([\s\S]*?)^\}', db_js, re.M)
    if not block:
        print('FAIL db.js missing loadDB')
        sys.exit(1)
    remote_part = block.group(1).split('let idb', 1)[0]
    if 'action: "init"' in remote_part or "action: 'init'" in remote_part:
        print('FAIL remote loadDB must not call /api/db init before login')
        sys.exit(1)


def test_login_select_has_static_roles():
    index_html = read('index.html')
    if 'value="admin"' not in index_html or 'value="zhike"' not in index_html:
        print('FAIL login select must include static role options in HTML')
        sys.exit(1)


def test_remote_sync_helpers():
    db_js = read('js/db.js')
    app_js = read('js/app.js')
    index_html = read('index.html')
    if 'function refreshAfterWrite' not in db_js:
        print('FAIL db.js missing refreshAfterWrite helper')
        sys.exit(1)
    if 'function setRemoteSyncStatus' not in db_js:
        print('FAIL db.js missing remote sync status helpers')
        sys.exit(1)
    if 'pollRemoteBoardVersion' not in app_js:
        print('FAIL app.js missing global board version polling')
        sys.exit(1)
    if 'remote-sync-banner' not in index_html:
        print('FAIL index.html missing remote sync banner')
        sys.exit(1)


def test_backup_permissions_on_frontend():
    db_js = read('js/db.js')
    auth = read('js/auth.js')
    if 'requireBackupRead' not in auth or 'requireBackupWrite' not in auth:
        print('FAIL auth.js missing backup permission helpers')
        sys.exit(1)
    if 'requireBackupRead()' not in db_js or 'requireBackupWrite()' not in db_js:
        print('FAIL db.js must gate import/export with backup permissions')
        sys.exit(1)
    if 'resetRemoteReadModelState()' not in db_js or 'syncRemoteReadModel({ force: true })' not in db_js:
        print('FAIL remote import must force read-model resync')
        sys.exit(1)


def test_batch_csv_class_name_binding():
    checkin = read('js/checkin.js')
    if re.search(
        r"class_name, status, source, notes\)\s*\n\s*VALUES \(\?, \?, \?, \?, \?, \?, \?, \?, \?, \?, \?, \?, '在住', '法会批量导入', \?\)",
        checkin,
    ) is None:
        print('FAIL checkin.js batch CSV insert must bind class_name placeholder')
        sys.exit(1)


def test_export_script_reads_users_and_v15():
    script = read('scripts/export_ketang_db_to_json.py')
    if 'export_users' not in script or "SCHEMA_VERSION = 15" not in script:
        print('FAIL export script must read users table and emit schema v15')
        sys.exit(1)
    if "'users': DEFAULT_USERS" in script:
        print('FAIL export script must not always overwrite users with defaults only')
        sys.exit(1)


TESTS = [
    test_upgrade_password_run_signature,
    test_zhike_users_select_blocked,
    test_session_skips_full_init,
    test_users_action_skips_init,
    test_login_action_has_timing,
    test_role_permissions_defaults_sync,
    test_permissions_cache_helpers,
    test_remote_init_marks_ready_after_existing_db,
    test_permissions_layer_exists,
    test_read_model_role_tables,
    test_read_model_parallel_and_no_audit_logs,
    test_read_model_etag_and_client_304,
    test_batch_check_in_api,
    test_login_uses_lightweight_auth_init,
    test_remote_loaddb_skips_init,
    test_login_select_has_static_roles,
    test_remote_sync_helpers,
    test_admin_update_returns_token,
    test_frontend_unauthorized_handler,
    test_session_query_binding,
    test_user_role_migration_guard,
    test_role_login_gateway,
    test_login_ui_has_no_fake_identity_loading,
    test_remote_init_cached_for_auth_latency,
    test_anonymous_users_action_does_not_enumerate_accounts,
    test_data_backup_import_hardening,
    test_remote_snapshot_user_password_placeholder,
    test_login_waits_for_read_model,
    test_backup_permissions_on_frontend,
    test_batch_csv_class_name_binding,
    test_export_script_reads_users_and_v15,
]

for test in TESTS:
    test()

print('OK auth gateway checks passed')
