import { queryD1 } from "./d1.js";
import defaultRolePermissions from "../../role-permissions.defaults.json";

/** 权限码清单 | Permission codes (keep in sync with role-permissions.defaults.json) */
export const ALL_PERMISSIONS = defaultRolePermissions.admin.slice();

const ROLE_PERMISSION_META_KEY = "role_permissions_v1";
const CUSTOM_PERMISSIONS_TTL_MS = 60 * 1000;

let customPermissionsCache = { loadedAt: 0, map: null };

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
  const defaults = getDefaultRolePermissions();
  const custom = await loadRolePermissions(env);
  const permissions =
    custom && Array.isArray(custom[role])
      ? custom[role].slice()
      : (defaults[role] || []).slice();
  if (session && typeof session === "object") {
    session._permissions = permissions;
  }
  return permissions;
}

export async function requirePermission(env, session, code) {
  const permissions = await getSessionPermissions(env, session);
  if (!permissions.includes(code)) throw new Error("权限不足");
  return permissions;
}
