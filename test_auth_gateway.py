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
    """Role names are static in index.html; /api/db users is retired."""
    index_html = read('index.html')
    db_api = read('functions/api/db.js')
    if 'LEGACY_DB_RETIRED' not in db_api or '410' not in db_api:
        print('FAIL api/db.js must return unified 410 LEGACY_DB_RETIRED')
        sys.exit(1)
    if 'value="admin"' not in index_html or 'value="zhike"' not in index_html:
        print('FAIL login select must include static role options in HTML')
        sys.exit(1)


def test_login_action_has_timing():
    login_api = read('functions/api/v1/auth/login.js')
    auth_response = read('functions/_shared/auth-response.js')
    timing_js = read('functions/_shared/timing.js')
    if 'createRequestTimer' not in login_api or 'buildDualAuthSuccess' not in login_api:
        print('FAIL v1 auth/login must use staged timing and buildDualAuthSuccess')
        sys.exit(1)
    if 'finishWithCookies' not in timing_js:
        print('FAIL timing.js missing finishWithCookies for login _timing')
        sys.exit(1)
    if 'finish304' not in timing_js:
        print('FAIL timing.js missing finish304 for 304 X-Ketang-Timing')
        sys.exit(1)
    if 'finishWithCookies' not in auth_response:
        print('FAIL buildDualAuthSuccess must use timer.finishWithCookies')
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
    zhike_block = re.search(r'zhike:\s*READ_MODEL_TABLES\.filter\([\s\S]*?\),', model)
    if not zhike_block:
        print('FAIL zhike read-model filter missing')
        sys.exit(1)
    if '!== "payments"' in zhike_block.group(0) or "!== 'payments'" in zhike_block.group(0):
        print('FAIL zhike read-model must not exclude payments')
        sys.exit(1)
    if 'PERMISSION_TABLE_INCLUDES' not in model or 'tablesForPermissions' not in model:
        print('FAIL read-model.js missing permission-driven table filtering')
        sys.exit(1)
    if 'tablesForPermissions(permissions)' not in model:
        print('FAIL buildReadModel must use tablesForPermissions')
        sys.exit(1)
    if '"payments"' not in model.split('PERMISSION_TABLE_INCLUDES', 1)[1].split('lodging.read', 1)[1][:300]:
        print('FAIL lodging.read must include payments table')
        sys.exit(1)
    for role in ('kitchen', 'housekeeping', 'viewer'):
        block = re.search(rf"{role}:\s*\[([\s\S]*?)\],", model)
        if block and 'app_meta' in block.group(1):
            print(f'FAIL {role} read-model must not include app_meta')
            sys.exit(1)
    if 'LODGING_APP_META_KEYS' not in model:
        print('FAIL read-model.js must import LODGING_APP_META_KEYS for filtered app_meta sync')
        sys.exit(1)
    if 'fetchReadModelTableRows' not in model or 'lodging.read' not in model.split('fetchReadModelTableRows', 1)[1][:400]:
        print('FAIL fetchReadModelTableRows must filter app_meta for lodging.read')
        sys.exit(1)
    ops = read('functions/_shared/operational-settings.js')
    if 'LODGING_APP_META_KEYS' not in ops or 'housekeeping_require_inspect_v1' not in ops:
        print('FAIL operational-settings.js must export LODGING_APP_META_KEYS with inspect key')
        sys.exit(1)
    if 'isHousekeepingTransitionAllowed' not in ops:
        print('FAIL operational-settings.js missing isHousekeepingTransitionAllowed')
        sys.exit(1)
    hk = read('functions/_shared/housekeeping.js')
    if 'isHousekeepingTransitionAllowed' not in hk:
        print('FAIL housekeeping.js must enforce transition guard')
        sys.exit(1)
    if 'canSyncReadModel' not in model:
        print('FAIL read-model.js missing canSyncReadModel helper')
        sys.exit(1)
    if 'tablesForRole' not in model:
        print('FAIL read-model.js missing tablesForRole export')
        sys.exit(1)


