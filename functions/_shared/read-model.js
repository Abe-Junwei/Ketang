import { queryD1, getBoardVersion, initRemoteDatabase } from "./d1.js";
import { getSessionPermissions } from "./permissions.js";

/** 云端读模型表清单 | Tables included in client read-model snapshot */
export const READ_MODEL_TABLES = [
  "rooms",
  "beds",
  "guests",
  "events",
  "lodgers",
  "reservations",
  "meals",
  "payments",
  "housekeeping",
  "audit_logs",
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

/** 各角色可读表 | Role-specific table allowlist (no app_meta for non-admin) */
const ROLE_READ_TABLES = {
  admin: READ_MODEL_TABLES,
  zhike: READ_MODEL_TABLES.filter(
    (name) => name !== "audit_logs" && name !== "payments",
  ),
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

/** 按角色返回表清单 | Resolve table list for role */
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

export async function buildReadModel(env, session, options) {
  if (!options?.skipInit) {
    await initRemoteDatabase(env);
  }
  const permissions = await getSessionPermissions(env, session);
  if (!canSyncReadModel(permissions)) {
    throw new Error("权限不足");
  }
  const tables = tablesForRole(session.role);
  const data = {};
  await Promise.all(
    tables.map(async function (table) {
      if (!TABLE_NAME_RE.test(table)) throw new Error("无效的表名");
      const sql =
        table === "audit_logs"
          ? "SELECT * FROM audit_logs ORDER BY id DESC LIMIT 200"
          : `SELECT * FROM ${table}`;
      const rows = await queryD1(env, sql, []);
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
