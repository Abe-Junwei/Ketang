import { queryD1, runD1, insertAudit } from "./d1.js";
import defaultRolePermissions from "../../role-permissions.defaults.json" assert { type: "json" };

/** 权限码清单 | Permission codes (keep in sync with role-permissions.defaults.json) */
export const ALL_PERMISSIONS = defaultRolePermissions.admin.slice();

export const VALID_ROLES = [
  "admin",
  "zhike",
  "kitchen",
  "housekeeping",
  "viewer",
];

/** 高级知客额外权限 | Extra grants when users.is_advanced = 1 for zhike role */
export const ADVANCED_ZHIKE_EXTRA = [
  "backup.read",
  "backup.write",
  "reports.export",
  "users.read",
  "users.write",
  "settings.read",
  "settings.write",
];

const ROLE_PERMISSION_META_KEY = "role_permissions_v1";
const CUSTOM_PERMISSIONS_TTL_MS = 60 * 1000;

let customPermissionsCache = { loadedAt: 0, map: null };

function mergeAdvancedZhikePermissions(permissions, session) {
  if (session?.role !== "zhike" || !session?.is_advanced) return permissions;
  const set = new Set(permissions);
  ADVANCED_ZHIKE_EXTRA.forEach(function (code) {
    set.add(code);
  });
  return [...set];
}

function sanitizeRolePermissionMap(raw) {
  if (!raw || typeof raw !== "object") throw new Error("权限配置格式错误");
  const sanitized = {};
  VALID_ROLES.forEach(function (role) {
    const codes = raw[role];
    if (!Array.isArray(codes)) throw new Error(`角色 ${role} 权限格式错误`);
    const filtered = codes.filter(function (code) {
      return ALL_PERMISSIONS.includes(code);
    });
    if (role === "admin") {
      if (!filtered.includes("users.write")) {
        throw new Error("管理员必须保留 users.write");
      }
      if (!filtered.includes("backup.write")) {
        throw new Error("管理员必须保留 backup.write");
      }
    }
    sanitized[role] = filtered;
  });
  return sanitized;
}

/** 内置默认角色权限 | Default role permission templates */
export function getDefaultRolePermissions() {
  return JSON.parse(JSON.stringify(defaultRolePermissions));
}

export function invalidateRolePermissionsCache() {
  customPermissionsCache = { loadedAt: 0, map: null };
}

export async function loadRolePermissions(env) {
  const now = Date.now();
  if (
    customPermissionsCache.map &&
    now - customPermissionsCache.loadedAt < CUSTOM_PERMISSIONS_TTL_MS
  ) {
    return customPermissionsCache.map;
  }
  const rows = await queryD1(
    env,
    "SELECT value FROM app_meta WHERE key = ? LIMIT 1",
    [ROLE_PERMISSION_META_KEY],
  );
  let parsed = null;
  if (rows[0]?.value) {
    try {
      const value = JSON.parse(rows[0].value);
      parsed = value && typeof value === "object" ? value : null;
    } catch (e) {
      parsed = null;
    }
  }
  customPermissionsCache = { loadedAt: now, map: parsed };
  return parsed;
}

export async function getSessionPermissions(env, session) {
  if (session?._permissions) return session._permissions;
  const role = session?.role;
  if (!role) return [];
  let isAdvanced = !!session?.is_advanced;
  if (!isAdvanced && env && (session?.id || session?.sub)) {
    const rows = await queryD1(
      env,
      "SELECT is_advanced FROM users WHERE id = ? LIMIT 1",
      [session.id || session.sub],
    );
    isAdvanced = !!(rows[0]?.is_advanced);
  }
  const defaults = getDefaultRolePermissions();
  const custom = await loadRolePermissions(env);
  let permissions =
    custom && Array.isArray(custom[role])
      ? custom[role].slice()
      : (defaults[role] || []).slice();
  permissions = mergeAdvancedZhikePermissions(permissions, {
    role: role,
    is_advanced: isAdvanced,
  });
  if (session && typeof session === "object") {
    session._permissions = permissions;
    session.is_advanced = isAdvanced;
  }
  return permissions;
}

export async function getRolePermissionsConfig(env) {
  const defaults = getDefaultRolePermissions();
  const custom = await loadRolePermissions(env);
  const effective = {};
  VALID_ROLES.forEach(function (role) {
    effective[role] =
      custom && Array.isArray(custom[role])
        ? custom[role].slice()
        : (defaults[role] || []).slice();
  });
  return {
    defaults: defaults,
    custom: custom,
    effective: effective,
    all_permissions: ALL_PERMISSIONS.slice(),
    advanced_zhike_extra: ADVANCED_ZHIKE_EXTRA.slice(),
  };
}

export async function saveRolePermissions(env, session, body) {
  await requirePermission(env, session, "users.write");
  const sanitized = sanitizeRolePermissionMap(body?.roles || body);
  await runD1(
    env,
    "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [ROLE_PERMISSION_META_KEY, JSON.stringify(sanitized)],
  );
  invalidateRolePermissionsCache();
  await insertAudit(
    env,
    "更新角色权限",
    "app_meta",
    ROLE_PERMISSION_META_KEY,
    { roles: Object.keys(sanitized) },
    session,
  );
  return { ok: true, roles: sanitized };
}

export async function requirePermission(env, session, code) {
  const permissions = await getSessionPermissions(env, session);
  if (!permissions.includes(code)) throw new Error("权限不足");
  return permissions;
}