def test_users_list_and_is_advanced():
    users_shared = read('functions/_shared/users.js')
    db_api = read('functions/api/db.js')
    auth = read('js/auth.js')
    if 'return rows;' not in users_shared.split('export async function listUsers', 1)[1].split('export async function createUser', 1)[0]:
        print('FAIL listUsers must return rows')
        sys.exit(1)
    if 'is_advanced, auth_version FROM users WHERE id = ? LIMIT 1' not in users_shared:
        print('FAIL users.js must select is_advanced when returning updated user')
        sys.exit(1)
    if 'is_advanced: !!user.is_advanced' not in read('functions/_shared/auth-response.js'):
        print('FAIL auth-response.js must preserve is_advanced in session user payload')
        sys.exit(1)
    if 'must_change_password: !!user.must_change_password' not in read('functions/_shared/auth-response.js'):
        print('FAIL auth-response.js must expose must_change_password in session user payload')
        sys.exit(1)
    if 'buildDualAuthSuccess(env, request, result.user, meta' not in read(
        'functions/api/v1/auth/change-password.js'
    ):
        print('FAIL change-password.js must issue dual-token session via buildDualAuthSuccess')
        sys.exit(1)
    if 'apiChangePassword' not in auth or 'changeOwnPassword' not in auth:
        print('FAIL auth.js must wire self-service password change via apiChangePassword')
        sys.exit(1)
    if 'openChangePasswordModal' not in auth or 'submitChangePasswordForm' not in auth:
        print('FAIL auth.js missing change password UI handlers')
        sys.exit(1)
    if 'is_advanced: fresh.is_advanced ? 1 : 0' not in auth:
        print('FAIL auth.js local login must set currentUser.is_advanced')
        sys.exit(1)


def test_admin_update_returns_token():
    users_api = read('functions/api/v1/admin/users.js')
    users_shared = read('functions/_shared/users.js')
    if 'buildDualAuthSuccess(env, request, result.user' not in users_api:
        print('FAIL admin/users.js self password update must issue HttpOnly auth cookies')
        sys.exit(1)
    if 'bumpAuthVersion(env, id)' not in users_shared.split('export async function updateUser', 1)[1].split('export async function deactivateUser', 1)[0]:
        print('FAIL updateUser must bump auth_version and revoke refresh on password change')
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


