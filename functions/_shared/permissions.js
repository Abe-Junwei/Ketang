import { queryD1 } from "./d1.js";

/** 权限码清单 | Permission codes (keep in sync with js/permissions.js) */
export const ALL_PERMISSIONS = [
  "board.read",
  "lodging.read",
  "lodging.checkin",
  "lodging.checkout",
  "lodging.edit",
  "lodging.change_bed",
  "reservation.read",
  "reservation.write",
  "meals.read",
  "meals.write",
  "housekeeping.read",
  "housekeeping.write",
  "reports.read",
  "reports.export",
  "users.read",
  "users.write",
  "backup.read",
  "backup.write",
  "settings.read",
  "settings.write",
];

const ROLE_PERMISSION_META_KEY = "role_permissions_v1";

/** 内置默认角色权限 | Default role permission templates */
export function getDefaultRolePermissions() {
  const all = ALL_PERMISSIONS.slice();
  return {
    admin: all,
    zhike: [
      "board.read",
      "lodging.read",
      "lodging.checkin",
      "lodging.checkout",
      "lodging.edit",
      "lodging.change_bed",
      "reservation.read",
      "reservation.write",
      "meals.read",
      "meals.write",
      "housekeeping.read",
      "reports.read",
    ],
    kitchen: ["board.read", "meals.read", "meals.write"],
    housekeeping: [
      "board.read",
      "lodging.read",
      "housekeeping.read",
      "housekeeping.write",
    ],
    viewer: [
      "board.read",
      "lodging.read",
      "reservation.read",
      "meals.read",
      "reports.read",
    ],
  };
}

export async function loadRolePermissions(env) {
  const rows = await queryD1(
    env,
    "SELECT value FROM app_meta WHERE key = ? LIMIT 1",
    [ROLE_PERMISSION_META_KEY],
  );
  if (!rows[0]?.value) return null;
  try {
    const parsed = JSON.parse(rows[0].value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (e) {
    return null;
  }
}

export async function getSessionPermissions(env, session) {
  const role = session?.role;
  if (!role) return [];
  const defaults = getDefaultRolePermissions();
  const custom = await loadRolePermissions(env);
  if (custom && Array.isArray(custom[role])) return custom[role].slice();
  return (defaults[role] || []).slice();
}

export async function requirePermission(env, session, code) {
  const permissions = await getSessionPermissions(env, session);
  if (!permissions.includes(code)) throw new Error("权限不足");
  return permissions;
}
