import {
  SCHEMA_SQL,
  SEED_ROOMS,
  LODGER_BED_UNIQUE_INDEX_SQL,
  DEFAULT_USER_INSERTS,
} from "./schema.js";
import { ensureRefreshSessionsTable } from "./refresh-sessions.js";
import { ensureSyncMetaSchema } from "./sync-meta.js";
import { ensureRowSyncSchema } from "./row-sync.js";

export const normalizeParams = (params) =>
  Array.isArray(params)
    ? params.map((value) => (value === undefined ? null : value))
    : [];

export async function queryD1(env, sql, params) {
  const result = await env.KETANG_DB.prepare(sql)
    .bind(...normalizeParams(params))
    .all();
  return result.results || [];
}

export async function runD1(env, sql, params) {
  const result = await env.KETANG_DB.prepare(sql)
    .bind(...normalizeParams(params))
    .run();
  return result.meta || {};
}

export async function batchD1(env, statements) {
  const prepared = statements.map((item) =>
    env.KETANG_DB.prepare(item.sql).bind(...normalizeParams(item.params || [])),
  );
  return env.KETANG_DB.batch(prepared);
}

/** D1 batch 单次语句过多会失败，按块提交 | Chunk large imports */
export async function batchD1Chunked(env, statements, chunkSize = 80) {
  for (let i = 0; i < statements.length; i += chunkSize) {
    await batchD1(env, statements.slice(i, i + chunkSize));
  }
}