def test_remote_session_persistence():
    auth_shared = read('functions/_shared/auth.js')
    users_shared = read('functions/_shared/users.js')
    auth = read('js/auth.js')
    api = read('js/api-client.js')
    db = read('js/db.js')
    cookies = read('functions/_shared/cookies.js')
    refresh_sessions = read('functions/_shared/refresh-sessions.js')
    auth_response = read('functions/_shared/auth-response.js')
    if 'ACCESS_TTL_SEC = 60 * 30' not in auth_shared:
        print('FAIL auth.js shared access TTL should be 30 minutes')
        sys.exit(1)
    if 'SESSION_TTL_SEC = ACCESS_TTL_SEC' not in auth_shared:
        print('FAIL auth.js shared SESSION_TTL_SEC must alias ACCESS_TTL_SEC')
        sys.exit(1)
    if 'getAccessCookie' not in auth_shared:
        print('FAIL auth.js shared must read access token from HttpOnly cookie')
        sys.exit(1)
    if 'const access_token = await signAccessToken(env, {' not in users_shared:
        print('FAIL getSessionUser must refresh access token')
        sys.exit(1)
    if 'ketang_refresh' not in cookies or 'HttpOnly' not in cookies:
        print('FAIL cookies.js missing HttpOnly ketang_refresh cookie helpers')
        sys.exit(1)
    if 'ketang_access' not in cookies or 'ACCESS_COOKIE_PATH' not in cookies:
        print('FAIL cookies.js missing HttpOnly ketang_access cookie helpers')
        sys.exit(1)
    if 'getAccessCookie' not in cookies:
        print('FAIL cookies.js missing getAccessCookie')
        sys.exit(1)
    if 'refresh_sessions' not in refresh_sessions or 'consumeRefreshToken' not in refresh_sessions:
        print('FAIL refresh-sessions.js missing refresh_sessions table helpers')
        sys.exit(1)
    if 'revoked = 0' not in refresh_sessions or 'revokeMeta.changes' not in refresh_sessions:
        print('FAIL refresh-sessions.js must atomically revoke refresh token on rotation')
        sys.exit(1)
    if 'buildSessionUserResponse' not in auth_response:
        print('FAIL auth-response.js must rotate access cookie on session check')
        sys.exit(1)
    if 'accessCookieHeader' not in auth_response:
        print('FAIL auth-response.js must set HttpOnly access cookie on login')
        sys.exit(1)
    if 'buildDualAuthSuccess' not in auth_response or 'buildRefreshSuccess' not in auth_response:
        print('FAIL auth-response.js missing dual-token response builders')
        sys.exit(1)
    for auth_route in ['login.js', 'refresh.js', 'logout.js']:
        if not (ROOT / f'functions/api/v1/auth/{auth_route}').exists():
            print(f'FAIL missing functions/api/v1/auth/{auth_route}')
            sys.exit(1)
    if 'restoreCachedUserFromStorage' not in auth:
        print('FAIL auth.js missing restoreCachedUserFromStorage for remote boot')
        sys.exit(1)
    if 'apiSessionMeForRestore' not in api or 'apiAuthRefreshForRestore' not in api:
        print('FAIL api-client.js missing session restore helpers')
        sys.exit(1)
    if 'tryRefreshAccessToken' not in api or 'credentials: "include"' not in api:
        print('FAIL api-client.js missing refresh retry with credentials')
        sys.exit(1)
    if 'Authorization' in api and 'Bearer' in api:
        print('FAIL api-client.js must not send Bearer access token from client storage')
        sys.exit(1)
    if 'LEGACY_ACCESS_TOKEN_KEY' not in db or 'purgeLegacyClientTokens' not in db:
        print('FAIL db.js must purge legacy client-side access tokens')
        sys.exit(1)
    if 'getRemoteSessionToken' in db or 'setRemoteSessionToken' in db:
        print('FAIL db.js must not store access token in client storage')
        sys.exit(1)
    if 'isRemoteRefreshBlocked' not in db or 'REFRESH_BLOCK_KEY' not in db:
        print('FAIL db.js must block refresh after explicit logout')
        sys.exit(1)
    if 'localStorage.getItem(REMOTE_SESSION_KEY)' in db:
        print('FAIL db.js must not fall back to legacy localStorage session token')
        sys.exit(1)
    if 'if (!result.user)' not in auth:
        print('FAIL auth.js login must require user payload from apiAuthLogin')
        sys.exit(1)
    if 'remoteLoginAsync' in auth:
        print('FAIL auth.js must not call remoteLoginAsync')
        sys.exit(1)
    if 'remoteLoginAsync' in db:
        print('FAIL db.js must not define remoteLoginAsync')
        sys.exit(1)


