/* 角色权限（defaults 来自 role-permissions.defaults.json）| Role permissions */

const ALL_PERMISSIONS = [
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

let defaultRolePermissions = {
  admin: ALL_PERMISSIONS.slice(),
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
  kitchen: ["meals.read", "meals.write"],
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

let rolePermissionsDefaultsReady = null;

async function initRolePermissionDefaults() {
  if (rolePermissionsDefaultsReady) return rolePermissionsDefaultsReady;
  rolePermissionsDefaultsReady = (async function () {
    try {
      const res = await fetch("./role-permissions.defaults.json?v=1");
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data === "object") defaultRolePermissions = data;
      }
    } catch (e) {
      /* 离线/ file:// 时使用内置副本 | use inline fallback */
    }
  })();
  return rolePermissionsDefaultsReady;
}

function getDefaultRolePermissions() {
  return defaultRolePermissions;
}

function loadLocalRolePermissions() {
  if (typeof query !== "function") return null;
  try {
    const rows = query(
      "SELECT value FROM app_meta WHERE key = 'role_permissions_v1' LIMIT 1",
      [],
    );
    if (!rows[0]?.value) return null;
    return JSON.parse(rows[0].value);
  } catch (e) {
    return null;
  }
}

function getSessionPermissionsForRole(role) {
  const defaults = getDefaultRolePermissions();
  const custom = loadLocalRolePermissions();
  if (custom && Array.isArray(custom[role])) return custom[role].slice();
  return (defaults[role] || []).slice();
}

function setSessionPermissions(perms) {
  if (!Array.isArray(perms)) perms = [];
  if (typeof currentUser !== "undefined" && currentUser) {
    currentUser.permissions = perms.slice();
    localStorage.setItem(
      typeof AUTH_STORAGE_KEY !== "undefined"
        ? AUTH_STORAGE_KEY
        : "ketang_current_user",
      JSON.stringify(currentUser),
    );
  }
}

function getSessionPermissions() {
  if (typeof currentUser !== "undefined" && currentUser?.permissions) {
    return currentUser.permissions.slice();
  }
  if (typeof currentUser !== "undefined" && currentUser?.role) {
    return getSessionPermissionsForRole(currentUser.role);
  }
  return [];
}

function hasPermission(code) {
  return getSessionPermissions().includes(code);
}

function hasAnyPermission(codes) {
  if (!Array.isArray(codes)) return false;
  return codes.some(function (code) {
    return hasPermission(code);
  });
}

function canSyncReadModel() {
  return hasAnyPermission([
    "board.read",
    "lodging.read",
    "meals.read",
    "housekeeping.read",
  ]);
}
