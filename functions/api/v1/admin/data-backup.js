import { json, readJson, apiErrorStatus } from "../../../_shared/http.js";
import { requireSession } from "../../../_shared/auth.js";
import {
  batchD1Chunked,
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
  return rows.map((raw) => {
    const username = String(raw?.username || "").trim();
    if (!username) {
      throw new Error("备份 users.username 缺失");
    }
    const role = String(raw?.role || "zhike").trim() || "zhike";
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

function collectColumns(rows) {
  const names = new Set();
  rows.forEach((row) => {
    Object.keys(row || {}).forEach((key) => names.add(key));
  });
  return Array.from(names);
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

    const statements = [];
    for (const table of DELETE_ORDER) {
      statements.push({ sql: `DELETE FROM ${table}`, params: [] });
    }
    for (const table of EXPORT_TABLES) {
      const inputRows = body.tables[table];
      if (!Array.isArray(inputRows) || !inputRows.length) continue;
      const rows =
        table === "users" ? normalizeUserImportRows(inputRows) : inputRows;
      const columns =
        table === "users" ? USERS_IMPORT_COLUMNS : collectColumns(rows);
      if (!columns.every((c) => /^[a-z_][a-z0-9_]*$/i.test(c)))
        throw new Error("备份列名无效");
      const placeholders = columns.map(() => "?").join(", ");
      rows.forEach((row) => {
        statements.push({
          sql: `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`,
          params: columns.map((col) => row[col] ?? null),
        });
      });
    }
    statements.push({
      sql: "INSERT INTO app_meta (key, value) VALUES ('board_version', '1') ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)",
      params: [],
    });
    await batchD1Chunked(env, statements);
    return json({ ok: true, imported_tables: Object.keys(body.tables) });
  } catch (error) {
    const status = apiErrorStatus(error);
    return json({ error: safeErrorMessage(error) }, status);
  }
}
