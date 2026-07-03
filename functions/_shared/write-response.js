import { batchD1, bumpBoardVersion, getBoardVersion, queryD1 } from "./d1.js";
import {
  logSyncDomains,
  logSyncVersion,
  recordSyncDeletion,
} from "./sync-meta.js";
import { resolveChangedModules } from "./sync-modules.js";

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
export async function finishWrite(env, data, changedDomains, changedModules) {
  await bumpBoardVersion(env);
  const board_version = await getBoardVersion(env);
  await logSyncVersion(env, board_version);
  await logSyncDomains(env, changedDomains, board_version);
  const changed_domains = Array.isArray(changedDomains) ? changedDomains : [];
  return {
    ok: true,
    board_version,
    changed_domains,
    changed_modules: resolveChangedModules(changed_domains, changedModules),
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
  changedModules,
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
  const changed_domains = Array.isArray(changedDomains) ? changedDomains : [];
  return {
    ok: true,
    board_version,
    changed_domains,
    changed_modules: resolveChangedModules(changed_domains, changedModules),
    ...(data && typeof data === "object" ? data : {}),
  };
}

const WRITE_PATCH_TABLE_RE = /^[a-z_][a-z0-9_]*$/i;

/**
 * 写响应附带 patches/deletions（对齐 Directus read-after-write、Frappe 返回完整 document）
 * Attach row patches / tombstones so clients can update rc cache without refetch.
 */
export async function enrichWriteResponse(env, response, options) {
  options = options || {};
  const out = { ...response };
  if (options.deletion?.table_name && options.deletion?.row_id != null) {
    out.deletions = [
      {
        table_name: options.deletion.table_name,
        row_id: options.deletion.row_id,
      },
    ];
  } else if (Array.isArray(options.deletions)) {
    out.deletions = options.deletions;
  }
  const tables = options.patchTables?.length
    ? options.patchTables
    : options.patchTable
      ? [options.patchTable]
      : [];
  const rowIds = options.rowIds || {};
  const defaultRowId = options.rowId;
  const patches = {};
  for (const table of tables) {
    if (!WRITE_PATCH_TABLE_RE.test(table)) continue;
    const rowId = rowIds[table] ?? defaultRowId;
    if (rowId == null) continue;
    const rows = await queryD1(
      env,
      `SELECT * FROM ${table} WHERE id = ? LIMIT 1`,
      [rowId],
    );
    if (rows[0]) patches[table] = [rows[0]];
  }
  if (options.patchRowIds && typeof options.patchRowIds === "object") {
    for (const table of Object.keys(options.patchRowIds)) {
      if (!WRITE_PATCH_TABLE_RE.test(table)) continue;
      const ids = [
        ...new Set(
          (options.patchRowIds[table] || []).filter(function (id) {
            return id != null && id !== "";
          }),
        ),
      ];
      if (!ids.length) continue;
      const placeholders = ids.map(function () {
        return "?";
      }).join(",");
      const rows = await queryD1(
        env,
        `SELECT * FROM ${table} WHERE id IN (${placeholders})`,
        ids,
      );
      if (!rows.length) continue;
      if (!patches[table]) patches[table] = [];
      rows.forEach(function (row) {
        if (!patches[table].some(function (r) {
          return r.id == row.id;
        })) {
          patches[table].push(row);
        }
      });
    }
  }
  if (options.extraPatches && typeof options.extraPatches === "object") {
    Object.keys(options.extraPatches).forEach(function (table) {
      const rows = options.extraPatches[table];
      if (!Array.isArray(rows) || !rows.length) return;
      if (!patches[table]) patches[table] = [];
      rows.forEach(function (row) {
        if (
          row &&
          row.id != null &&
          !patches[table].some(function (r) {
            return r.id == row.id;
          })
        ) {
          patches[table].push(row);
        }
      });
    });
  }
  if (Object.keys(patches).length) out.patches = patches;
  return out;
}

export { recordSyncDeletion };
