import { queryD1, getBoardVersion, ensureDatabaseReady } from "./d1.js";
import { getSessionPermissions } from "./permissions.js";
import { LODGING_APP_META_KEYS } from "./operational-settings.js";

/** 云端读模型表清单 | Tables included in client read-model snapshot */
export const READ_MODEL_TABLES = [
  "rooms",
  "beds",
  "guests",
  "events",
  "rooming_plans",
  "rooming_assignments",
  "rooming_checkin_queue",
  "rooming_adjustments",
  "lodgers",
  "reservations",
  "meals",
  "payments",
  "housekeeping",
  "schema_version",
  "app_meta",
];

const TABLE_NAME_RE = /^[a-z_][a-z0-9_]*$/i;

const READ_MODEL_SYNC_PERMISSIONS = [
  "board.read",
  "lodging.read",
  "meals.read",
  "housekeeping.read",
];

/** 权限码 → 可读表 | Permission-driven table allowlist */
const PERMISSION_TABLE_INCLUDES = {
  "board.read": ["rooms", "beds"],
  "lodging.read": [
    "rooms",
    "beds",
    "guests",
    "events",
    "rooming_plans",
    "rooming_assignments",
    "rooming_checkin_queue",
    "rooming_adjustments",
    "lodgers",
    "payments",
    "app_meta",
  ],
  "reservation.read": ["reservations"],
  "meals.read": ["meals", "rooms", "beds", "guests", "lodgers"],
  "housekeeping.read": ["housekeeping", "rooms", "beds", "lodgers"],
  "settings.read": [
    "schema_version",
    "app_meta",
    "rooming_plans",
    "rooming_assignments",
    "rooming_checkin_queue",
    "rooming_adjustments",
  ],
};

/** 各角色可读表（脱敏/测试回退）| Role fallback for row sanitization */
const ROLE_READ_TABLES = {
  admin: READ_MODEL_TABLES,
  zhike: READ_MODEL_TABLES.filter((name) => name !== "audit_logs"),
  kitchen: ["rooms", "beds", "guests", "lodgers", "meals"],
  housekeeping: ["rooms", "beds", "lodgers", "housekeeping"],
  viewer: [
    "rooms",
    "beds",
    "guests",
    "events",
    "lodgers",
    "reservations",
    "meals",
  ],
};

const GUEST_SENSITIVE_FIELDS = [
  "id_card",
  "phone",
  "emergency_contact",
  "emergency_phone",
];
const LODGER_SENSITIVE_FIELDS = ["id_card", "phone"];
const USER_NEVER_FIELDS = ["password"];

/** 按权限返回表清单 | Resolve tables from session permissions */
export function tablesForPermissions(permissions) {
  if (!Array.isArray(permissions)) return [];
  const selected = new Set();
  Object.entries(PERMISSION_TABLE_INCLUDES).forEach(function ([perm, tables]) {
    if (permissions.includes(perm)) {
      tables.forEach(function (table) {
        selected.add(table);
      });
    }
  });
  return READ_MODEL_TABLES.filter(function (name) {
    return selected.has(name);
  });
}

/** 按角色返回表清单 | Role fallback (tests / legacy) */
export function tablesForRole(role) {
  return (ROLE_READ_TABLES[role] || ROLE_READ_TABLES.viewer).slice();
}

export function canSyncReadModel(permissions) {
  if (!Array.isArray(permissions)) return false;
  return READ_MODEL_SYNC_PERMISSIONS.some((code) => permissions.includes(code));
}

function maskSensitiveValue(value) {
  const text = String(value || "");
  if (text.length <= 4) return "****";
  return text.slice(0, 2) + "****" + text.slice(-2);
}

/** 字段级脱敏 | Strip or mask sensitive columns per role */
export function sanitizeRowForRole(table, row, role) {
  if (!row || typeof row !== "object") return row;
  const copy = { ...row };
  if (table === "users") {
    USER_NEVER_FIELDS.forEach((field) => delete copy[field]);
    return copy;
  }
  if (role === "admin" || role === "zhike") return copy;
  if (table === "guests") {
    GUEST_SENSITIVE_FIELDS.forEach((field) => {
      if (copy[field]) copy[field] = maskSensitiveValue(copy[field]);
    });
  }
  if (table === "lodgers") {
    LODGER_SENSITIVE_FIELDS.forEach((field) => {
      if (copy[field]) copy[field] = maskSensitiveValue(copy[field]);
    });
  }
  return copy;
}

async function fetchReadModelTableRows(env, table, permissions) {
  if (!TABLE_NAME_RE.test(table)) throw new Error("无效的表名");
  if (table === "app_meta") {
    if (permissions.includes("settings.read")) {
      return queryD1(env, "SELECT * FROM app_meta", []);
    }
    if (permissions.includes("lodging.read")) {
      const placeholders = LODGING_APP_META_KEYS.map(function () {
        return "?";
      }).join(",");
      return queryD1(
        env,
        `SELECT * FROM app_meta WHERE key IN (${placeholders})`,
        LODGING_APP_META_KEYS,
      );
    }
    return [];
  }
  return queryD1(env, `SELECT * FROM ${table}`, []);
}

export async function buildReadModel(env, session, options) {
  if (!options?.skipInit) {
    await ensureDatabaseReady(env, { allowMigrationFallback: false });
  }
  const permissions = await getSessionPermissions(env, session);
  if (!canSyncReadModel(permissions)) {
    throw new Error("权限不足");
  }
  const tables = tablesForPermissions(permissions);
  const data = {};
  await Promise.all(
    tables.map(async function (table) {
      const rows = await fetchReadModelTableRows(env, table, permissions);
      data[table] = rows.map((row) =>
        sanitizeRowForRole(table, row, session.role),
      );
    }),
  );
  const version = await getBoardVersion(env);
  return {
    version,
    synced_at: new Date().toISOString(),
    role: session.role,
    permissions,
    tables: data,
  };
}
