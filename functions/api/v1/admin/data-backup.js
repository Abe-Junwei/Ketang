import { json, readJson, apiErrorStatus } from "../../../_shared/http.js";
import { requireSession } from "../../../_shared/auth.js";
import {
  batchD1,
  initRemoteDatabase,
  queryD1,
  runD1,
  safeErrorMessage,
} from "../../../_shared/d1.js";
import { requirePermission } from "../../../_shared/permissions.js";

const DEFAULT_ADMIN_PASSWORD_HASH =
  "sha256$ketang_default_salt$8d62959035f9b60a02e709f9826f3f996d07a09a4f5091e2884642fa01adf8a3";
const DEFAULT_ZHIKE_PASSWORD_HASH =
  "sha256$ketang_default_salt$fc286955fb12bec3fb16b4f2619f9b675337b1240537bc21d830b5f495121565";
const CURRENT_SCHEMA_VERSION = 15;
const IMPORT_BATCH_SIZE = 80;
const USERS_IMPORT_COLUMNS = [
  "id",
  "username",
  "display_name",
  "role",
  "is_advanced",
  "permissions",
  "password",
  "is_active",
  "auth_version",
  "must_change_password",
  "created_at",
];
const VALID_USER_ROLES = new Set([
  "admin",
  "zhike",
  "kitchen",
  "housekeeping",
  "viewer",
]);
const VALID_BED_STATUSES = new Set(["可用", "占用", "维修", "备用"]);
const VALID_LODGER_STATUSES = new Set(["在住", "已退", "已取消", "No-show"]);
const VALID_HOUSEKEEPING_STATUSES = new Set([
  "脏房",
  "净房",
  "查房",
  "可用",
  "占用",
  "维修",
]);
const REQUIRED_IMPORT_TABLES = ["users", "rooms", "beds"];

const TABLE_IMPORT_COLUMNS = {
  rooms: [
    "id",
    "name",
    "location",
    "floor",
    "dorm_type",
    "notes",
    "created_at",
  ],
  beds: ["id", "room_id", "bed_number", "status", "notes", "created_at"],
  guests: [
    "id",
    "name",
    "dharma_name",
    "gender",
    "phone",
    "id_card",
    "emergency_contact",
    "emergency_phone",
    "blacklist",
    "visit_count",
    "last_visit_date",
    "notes",
    "created_at",
    "updated_at",
  ],
  events: [
    "id",
    "name",
    "event_type",
    "gender_type",
    "expected_count",
    "start_date",
    "end_date",
    "status",
    "notes",
    "created_at",
  ],
  lodgers: [
    "id",
    "guest_id",
    "event_id",
    "name",
    "dharma_name",
    "gender",
    "phone",
    "id_card",
    "check_in_date",
    "expected_check_out",
    "actual_check_out",
    "bed_id",
    "role",
    "class_name",
    "status",
    "source",
    "notes",
    "meal_default_breakfast",
    "meal_default_lunch",
    "meal_default_dinner",
    "created_at",
  ],
  reservations: [
    "id",
    "guest_id",
    "event_id",
    "name",
    "dharma_name",
    "gender",
    "phone",
    "id_card",
    "role",
    "class_name",
    "expected_check_in",
    "expected_check_out",
    "room_preference",
    "source",
    "status",
    "meal_breakfast",
    "meal_lunch",
    "meal_dinner",
    "notes",
    "created_at",
  ],
  meals: [
    "id",
    "lodger_id",
    "date",
    "breakfast",
    "lunch",
    "dinner",
    "notes",
  ],
  payments: [
    "id",
    "lodger_id",
    "reservation_id",
    "type",
    "amount",
    "method",
    "remark",
    "paid_at",
    "created_at",
  ],
  housekeeping: [
    "id",
    "bed_id",
    "status",
    "operator",
    "changed_at",
    "notes",
  ],
  audit_logs: [
    "id",
    "action",
    "target_type",
    "target_id",
    "detail",
    "created_at",
  ],
  schema_version: ["version"],
  app_meta: ["key", "value"],
};