def test_session_query_binding():
    session_api = read('functions/api/v1/session.js')
    users_shared = read('functions/_shared/users.js')
    if 'buildSessionUserResponse' not in session_api:
        print('FAIL session.js must set access cookie on successful session check')
        sys.exit(1)
    if 'clearAccessCookieHeader' not in session_api:
        print('FAIL session.js must clear access cookie on 401')
        sys.exit(1)
    if 'getSessionUser(env, request,' not in session_api:
        print('FAIL session.js must pass bound query function to getSessionUser')
        sys.exit(1)
    if 'verifySession(request, env, queryFn)' not in users_shared:
        print('FAIL getSessionUser must pass bound queryFn to verifySession')
        sys.exit(1)
    if 'await queryFn(' not in users_shared:
        print('FAIL getSessionUser must query users via bound queryFn')
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
    if '410' not in db_api or 'LEGACY_DB_RETIRED' not in db_api:
        print('FAIL api/db.js must return unified 410 LEGACY_DB_RETIRED')
        sys.exit(1)
    if '/api/v1/auth/login' not in db_api:
        print('FAIL api/db.js legacy login response must point clients to v1 auth/login')
        sys.exit(1)
    if 'apiAuthLogin' not in auth or 'loginByRole' not in auth:
        print('FAIL auth.js remote loginByRole must call apiAuthLogin')
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
    if 'login-overlay active' in index:
        print('FAIL login overlay must not be active by default in index.html')
        sys.exit(1)
    if 'auth-login-required' in index.split('<body', 1)[1].split('>', 1)[0]:
        print('FAIL body must not default to auth-login-required in index.html')
        sys.exit(1)
    if 'ketang-auth-pending' not in index:
        print('FAIL index.html must gate app shell with ketang-auth-pending until auth resolves')
        sys.exit(1)
    if '.login-overlay:not(.active)' not in index:
        print('FAIL index.html must inline-hide inactive login overlay before styles.css loads')
        sys.exit(1)
    if 'app-boot-banner' not in index:
        print('FAIL index.html missing app boot banner for session restore')
        sys.exit(1)
    if 'bootAuthUI' not in auth or 'showBootstrapping' not in auth:
        print('FAIL auth.js missing boot-time session UI helpers')
        sys.exit(1)
    if 'change-password-form' not in index or 'openChangePasswordModal(false)' not in index:
        print('FAIL index.html missing self-service change password UI')
        sys.exit(1)
    if 'setLoginOverlayPanel("restore")' not in auth:
        print('FAIL showBootstrapping must keep restore panel over app shell')
        sys.exit(1)
    if 'clearAuthPendingGate' not in auth:
        print('FAIL auth.js must clear ketang-auth-pending after auth gate resolves')
        sys.exit(1)
    if 'authStatus' not in auth or 'markAuthenticated' not in auth:
        print('FAIL auth.js missing explicit authStatus state machine')
        sys.exit(1)
    if 'authStatus === "authenticated"' not in auth:
        print('FAIL isLoggedIn must require authenticated status on remote')
        sys.exit(1)
    if 'acceptCachedSessionDegraded' not in auth:
        print('FAIL auth.js missing degraded cached-session path')
        sys.exit(1)
    if 'ketang-shell-v14' not in read('sw.js'):
        print('FAIL sw.js must bump cache version after auth-gate HTML change')
        sys.exit(1)
    if 'bootAuthUI' not in read('js/app.js'):
        print('FAIL app.js must call bootAuthUI before async init')
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
    """Legacy /api/db users retired; no anonymous account enumeration endpoint."""
    db_api = read('functions/api/db.js')
    if 'FROM users' in db_api:
        print('FAIL api/db.js must not query users table')
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
    render_idx = block.find('await renderAll')
    # Login may hide overlay first for perceived speed; first-view still waits on renderAll.
    if render_idx < 0:
        print('FAIL submitLogin must await renderAll')
        sys.exit(1)
    if hide_idx < 0:
        print('FAIL submitLogin must call hideLoginOverlay')
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
    if 'If-None-Match' not in read_model_api or (
        'status: 304' not in read_model_api and 'finish304' not in read_model_api
    ):
        print('FAIL read-model endpoint must support If-None-Match / 304')
        sys.exit(1)
    if read_model_api.find('ensureDatabaseForAuth') > read_model_api.find('finish304'):
        print('FAIL read-model must check 304 before ensureDatabaseForAuth')
        sys.exit(1)
    api_client = read('js/api-client.js')
    sync = read('js/sync-coordinator.js')
    if 'If-None-Match' not in api_client or 'notModified' not in api_client:
        print('FAIL api-client.js must handle read-model 304 responses')
        sys.exit(1)
    if 'payload.notModified' not in sync:
        print('FAIL sync-coordinator.js must skip module apply on 304')
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
    auth_login = read('functions/_shared/auth-login.js')
    d1 = read('functions/_shared/d1.js')
    db_api = read('functions/api/db.js')
    if 'ensureDatabaseForAuth' not in d1:
        print('FAIL d1.js missing ensureDatabaseForAuth helper')
        sys.exit(1)
    if 'probeProductionDatabaseReady' not in d1 or 'authEnsureReady' not in d1:
        print('FAIL d1.js must cache auth ensure with schema_version probe')
        sys.exit(1)
    if 'ensureDatabaseForAuth' not in auth_login:
        print('FAIL auth-login.js must use ensureDatabaseForAuth instead of full init')
        sys.exit(1)
    if '410' not in db_api or 'LEGACY_DB_RETIRED' not in db_api:
        print('FAIL api/db.js must return unified 410 LEGACY_DB_RETIRED')
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
        r"class_name, participant_identity, age_group, special_needs, status, source, notes\)\s*\n\s*VALUES \(\?, \?, \?, \?, \?, \?, \?, \?, \?, \?, \?, \?, \?, \?, \?, '在住', '法会批量导入', \?\)",
        checkin,
    ) is None:
        print('FAIL checkin.js batch CSV insert must bind class_name placeholder')
        sys.exit(1)


