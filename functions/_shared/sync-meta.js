import { getBoardVersion, queryD1, runD1 } from "./d1.js";

/** 变更域 → 模块读 API 键 | Domain to read-module key */
export const DOMAIN_MODULE_KEYS = {
  board: "board",
  lodging: "lodgers",
  events: "events",
  reservations: "reservations",
  meals: "meals",
  settings: "settings",
};

export const SYNC_DOMAIN_CODES = Object.keys(DOMAIN_MODULE_KEYS);

/** 写路径别名 → 标准变更域 | Normalize domain aliases before logging */
export function normalizeSyncDomains(domains) {
  const normalized = new Set();
  (domains || []).forEach(function (domain) {
    if (domain === "housekeeping") {
      normalized.add("board");
      return;
    }
    if (SYNC_DOMAIN_CODES.includes(domain)) normalized.add(domain);
  });
  return [...normalized];
}

const SYNC_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sync_version_log (
  version INTEGER PRIMARY KEY,
  bumped_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_domain_log (
  domain TEXT NOT NULL,
  board_version INTEGER NOT NULL,
  bumped_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sync_domain_log_version ON sync_domain_log(board_version);
CREATE TABLE IF NOT EXISTS sync_deletions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  row_id INTEGER NOT NULL,
  board_version INTEGER NOT NULL,
  deleted_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sync_deletions_version ON sync_deletions(board_version);
`;

export function nowIso() {
  return new Date().toISOString();
}

export async function ensureSyncMetaSchema(env) {
  await runD1(env, SYNC_SCHEMA_SQL, []);
}

export async function logSyncVersion(env, boardVersion) {
  await ensureSyncMetaSchema(env);
  await runD1(
    env,
    "INSERT OR REPLACE INTO sync_version_log (version, bumped_at) VALUES (?, ?)",
    [boardVersion, nowIso()],
  );
}

export async function logSyncDomains(env, domains, boardVersion) {
  const normalized = normalizeSyncDomains(domains);
  if (!normalized.length) return;
  await ensureSyncMetaSchema(env);
  const bumpedAt = nowIso();
  for (const domain of normalized) {
    await runD1(
      env,
      "INSERT INTO sync_domain_log (domain, board_version, bumped_at) VALUES (?, ?, ?)",
      [domain, boardVersion, bumpedAt],
    );
  }
}

export async function recordSyncDeletion(env, tableName, rowId, boardVersion) {
  if (!tableName || !rowId) return;
  await ensureSyncMetaSchema(env);
  await runD1(
    env,
    "INSERT INTO sync_deletions (table_name, row_id, board_version, deleted_at) VALUES (?, ?, ?, ?)",
    [tableName, rowId, boardVersion, nowIso()],
  );
}

export async function domainsDirtySince(env, sinceVersion) {
  await ensureSyncMetaSchema(env);
  const since = parseInt(sinceVersion, 10) || 0;
  if (since <= 0) return SYNC_DOMAIN_CODES.slice();
  const rows = await queryD1(
    env,
    "SELECT DISTINCT domain FROM sync_domain_log WHERE board_version > ? ORDER BY domain",
    [since],
  );
  return rows.map((row) => row.domain).filter(Boolean);
}

export async function deletionsSince(env, sinceVersion) {
  await ensureSyncMetaSchema(env);
  const since = parseInt(sinceVersion, 10) || 0;
  return queryD1(
    env,
    "SELECT table_name, row_id, board_version FROM sync_deletions WHERE board_version > ? ORDER BY id",
    [since],
  );
}

export function moduleKeysForDomains(domains) {
  const keys = new Set();
  (domains || []).forEach(function (domain) {
    const key = DOMAIN_MODULE_KEYS[domain];
    if (key) keys.add(key);
  });
  return [...keys];
}
