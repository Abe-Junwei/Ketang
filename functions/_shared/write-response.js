import { batchD1, bumpBoardVersion, getBoardVersion } from "./d1.js";
import {
  logSyncDomains,
  logSyncVersion,
  recordSyncDeletion,
} from "./sync-meta.js";

/** D1 batch 内递增看板版本 | Bump board_version inside atomic batch */
export const BOARD_VERSION_BUMP_SQL = `INSERT INTO app_meta (key, value) VALUES ('board_version', '1')
ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)`;

/** 构造审计日志 batch 语句 | Audit row for batchD1 */
export function auditLogStatement(
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
  return {
    sql: "INSERT INTO audit_logs (action, target_type, target_id, detail) VALUES (?, ?, ?, ?)",
    params: [
      action,
      targetType || null,
      targetId || null,
      JSON.stringify(payload),
    ],
  };
}

/** 写操作标准响应 | Standard mutating API response */
export async function finishWrite(env, data, changedDomains) {
  await bumpBoardVersion(env);
  const board_version = await getBoardVersion(env);
  await logSyncVersion(env, board_version);
  await logSyncDomains(env, changedDomains, board_version);
  return {
    ok: true,
    board_version,
    changed_domains: Array.isArray(changedDomains) ? changedDomains : [],
    ...(data && typeof data === "object" ? data : {}),
  };
}

/** 多语句 + 版本号同一 batch | Atomic write + audit + version bump */
export async function atomicWriteBatch(
  env,
  statements,
  data,
  changedDomains,
  deletion,
) {
  await batchD1(env, [
    ...statements,
    { sql: BOARD_VERSION_BUMP_SQL, params: [] },
  ]);
  const board_version = await getBoardVersion(env);
  await logSyncVersion(env, board_version);
  await logSyncDomains(env, changedDomains, board_version);
  if (deletion && deletion.table_name && deletion.row_id) {
    await recordSyncDeletion(
      env,
      deletion.table_name,
      deletion.row_id,
      board_version,
    );
  }
  return {
    ok: true,
    board_version,
    changed_domains: Array.isArray(changedDomains) ? changedDomains : [],
    ...(data && typeof data === "object" ? data : {}),
  };
}

export { recordSyncDeletion };
