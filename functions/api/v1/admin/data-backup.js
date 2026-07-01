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
      const rows = body.tables[table];
      if (!Array.isArray(rows) || !rows.length) continue;
      const columns = Object.keys(rows[0]);
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
