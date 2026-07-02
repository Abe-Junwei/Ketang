/* 角色权限（defaults 来自 role-permissions.defaults.json）| Role permissions */

const PERMISSION_GROUPS = [
  { id: "board", label: "看板", codes: ["board.read"] },
  {
    id: "lodging",
    label: "住宿",
    codes: [
      "lodging.read",
      "lodging.checkin",
      "lodging.checkout",
      "lodging.edit",
      "lodging.change_bed",
    ],
  },
  {
    id: "reservation",
    label: "预约",
    codes: ["reservation.read", "reservation.write"],
  },
  { id: "meals", label: "用斋", codes: ["meals.read", "meals.write"] },
  {
    id: "housekeeping",
    label: "房务",
    codes: ["housekeeping.read", "housekeeping.write"],
  },
  {
    id: "reports",
    label: "报表",
    codes: ["reports.read", "reports.export"],
  },
  { id: "users", label: "用户", codes: ["users.read", "users.write"] },
  { id: "backup", label: "备份", codes: ["backup.read", "backup.write"] },
  {
    id: "settings",
    label: "信息管理",
    codes: ["settings.read", "settings.write"],
  },
];

const ADVANCED_ZHIKE_EXTRA = [
  "backup.read",
  "backup.write",
  "reports.export",
  "users.read",
  "users.write",
  "settings.read",
  "settings.write",
];

const PERMISSION_LABELS = {
  "board.read": "查看看板",
  "lodging.read": "查看房态/在住",
  "lodging.checkin": "办理入住",
  "lodging.checkout": "办理退房",
  "lodging.edit": "编辑/删除挂单",
  "lodging.change_bed": "换床/分床",
  "reservation.read": "查看预约",
  "reservation.write": "预约写入",
  "meals.read": "查看用斋",
  "meals.write": "编辑用斋",
  "housekeeping.read": "查看房务",
  "housekeeping.write": "房务操作",
  "reports.read": "查看报表",
  "reports.export": "导出报表",
  "users.read": "查看用户",
  "users.write": "管理用户/权限",
  "backup.read": "导出备份",
  "backup.write": "导入/恢复备份",
  "settings.read": "查看信息管理",
  "settings.write": "编辑房间/床位/营期",
};

let defaultRolePermissions = {
  admin: [
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
  ],
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

function getAllPermissions() {
  return (defaultRolePermissions.admin || []).slice();
}

function getPermissionGroups() {
  return PERMISSION_GROUPS;
}

function getPermissionLabel(code) {
  return PERMISSION_LABELS[code] || code;
}

function mergeAdvancedZhikePermissions(permissions, user) {
  if (!user || user.role !== "zhike" || !user.is_advanced) return permissions;
  const set = new Set(permissions);
  ADVANCED_ZHIKE_EXTRA.forEach(function (code) {
    set.add(code);
  });
  return [...set];
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

function saveLocalRolePermissions(map) {
  if (typeof run !== "function") throw new Error("本地数据库未就绪");
  run("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('role_permissions_v1', ?)", [
    JSON.stringify(map),
  ]);
  if (typeof saveDB === "function") saveDB();
}

function getRolePermissionsConfigLocal() {
  const defaults = getDefaultRolePermissions();
  const custom = loadLocalRolePermissions();
  const effective = {};
  Object.keys(defaults).forEach(function (role) {
    effective[role] =
      custom && Array.isArray(custom[role])
        ? custom[role].slice()
        : (defaults[role] || []).slice();
  });
  return {
    defaults: defaults,
    custom: custom,
    effective: effective,
    all_permissions: getAllPermissions(),
    advanced_zhike_extra: ADVANCED_ZHIKE_EXTRA.slice(),
  };
}

function getSessionPermissionsForRole(role, user) {
  const defaults = getDefaultRolePermissions();
  const custom = loadLocalRolePermissions();
  let permissions =
    custom && Array.isArray(custom[role])
      ? custom[role].slice()
      : (defaults[role] || []).slice();
  return mergeAdvancedZhikePermissions(permissions, user || currentUser);
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
    return getSessionPermissionsForRole(currentUser.role, currentUser);
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

function sanitizeRolePermissionPayload(raw) {
  const all = getAllPermissions();
  const roles = ["admin", "zhike", "kitchen", "housekeeping", "viewer"];
  const sanitized = {};
  roles.forEach(function (role) {
    const codes = raw[role];
    if (!Array.isArray(codes)) throw new Error("角色 " + role + " 权限格式错误");
    const filtered = codes.filter(function (code) {
      return all.includes(code);
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