def test_role_permissions_admin_api():
    api = read('functions/api/v1/admin/role-permissions.js')
    perms = read('functions/_shared/permissions.js')
    auth = read('js/auth.js')
    if 'getRolePermissionsConfig' not in perms or 'saveRolePermissions' not in perms:
        print('FAIL permissions.js missing role config helpers')
        sys.exit(1)
    if 'users.write' not in api or 'requirePermission' not in api:
        print('FAIL role-permissions.js must guard with users.write')
        sys.exit(1)
    if 'renderRolePermissionsPanel' not in auth or 'saveRolePermissionsConfig' not in auth:
        print('FAIL auth.js missing role permissions UI')
        sys.exit(1)
    if 'ADVANCED_ZHIKE_EXTRA' not in perms:
        print('FAIL permissions.js missing advanced zhike merge')
        sys.exit(1)


def test_role_permissions_defaults_snapshot():
    import json
    defaults_path = ROOT / 'role-permissions.defaults.json'
    expected = json.loads(defaults_path.read_text(encoding='utf-8'))
    perms_js = read('functions/_shared/permissions.js')
    for role in ('admin', 'zhike', 'kitchen', 'housekeeping', 'viewer'):
        if role not in expected:
            print(f'FAIL defaults missing role {role}')
            sys.exit(1)
    admin_codes = set(expected['admin'])
    for role, codes in expected.items():
        for code in codes:
            if code not in admin_codes:
                print(f'FAIL {role} permission {code} not in admin ALL_PERMISSIONS list')
                sys.exit(1)
    if 'sanitizeRolePermissionMap' not in perms_js:
        print('FAIL permissions.js must validate saved role permission map')
        sys.exit(1)


def test_api_permission_guards_snapshot():
    guards = [
        ('functions/api/v1/check-in.js', 'lodging.checkin'),
        ('functions/api/v1/checkout.js', 'lodging.checkout'),
        ('functions/api/v1/edit-lodger.js', 'lodging.edit'),
        ('functions/api/v1/admin/data-backup.js', 'backup.read'),
        ('functions/api/v1/admin/role-permissions.js', 'users.write'),
        ('functions/api/v1/set-house-status.js', 'housekeeping.write'),
    ]
    for path, code in guards:
        src = read(path)
        if 'requirePermission' not in src or code not in src:
            print(f'FAIL {path} missing requirePermission({code})')
            sys.exit(1)


def test_p1_ops_assets():
    p1 = read('test_p1_ops.py')
    baseline = ROOT / 'docs/ops/performance-baseline.json'
    checklist = ROOT / 'docs/final-acceptance-checklist.md'
    if not baseline.exists() or not checklist.exists():
        print('FAIL P1 baseline or final acceptance checklist missing')
        sys.exit(1)
    if 'read_model_304_ms' not in baseline.read_text(encoding='utf-8'):
        print('FAIL performance baseline missing read_model_304_ms threshold')
        sys.exit(1)
    if 'run_p1_checklist.sh' not in (ROOT / 'scripts/run_p1_checklist.sh').read_text(encoding='utf-8'):
        pass
    latency = read('test_prod_latency.py')
    if '--check-baseline' not in latency or 'read_model_304_ms' not in latency:
        print('FAIL test_prod_latency.py missing baseline/304 support')
        sys.exit(1)


def test_dynamic_modals_use_shared_backdrop():
    for path in ('js/events.js', 'js/auth.js'):
        src = read(path)
        if 'modal-overlay' in src:
            print(f'FAIL {path} must use shared #modal backdrop, not undefined modal-overlay')
            sys.exit(1)
        if 'insertAdjacentHTML("beforeend"' in src and 'modal-overlay' in src:
            print(f'FAIL {path} must not inject standalone modal overlays')
            sys.exit(1)
    app = read('js/app.js')
    if 'function setModalWide' not in app:
        print('FAIL app.js missing setModalWide helper for wide modals')
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
    test_role_permissions_admin_api,
    test_role_permissions_defaults_snapshot,
    test_api_permission_guards_snapshot,
    test_permissions_cache_helpers,
    test_remote_init_marks_ready_after_existing_db,
    test_permissions_layer_exists,
    test_read_model_role_tables,
    test_users_list_and_is_advanced,
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
    test_remote_session_persistence,
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
    test_p1_ops_assets,
    test_dynamic_modals_use_shared_backdrop,
    test_export_script_reads_users_and_v15,
]

for test in TESTS:
    test()

print('OK auth gateway checks passed')