const EXPORT_TABLES = [
  "users",
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
const DELETE_ORDER = [
  "audit_logs",
  "housekeeping",
  "payments",
  "meals",
  "reservations",
  "lodgers",
  "events",
  "guests",
  "beds",
  "rooms",
  "users",
  "schema_version",
  "app_meta",
];

function fallbackPassword(username) {
  return username === "admin"
    ? DEFAULT_ADMIN_PASSWORD_HASH
    : DEFAULT_ZHIKE_PASSWORD_HASH;
}

function normalizeUserImportRows(rows) {
  return rows.map((raw, index) => {
    const username = String(raw?.username || "").trim();
    if (!username) {
      throw new Error(`备份 users 第 ${index + 1} 行 username 缺失`);
    }
    const role = String(raw?.role || "zhike").trim() || "zhike";
    if (!VALID_USER_ROLES.has(role)) {
      throw new Error(`备份 users 第 ${index + 1} 行 role 无效：${role}`);
    }
    const password =
      typeof raw?.password === "string" && raw.password.trim()
        ? raw.password.trim()
        : fallbackPassword(username);
    return {
      id: raw?.id ?? null,
      username,
      display_name:
        raw?.display_name == null || String(raw.display_name).trim() === ""
          ? username
          : String(raw.display_name),
      role,
      is_advanced: raw?.is_advanced ?? 0,
      permissions: raw?.permissions ?? null,
      password,
      is_active: raw?.is_active ?? 1,
      auth_version: raw?.auth_version ?? 1,
      must_change_password: raw?.must_change_password ?? 0,
      created_at: raw?.created_at ?? null,
    };
  });
}

function idSet(rows, column = "id") {
  return new Set(
    (rows || [])
      .map((row) => row?.[column])
      .filter((value) => value != null && String(value).trim() !== "")
      .map((value) => String(value)),
  );
}

function requireValue(row, table, rowIndex, column) {
  if (row?.[column] == null || String(row[column]).trim() === "") {
    throw new Error(`备份 ${table} 第 ${rowIndex + 1} 行 ${column} 缺失`);
  }
}

function validateImportRows(table, rows) {
  rows.forEach((row, index) => {
    if (table === "rooms") {
      requireValue(row, table, index, "name");
    }
    if (table === "beds") {
      requireValue(row, table, index, "room_id");
      requireValue(row, table, index, "bed_number");
      const status = row.status || "可用";
      if (!VALID_BED_STATUSES.has(status)) {
        throw new Error(`备份 beds 第 ${index + 1} 行 status 无效：${status}`);
      }
    }
    if (table === "lodgers") {
      requireValue(row, table, index, "name");
      const status = row.status || "在住";
      if (!VALID_LODGER_STATUSES.has(status)) {
        throw new Error(
          `备份 lodgers 第 ${index + 1} 行 status 无效：${status}`,
        );
      }
    }
    if (table === "housekeeping") {
      requireValue(row, table, index, "bed_id");
      const status = row.status || "净房";
      if (!VALID_HOUSEKEEPING_STATUSES.has(status)) {
        throw new Error(
          `备份 housekeeping 第 ${index + 1} 行 status 无效：${status}`,
        );
      }
    }
  });
}

function validateBackupCompleteness(tables, normalizedUsers) {
  for (const table of REQUIRED_IMPORT_TABLES) {
    const rows = tables[table];
    if (!Array.isArray(rows) || !rows.length) {
      throw new Error(`备份缺少必需表 ${table} 或数据为空`);
    }
  }
  if (
    !normalizedUsers.some(
      (user) => user.role === "admin" && user.is_active !== 0,
    )
  ) {
    throw new Error("备份 users 必须包含至少一名有效管理员");
  }
}

function validateActiveBedConflicts(tables) {
  const activeByBed = new Map();
  const lodgers = Array.isArray(tables.lodgers) ? tables.lodgers : [];
  lodgers.forEach((row, index) => {
    if ((row.status || "在住") !== "在住" || row.bed_id == null) return;
    const key = String(row.bed_id);
    const existing = activeByBed.get(key);
    if (existing != null) {
      throw new Error(
        `备份 lodgers 第 ${existing + 1} 行与第 ${index + 1} 行重复占用床位 ${key}`,
      );
    }
    activeByBed.set(key, index);
  });
}

function validateForeignKeys(tables) {
  const roomIds = idSet(tables.rooms);
  const bedIds = idSet(tables.beds);
  const guestIds = idSet(tables.guests);
  const eventIds = idSet(tables.events);
  const lodgerIds = idSet(tables.lodgers);
  const reservationIds = idSet(tables.reservations);

  (tables.beds || []).forEach((row, index) => {
    if (row.room_id != null && !roomIds.has(String(row.room_id))) {
      throw new Error(
        `备份 beds 第 ${index + 1} 行 room_id ${row.room_id} 在 rooms 中不存在`,
      );
    }
  });

  (tables.lodgers || []).forEach((row, index) => {
    if (row.bed_id != null && !bedIds.has(String(row.bed_id))) {
      throw new Error(
        `备份 lodgers 第 ${index + 1} 行 bed_id ${row.bed_id} 在 beds 中不存在`,
      );
    }
    if (row.guest_id != null && !guestIds.has(String(row.guest_id))) {
      throw new Error(
        `备份 lodgers 第 ${index + 1} 行 guest_id ${row.guest_id} 在 guests 中不存在`,
      );
    }
    if (row.event_id != null && !eventIds.has(String(row.event_id))) {
      throw new Error(
        `备份 lodgers 第 ${index + 1} 行 event_id ${row.event_id} 在 events 中不存在`,
      );
    }
  });

  (tables.reservations || []).forEach((row, index) => {
    if (row.guest_id != null && !guestIds.has(String(row.guest_id))) {
      throw new Error(
        `备份 reservations 第 ${index + 1} 行 guest_id ${row.guest_id} 在 guests 中不存在`,
      );
    }
    if (row.event_id != null && !eventIds.has(String(row.event_id))) {
      throw new Error(
        `备份 reservations 第 ${index + 1} 行 event_id ${row.event_id} 在 events 中不存在`,
      );
    }
  });

  (tables.meals || []).forEach((row, index) => {
    if (row.lodger_id != null && !lodgerIds.has(String(row.lodger_id))) {
      throw new Error(
        `备份 meals 第 ${index + 1} 行 lodger_id ${row.lodger_id} 在 lodgers 中不存在`,
      );
    }
  });

  (tables.payments || []).forEach((row, index) => {
    if (row.lodger_id != null && !lodgerIds.has(String(row.lodger_id))) {
      throw new Error(
        `备份 payments 第 ${index + 1} 行 lodger_id ${row.lodger_id} 在 lodgers 中不存在`,
      );
    }
    if (
      row.reservation_id != null &&
      !reservationIds.has(String(row.reservation_id))
    ) {
      throw new Error(
        `备份 payments 第 ${index + 1} 行 reservation_id ${row.reservation_id} 在 reservations 中不存在`,
      );
    }
  });

  (tables.housekeeping || []).forEach((row, index) => {
    if (row.bed_id != null && !bedIds.has(String(row.bed_id))) {
      throw new Error(
        `备份 housekeeping 第 ${index + 1} 行 bed_id ${row.bed_id} 在 beds 中不存在`,
      );
    }
  });
}

function importColumnsForTable(table) {
  if (table === "users") return USERS_IMPORT_COLUMNS;
  const columns = TABLE_IMPORT_COLUMNS[table];
  if (!columns) throw new Error(`不支持的导入表：${table}`);
  return columns;
}

function buildInsertStatements(table, rows) {
  const columns = importColumnsForTable(table);
  if (!columns.every((name) => /^[a-z_][a-z0-9_]*$/i.test(name))) {
    throw new Error("备份列名无效");
  }
  const placeholders = columns.map(() => "?").join(", ");
  return rows.map((row, rowIndex) => ({
    table,
    rowIndex,
    sql: `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`,
    params: columns.map((col) => row[col] ?? null),
  }));
}

function buildImportStatements(tables) {
  const normalizedUsers = normalizeUserImportRows(tables.users);
  validateBackupCompleteness(tables, normalizedUsers);
  validateActiveBedConflicts(tables);
  validateForeignKeys(tables);

  const preparedTables = {
    ...tables,
    users: normalizedUsers,
  };
  if (
    !Array.isArray(preparedTables.schema_version) ||
    !preparedTables.schema_version.length
  ) {
    preparedTables.schema_version = [{ version: CURRENT_SCHEMA_VERSION }];
  }

  const statements = [];
  for (const table of DELETE_ORDER) {
    statements.push({ table, sql: `DELETE FROM ${table}`, params: [] });
  }
  for (const table of EXPORT_TABLES) {
    const rows = preparedTables[table];
    if (!Array.isArray(rows) || !rows.length) continue;
    validateImportRows(table, rows);
    statements.push(...buildInsertStatements(table, rows));
  }
  statements.push({
    table: "app_meta",
    sql: "INSERT INTO app_meta (key, value) VALUES ('board_version', '1') ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)",
    params: [],
  });
  return statements;
}

function formatStatementError(statement, error) {
  const where = statement.table
    ? `${statement.table}${statement.rowIndex != null ? ` 第 ${statement.rowIndex + 1} 行` : ""}`
    : "导入语句";
  return new Error(`${where} 导入失败：${error?.message || error}`);
}

async function runChunkWithFallback(env, chunk) {
  try {
    await batchD1(env, chunk);
    return;
  } catch (_batchError) {
    for (const statement of chunk) {
      try {
        await runD1(env, statement.sql, statement.params);
      } catch (error) {
        throw formatStatementError(statement, error);
      }
    }
  }
}

async function runImportBatched(env, statements) {
  await initRemoteDatabase(env);
  for (let i = 0; i < statements.length; i += IMPORT_BATCH_SIZE) {
    const chunk = statements.slice(i, i + IMPORT_BATCH_SIZE);
    await runChunkWithFallback(env, chunk);
  }
}

async function summarizeImport(env) {
  const summary = {};
  for (const table of EXPORT_TABLES) {
    const rows = await queryD1(env, `SELECT COUNT(*) AS c FROM ${table}`, []);
    summary[table] = rows[0]?.c || 0;
  }
  const activeRows = await queryD1(
    env,
    "SELECT COUNT(*) AS c FROM lodgers WHERE status = '在住'",
    [],
  );
  summary.active_lodgers = activeRows[0]?.c || 0;
  return summary;
}

export async function onRequestGet({ request, env }) {
  if (!env.KETANG_DB) return json({ error: "缺少 D1 绑定 KETANG_DB" }, 500);
  try {
    const session = await requireSession(request, env, (sql, p) =>
      queryD1(env, sql, p),
    );
    await requirePermission(env, session, "backup.read");
    await initRemoteDatabase(env);
    const data = {};
    for (const table of EXPORT_TABLES) {
      data[table] = await queryD1(env, `SELECT * FROM ${table}`, []);
    }
    return json({ exported_at: new Date().toISOString(), tables: data });
  } catch (error) {
    const status = apiErrorStatus(error);
    return json({ error: safeErrorMessage(error) }, status);
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.KETANG_DB) return json({ error: "缺少 D1 绑定 KETANG_DB" }, 500);
  try {
    const session = await requireSession(request, env, (sql, p) =>
      queryD1(env, sql, p),
    );
    await requirePermission(env, session, "backup.write");
    const body = await readJson(request);
    if (!body?.tables || typeof body.tables !== "object")
      return json({ error: "请求格式错误" }, 400);
    if (!body.confirm)
      return json({ error: "请设置 confirm: true 确认覆盖导入" }, 400);

    const statements = buildImportStatements(body.tables);
    await runImportBatched(env, statements);
    const summary = await summarizeImport(env);
    return json({
      ok: true,
      imported_tables: Object.keys(body.tables),
      summary,
    });
  } catch (error) {
    const status = apiErrorStatus(error);
    return json({ error: safeErrorMessage(error) }, status);
  }
}
