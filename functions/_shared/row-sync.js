import { queryD1, runD1 } from "./d1.js";
import { READ_MODULE_TABLES } from "./read-modules.js";
import { LODGING_APP_META_KEYS } from "./operational-settings.js";
import { sanitizeRowForRole } from "./read-model.js";
import { getSessionPermissions } from "./permissions.js";
import { moduleKeysForDomains } from "./sync-meta.js";
import { nowIso } from "./sync-timestamp.js";

const TABLE_NAME_RE = /^[a-z_][a-z0-9_]*$/i;

/** 行级增量同步表 | Tables with updated_at for row-level delta */
export const SYNC_TOUCH_TABLES = [
  "rooms",
  "beds",
  "guests",
  "events",
  "lodgers",
  "meals",
  "reservations",
  "payments",
  "housekeeping",
  "rooming_plans",
  "rooming_assignments",
  "rooming_checkin_queue",
  "rooming_adjustments",
];

export const ROW_PATCH_MAX_ROWS = 400;
export const ROW_PATCH_MAX_ROWS_PER_TABLE = 200;

function touchTriggerName(table) {
  return `touch_${table}_updated_at`;
}

function insertTriggerName(table) {
  return `insert_${table}_updated_at`;
}

function isoToSqlTimestampExpr(column) {
  return `substr(replace(replace(${column}, 'T', ' '), 'Z', ''), 1, 19)`;
}

export function rowSyncMigrationStatements() {
  const statements = [];
  SYNC_TOUCH_TABLES.forEach(function (table) {
    statements.push({
      sql: `ALTER TABLE ${table} ADD COLUMN updated_at TEXT`,
      ignore: /duplicate column/i,
    });
  });
  statements.push({
    sql: "UPDATE guests SET updated_at = COALESCE(updated_at, created_at, datetime('now')) WHERE updated_at IS NULL OR updated_at = ''",
  });
  statements.push({
    sql: "UPDATE rooming_plans SET updated_at = COALESCE(updated_at, created_at, datetime('now')) WHERE updated_at IS NULL OR updated_at = ''",
  });
  SYNC_TOUCH_TABLES.forEach(function (table) {
    if (table === "guests" || table === "rooming_plans") return;
    const tsCol =
      table === "housekeeping"
        ? "COALESCE(changed_at, datetime('now'))"
        : table === "meals"
          ? "datetime('now')"
          : "COALESCE(created_at, datetime('now'))";
    statements.push({
      sql: `UPDATE ${table} SET updated_at = ${tsCol} WHERE updated_at IS NULL OR updated_at = ''`,
    });
    statements.push({
      sql: `CREATE INDEX IF NOT EXISTS idx_${table}_updated_at ON ${table}(updated_at)`,
    });
    statements.push({
      sql: `CREATE TRIGGER IF NOT EXISTS ${touchTriggerName(table)} AFTER UPDATE ON ${table} FOR EACH ROW WHEN OLD.updated_at IS NEW.updated_at OR NEW.updated_at IS NULL BEGIN UPDATE ${table} SET updated_at = datetime('now') WHERE id = NEW.id; END`,
    });
  });
  statements.push({
    sql: "DELETE FROM schema_version WHERE version < 21",
  });
  statements.push({
    sql: "INSERT OR REPLACE INTO schema_version (version) VALUES (21)",
  });
  return statements;
}

