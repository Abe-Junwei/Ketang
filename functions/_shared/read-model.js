import { initRemoteDatabase, queryD1, getBoardVersion } from "./d1.js";

/** 云端读模型表清单 | Tables included in client read-model snapshot */
export const READ_MODEL_TABLES = [
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

const ZHIKE_OMIT = new Set(["users"]);

const TABLE_NAME_RE = /^[a-z_][a-z0-9_]*$/i;

function tablesForRole(role) {
  if (role === "admin") return READ_MODEL_TABLES;
  return READ_MODEL_TABLES.filter((name) => !ZHIKE_OMIT.has(name));
}

export async function buildReadModel(env, session) {
  await initRemoteDatabase(env);
  const tables = tablesForRole(session.role);
  const data = {};
  for (const table of tables) {
    if (!TABLE_NAME_RE.test(table)) throw new Error("无效的表名");
    data[table] = await queryD1(env, `SELECT * FROM ${table}`, []);
  }
  const version = await getBoardVersion(env);
  return {
    version,
    synced_at: new Date().toISOString(),
    role: session.role,
    tables: data,
  };
}