export function splitSqlStatements(sql) {
  return String(sql || "")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function runSchemaSql(env, schemaSql) {
  const statements = splitSqlStatements(schemaSql);
  for (const statement of statements) {
    await runD1(env, statement, []);
  }
}

let remoteInitPromise = null;
let remoteInitReady = false;

async function repairUsersTableState(env) {
  await runD1(env, "DROP TABLE IF EXISTS users_new", []);
  const tables = await queryD1(
    env,
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users', 'users_new')",
    [],
  );
  const names = new Set(tables.map((row) => row.name));
  if (!names.has("users") && names.has("users_new")) {
    await runD1(env, "ALTER TABLE users_new RENAME TO users", []);
  }
}

async function ensureUserAuthColumns(env) {
  const cols = await queryD1(env, "PRAGMA table_info(users)", []);
  if (!cols.length) return;
  const names = new Set(cols.map((col) => col.name));
  if (!names.has("auth_version")) {
    await runD1(
      env,
      "ALTER TABLE users ADD COLUMN auth_version INTEGER DEFAULT 1",
      [],
    );
  }
  if (!names.has("must_change_password")) {
    await runD1(
      env,
      "ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0",
      [],
    );
  }
}

async function ensureUserRoleColumns(env) {
  const cols = await queryD1(env, "PRAGMA table_info(users)", []);
  if (!cols.length) return;
  const names = new Set(cols.map((col) => col.name));
  if (!names.has("is_active")) {
    await runD1(
      env,
      "ALTER TABLE users ADD COLUMN is_active INTEGER DEFAULT 1",
      [],
    );
  }
  if (!names.has("is_advanced")) {
    await runD1(
      env,
      "ALTER TABLE users ADD COLUMN is_advanced INTEGER DEFAULT 0",
      [],
    );
  }
  if (!names.has("permissions")) {
    await runD1(env, "ALTER TABLE users ADD COLUMN permissions TEXT", []);
  }
  // 更新旧 CHECK 约束以包含新角色 | Update old CHECK constraint to include new roles
  const tableSql = await queryD1(
    env,
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='users'",
    [],
  );
  const ddl = tableSql[0]?.sql || "";
  // 仅旧 CHECK(admin,zhike) 需重建；新枚举含 kitchen 时跳过 | Skip if roles already expanded
  if (ddl.includes("'admin','zhike'") && !ddl.includes("'kitchen'")) {
    await runD1(env, "DROP TABLE IF EXISTS users_new", []);
    await runD1(
      env,
      `
      CREATE TABLE users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        display_name TEXT,
        role TEXT NOT NULL CHECK(role IN ('admin','zhike','kitchen','housekeeping','viewer')),
        is_advanced INTEGER DEFAULT 0 CHECK(is_advanced IN (0,1)),
        permissions TEXT,
        password TEXT NOT NULL,
        is_active INTEGER DEFAULT 1 CHECK(is_active IN (0,1)),
        auth_version INTEGER DEFAULT 1,
        must_change_password INTEGER DEFAULT 0 CHECK(must_change_password IN (0,1)),
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `,
      [],
    );
    await runD1(
      env,
      `
      INSERT INTO users_new (id, username, display_name, role, is_advanced, permissions, password, is_active, auth_version, must_change_password, created_at)
      SELECT id, username, display_name, role, COALESCE(is_advanced, 0), permissions, password, COALESCE(is_active, 1), COALESCE(auth_version, 1), COALESCE(must_change_password, 0), created_at FROM users
    `,
      [],
    );
    await runD1(env, "DROP TABLE users", []);
    await runD1(env, "ALTER TABLE users_new RENAME TO users", []);
  }
}

async function ensureDefaultUsers(env) {
  const exists = await queryD1(
    env,
    "SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='users' LIMIT 1",
    [],
  );
  if (!exists.length) return;
  const count = await queryD1(env, "SELECT COUNT(*) AS c FROM users", []);
  if ((count[0]?.c || 0) > 0) return;
  for (const [username, displayName, role, password] of DEFAULT_USER_INSERTS) {
    await runD1(
      env,
      "INSERT OR IGNORE INTO users (username, display_name, role, password) VALUES (?, ?, ?, ?)",
      [username, displayName, role, password],
    );
  }
}

export async function initRemoteDatabase(env) {
  await ensureRoomingSchemaColumnsIfTablesExist(env);
  if (remoteInitReady) return false;
  if (remoteInitPromise) return remoteInitPromise;
  remoteInitPromise = initRemoteDatabaseOnce(env).finally(() => {
    remoteInitPromise = null;
  });
  return remoteInitPromise;
}

/** 登录前轻量探测：已有业务数据则跳过全量 schema 重放 | Fast path before login */
export async function ensureDatabaseForAuth(env) {
  await ensureRoomingSchemaColumnsIfTablesExist(env);
  await ensureSyncMetaSchema(env);
  await ensureRowSyncSchema(env);
  if (remoteInitReady) return false;
  const roomsTable = await queryD1(
    env,
    "SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='rooms' LIMIT 1",
    [],
  );
  if (roomsTable.length) {
    const count = await queryD1(env, "SELECT COUNT(*) AS c FROM rooms", []);
    if ((count[0]?.c || 0) > 0) {
      await ensureUserAuthColumns(env);
      await ensureUserRoleColumns(env);
      await ensureRefreshSessionsTable(env);
      await ensureEventColumns(env);
      await ensureRowSyncSchema(env);
      remoteInitReady = true;
      return false;
    }
  }
  return initRemoteDatabase(env);
}

async function addRemoteColumnIfMissing(env, table, column, definition) {
  const cols = await queryD1(env, `PRAGMA table_info(${table})`, []);
  if (!cols.length) return;
  if (cols.some((col) => col.name === column)) return;
  await runD1(
    env,
    `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`,
    [],
  );
}

async function ensureRoomingSchemaColumnsIfTablesExist(env) {
  const roomsTable = await queryD1(
    env,
    "SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='rooms' LIMIT 1",
    [],
  );
  if (!roomsTable.length) return;
  await ensureRoomingSchemaColumns(env);
  await ensureRoomingPlanTables(env);
}

async function ensureRoomingSchemaColumns(env) {
  await addRemoteColumnIfMissing(
    env,
    "events",
    "include_spare_beds",
    "INTEGER DEFAULT 0 CHECK(include_spare_beds IN (0,1))",
  );
  const eventCols = [
    ["activity_target", "TEXT"],
    ["arrival_date", "TEXT"],
    ["departure_date", "TEXT"],
    ["confirmed_count", "INTEGER DEFAULT 0"],
    ["actual_arrival_count", "INTEGER DEFAULT 0"],
    ["expected_absent_count", "INTEGER DEFAULT 0"],
    ["male_count", "INTEGER DEFAULT 0"],
    ["female_count", "INTEGER DEFAULT 0"],
    ["child_count", "INTEGER DEFAULT 0"],
    ["elder_count", "INTEGER DEFAULT 0"],
    ["teacher_count", "INTEGER DEFAULT 0"],
    ["volunteer_count", "INTEGER DEFAULT 0"],
    ["special_needs_count", "INTEGER DEFAULT 0"],
    ["manager_name", "TEXT"],
    ["manager_phone", "TEXT"],
    ["backup_manager_name", "TEXT"],
    [
      "needs_central_lodging",
      "INTEGER DEFAULT 0 CHECK(needs_central_lodging IN (0,1))",
    ],
    ["needs_quiet_zone", "INTEGER DEFAULT 0 CHECK(needs_quiet_zone IN (0,1))"],
    [
      "needs_near_zen_hall",
      "INTEGER DEFAULT 0 CHECK(needs_near_zen_hall IN (0,1))",
    ],
    [
      "needs_teacher_room",
      "INTEGER DEFAULT 0 CHECK(needs_teacher_room IN (0,1))",
    ],
  ];
  for (const [column, definition] of eventCols) {
    await addRemoteColumnIfMissing(env, "events", column, definition);
  }
  const roomCols = [
    ["room_type", "TEXT DEFAULT '学员房'"],
    ["suitable_elder", "INTEGER DEFAULT 0 CHECK(suitable_elder IN (0,1))"],
    ["suitable_child", "INTEGER DEFAULT 0 CHECK(suitable_child IN (0,1))"],
    ["near_zen_hall", "INTEGER DEFAULT 0 CHECK(near_zen_hall IN (0,1))"],
    ["flexible_use", "INTEGER DEFAULT 0 CHECK(flexible_use IN (0,1))"],
  ];
  for (const [column, definition] of roomCols) {
    await addRemoteColumnIfMissing(env, "rooms", column, definition);
  }
  const bedCols = [
    ["bed_type", "TEXT DEFAULT '单床'"],
    ["suitable_elder", "INTEGER DEFAULT 0 CHECK(suitable_elder IN (0,1))"],
    ["is_flexible", "INTEGER DEFAULT 0 CHECK(is_flexible IN (0,1))"],
  ];
  for (const [column, definition] of bedCols) {
    await addRemoteColumnIfMissing(env, "beds", column, definition);
  }
  const participantCols = [
    ["participant_identity", "TEXT"],
    ["age_group", "TEXT"],
    ["special_needs", "TEXT"],
  ];
  for (const [column, definition] of participantCols) {
    await addRemoteColumnIfMissing(env, "lodgers", column, definition);
    await addRemoteColumnIfMissing(env, "reservations", column, definition);
  }
}

const ROOMING_PLAN_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS rooming_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
  name TEXT,
  status TEXT DEFAULT '未确认' CHECK(status IN ('未确认','待调整','已确认')),
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS rooming_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES rooming_plans(id) ON DELETE CASCADE,
  member_kind TEXT NOT NULL CHECK(member_kind IN ('lodger','reservation','forecast')),
  member_ref_id INTEGER,
  member_name TEXT NOT NULL,
  member_gender TEXT,
  participant_identity TEXT,
  age_group TEXT,
  special_needs TEXT,
  bed_id INTEGER REFERENCES beds(id),
  item_status TEXT DEFAULT '未确认' CHECK(item_status IN ('未确认','待调整','已确认')),
  notes TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_rooming_plans_event ON rooming_plans(event_id);
CREATE INDEX IF NOT EXISTS idx_rooming_assignments_plan ON rooming_assignments(plan_id);
`;

const ROOMING_PUBLISH_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS rooming_checkin_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES rooming_plans(id) ON DELETE CASCADE,
  assignment_id INTEGER REFERENCES rooming_assignments(id) ON DELETE SET NULL,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  member_kind TEXT NOT NULL CHECK(member_kind IN ('lodger','reservation')),
  member_ref_id INTEGER,
  member_name TEXT NOT NULL,
  member_gender TEXT,
  participant_identity TEXT,
  age_group TEXT,
  special_needs TEXT,
  suggested_bed_id INTEGER REFERENCES beds(id),
  queue_status TEXT DEFAULT '待办理' CHECK(queue_status IN ('待办理','已办理','已跳过')),
  processed_at TEXT,
  notes TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_rooming_checkin_queue_event ON rooming_checkin_queue(event_id);
CREATE INDEX IF NOT EXISTS idx_rooming_checkin_queue_plan ON rooming_checkin_queue(plan_id);
`;

async function ensureRoomingPublishSchema(env) {
  await addRemoteColumnIfMissing(env, "rooming_plans", "published_at", "TEXT");
  await runD1(env, ROOMING_PUBLISH_SCHEMA_SQL, []);
}

const ROOMING_ADJUSTMENT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS rooming_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  plan_id INTEGER REFERENCES rooming_plans(id) ON DELETE SET NULL,
  queue_id INTEGER REFERENCES rooming_checkin_queue(id) ON DELETE SET NULL,
  lodger_id INTEGER REFERENCES lodgers(id) ON DELETE SET NULL,
  adjustment_kind TEXT NOT NULL CHECK(adjustment_kind IN ('换床','跳过预分','手动备注','其他')),
  member_name TEXT,
  from_bed_id INTEGER REFERENCES beds(id),
  to_bed_id INTEGER REFERENCES beds(id),
  reason TEXT,
  operator TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_rooming_adjustments_event ON rooming_adjustments(event_id);
`;

async function ensureRoomingAdjustmentSchema(env) {
  await runD1(env, ROOMING_ADJUSTMENT_SCHEMA_SQL, []);
}

async function ensureRoomingPlanTables(env) {
  await runD1(env, ROOMING_PLAN_TABLES_SQL, []);
  await ensureRoomingPublishSchema(env);
  await ensureRoomingAdjustmentSchema(env);
}

async function ensureEventColumns(env) {
  await ensureRoomingSchemaColumns(env);
}

async function initRemoteDatabaseOnce(env) {
  const roomsTable = await queryD1(
    env,
    "SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='rooms' LIMIT 1",
    [],
  );
  if (roomsTable.length) {
    const count = await queryD1(env, "SELECT COUNT(*) AS c FROM rooms", []);
    if ((count[0]?.c || 0) > 0) {
      await ensureUserAuthColumns(env);
      await ensureUserRoleColumns(env);
      await ensureRefreshSessionsTable(env);
      await ensureEventColumns(env);
      await ensureRowSyncSchema(env);
      remoteInitReady = true;
      return false;
    }
  }
  await repairUsersTableState(env);
  try {
    await runSchemaSql(env, SCHEMA_SQL);
  } catch (error) {
    throw new Error(`schema exec: ${error?.message || error}`);
  }
  try {
    await runD1(env, LODGER_BED_UNIQUE_INDEX_SQL, []);
  } catch (error) {
    console.warn("lodger partial index skipped:", error);
  }
  await ensureUserAuthColumns(env);
  await ensureUserRoleColumns(env);
  await ensureRefreshSessionsTable(env);
  await ensureEventColumns(env);
  await ensureRowSyncSchema(env);
  await ensureDefaultUsers(env);
  const count = await queryD1(env, "SELECT COUNT(*) AS c FROM rooms", []);
  if ((count[0]?.c || 0) > 0) {
    remoteInitReady = true;
    return false;
  }
  for (const item of SEED_ROOMS) await runD1(env, item.sql, item.params);
  const beds = await queryD1(
    env,
    "SELECT id, status FROM beds ORDER BY id",
    [],
  );
  for (const bed of beds) {
    await runD1(
      env,
      "INSERT INTO housekeeping (bed_id, status, notes) VALUES (?, ?, ?)",
      [bed.id, bed.status === "维修" ? "维修" : "净房", "云端初始化"],
    );
  }
  remoteInitReady = true;
  return true;
}

export async function isDatabaseEmpty(env) {
  const tables = await queryD1(
    env,
    "SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='rooms' LIMIT 1",
    [],
  );
  if (!tables.length) return true;
  const count = await queryD1(env, "SELECT COUNT(*) AS c FROM rooms", []);
  return (count[0]?.c || 0) === 0;
}

export async function bumpBoardVersion(env) {
  await runD1(
    env,
    `INSERT INTO app_meta (key, value) VALUES ('board_version', '1')
    ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)`,
    [],
  );
}

export async function getBoardVersion(env) {
  const rows = await queryD1(
    env,
    "SELECT value FROM app_meta WHERE key = 'board_version'",
    [],
  );
  return parseInt(rows[0]?.value || "0", 10) || 0;
}

export function safeErrorMessage(error) {
  const message = error?.message || String(error);
  if (
    /登录|权限|KETANG_|不允许|账号或密码|管理员|尝试过多|bootstrap|密码|账号|用户/.test(
      message,
    )
  )
    return message;
  if (/UNIQUE constraint failed: lodgers\.bed_id/.test(message))
    return "该床位已有在住挂单，请刷新后重新选择床位";
  if (
    /schema exec:|no such table|no such column|SQLITE_|database is locked|duplicate column name/i.test(
      message,
    )
  )
    return `数据库初始化异常：${message}`;
  return "操作失败，请刷新后重试";
}

export function normalizeSql(sql) {
  const cleaned = String(sql || "")
    .trim()
    .replace(/;+\s*$/, "");
  if (!cleaned || cleaned.includes(";")) throw new Error("不允许执行多条 SQL");
  return cleaned;
}

export function assertAllowedSql(action, sql, session) {
  const cleaned = normalizeSql(sql);
  const isQuery =
    action === "query" || action === "exec" || action === "batch_query";
  const allowedStart = isQuery
    ? /^(SELECT|PRAGMA)\b/i
    : /^(INSERT|UPDATE|DELETE)\b/i;
  if (!allowedStart.test(cleaned)) throw new Error("不允许执行该类型 SQL");
  if (/\b(DROP|ALTER|CREATE|ATTACH|DETACH|REINDEX|VACUUM)\b/i.test(cleaned))
    throw new Error("不允许执行结构变更 SQL");

  if (session.role === "admin") {
    if (!isQuery && !/^INSERT INTO audit_logs\b/i.test(cleaned)) {
      throw new Error("该写操作请使用业务接口");
    }
    return cleaned;
  }

  // 知客师：仅允许 SELECT/PRAGMA 与 audit_logs 写入 | Zhike: read-only + audit insert
  if (!isQuery) {
    if (!/^INSERT INTO audit_logs\b/i.test(cleaned)) {
      throw new Error("该写操作请使用业务接口");
    }
  } else if (/\busers\b/i.test(cleaned)) {
    throw new Error("不允许查询用户表");
  }
  return cleaned;
}

export async function insertAudit(
  env,
  action,
  targetType,
  targetId,
  detail,
  operator,
) {
  const payload = detail && typeof detail === "object" ? { ...detail } : {};
  if (operator) {
    payload._operator = operator.display_name || operator.username;
    payload._operator_id = operator.id;
    payload._operator_role = operator.role;
  }
  await runD1(
    env,
    "INSERT INTO audit_logs (action, target_type, target_id, detail) VALUES (?, ?, ?, ?)",
    [action, targetType || null, targetId || null, JSON.stringify(payload)],
  );
}