/** v22：INSERT 触达 + 时间戳格式统一 | INSERT triggers + timestamp normalize */
export function rowSyncV22MigrationStatements() {
  const statements = [];
  SYNC_TOUCH_TABLES.forEach(function (table) {
    statements.push({
      sql: `UPDATE ${table} SET updated_at = ${isoToSqlTimestampExpr("updated_at")} WHERE updated_at LIKE '%T%'`,
    });
    statements.push({
      sql: `CREATE TRIGGER IF NOT EXISTS ${insertTriggerName(table)} AFTER INSERT ON ${table} FOR EACH ROW WHEN NEW.updated_at IS NULL OR NEW.updated_at = '' BEGIN UPDATE ${table} SET updated_at = datetime('now') WHERE id = NEW.id; END`,
    });
  });
  statements.push({
    sql: `UPDATE sync_version_log SET bumped_at = ${isoToSqlTimestampExpr("bumped_at")} WHERE bumped_at LIKE '%T%'`,
    ignore: /no such table/i,
  });
  statements.push({
    sql: `UPDATE sync_domain_log SET bumped_at = ${isoToSqlTimestampExpr("bumped_at")} WHERE bumped_at LIKE '%T%'`,
    ignore: /no such table/i,
  });
  statements.push({
    sql: `UPDATE sync_deletions SET deleted_at = ${isoToSqlTimestampExpr("deleted_at")} WHERE deleted_at LIKE '%T%'`,
    ignore: /no such table/i,
  });
  statements.push({
    sql: "DELETE FROM schema_version WHERE version < 22",
  });
  statements.push({
    sql: "INSERT OR REPLACE INTO schema_version (version) VALUES (22)",
  });
  return statements;
}

async function runMigrationStatements(env, statements) {
  for (const item of statements) {
    try {
      await runD1(env, item.sql, []);
    } catch (error) {
      if (item.ignore && item.ignore.test(String(error?.message || error))) {
        continue;
      }
      throw error;
    }
  }
}

let _rowSyncReady = false;

/** Mark row-sync schema ready in this isolate (no D1) */
export function markRowSyncReady() {
  _rowSyncReady = true;
}

export async function ensureRowSyncSchema(env) {
  if (_rowSyncReady) return false;
  const ver = await queryD1(
    env,
    "SELECT MIN(version) AS v FROM schema_version",
    [],
  );
  const current = ver[0]?.v || 0;
  if (current >= 22) {
    _rowSyncReady = true;
    return false;
  }
  const cols = await queryD1(env, "PRAGMA table_info(lodgers)", []);
  if (!cols.length) return false;
  if (current < 21) {
    await runMigrationStatements(env, rowSyncMigrationStatements());
  }
  await runMigrationStatements(env, rowSyncV22MigrationStatements());
  _rowSyncReady = true;
  return true;
}

export async function getSinceBumpedAt(env, sinceVersion) {
  const since = parseInt(sinceVersion, 10) || 0;
  if (since <= 0) return null;
  const rows = await queryD1(
    env,
    "SELECT bumped_at FROM sync_version_log WHERE version = ? LIMIT 1",
    [since],
  );
  return rows[0]?.bumped_at || null;
}

function tablesForDirtyDomains(domains) {
  const keys = moduleKeysForDomains(domains);
  const tables = new Set();
  keys.forEach(function (moduleKey) {
    const list = READ_MODULE_TABLES[moduleKey] || [];
    list.forEach(function (table) {
      tables.add(table);
    });
  });
  return [...tables];
}

async function fetchAppMetaPatch(env, permissions) {
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

/** 尝试行级 patch；过大则返回 null 走模块全量 | Row patches or fallback */
export async function tryBuildRowPatches(
  env,
  session,
  dirtyDomains,
  sinceVersion,
) {
  const sinceIso = await getSinceBumpedAt(env, sinceVersion);
  if (!sinceIso) return null;
  const permissions = await getSessionPermissions(env, session);
  const tables = tablesForDirtyDomains(dirtyDomains);
  if (!tables.length) return null;

  const patches = {};
  let totalRows = 0;

  for (const table of tables) {
    if (!TABLE_NAME_RE.test(table)) return null;
    if (table === "app_meta") {
      const rows = await fetchAppMetaPatch(env, permissions);
      patches[table] = rows.map((row) =>
        sanitizeRowForRole("app_meta", row, session.role),
      );
      continue;
    }
    if (SYNC_TOUCH_TABLES.indexOf(table) === -1) return null;
    const rows = await queryD1(
      env,
      `SELECT * FROM ${table} WHERE updated_at > ?`,
      [sinceIso],
    );
    if (rows.length > ROW_PATCH_MAX_ROWS_PER_TABLE) return null;
    totalRows += rows.length;
    patches[table] = rows.map((row) =>
      sanitizeRowForRole(table, row, session.role),
    );
  }

  if (totalRows > ROW_PATCH_MAX_ROWS) return null;
  return { patches, row_count: totalRows };
}

export { nowIso };
