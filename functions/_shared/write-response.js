import { batchD1, queryD1 } from "./d1.js";
import {
  recordSyncDeletion,
  syncMetaStatementsFromMeta,
} from "./sync-meta.js";
import { resolveChangedModules } from "./sync-modules.js";

/** D1 batch 内递增看板版本 | Bump board_version inside atomic batch */
export const BOARD_VERSION_BUMP_SQL = `INSERT INTO app_meta (key, value) VALUES ('board_version', '1')
ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)`;

export const BOARD_VERSION_SELECT_SQL =
  "SELECT value FROM app_meta WHERE key = 'board_version'";

/** Parse board_version from final SELECT in a write batch */
function boardVersionFromBatchResults(results) {
  const last = results && results.length ? results[results.length - 1] : null;
  const rows = last?.results || [];
  return parseInt(rows[0]?.value || "0", 10) || 0;
}

/** First statement last_row_id (INSERT) from D1 batch results */
function lastRowIdFromBatchResults(results, index) {
  const item = results && results[index != null ? index : 0];
  return item?.meta?.last_row_id;
}

/** 构造审计日志 batch 语句 | Audit row for batchD1 */
export function auditLogStatement(
  action,
  targetType,
  targetId,
  detail,
  operator,
  options,
) {
  const payload = detail && typeof detail === "object" ? { ...detail } : {};
  if (operator) {
    payload._operator = operator.display_name || operator.username;
    payload._operator_id = operator.id;
    payload._operator_role = operator.role;
  }
  // useLastInsertRowId: target_id = last_insert_rowid() in same batch as INSERT
  if (options && options.useLastInsertRowId) {
    return {
      sql: "INSERT INTO audit_logs (action, target_type, target_id, detail) VALUES (?, ?, last_insert_rowid(), ?)",
      params: [action, targetType || null, JSON.stringify(payload)],
    };
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

function writeMetaResponse(board_version, data, changedDomains, changedModules) {
  const changed_domains = Array.isArray(changedDomains) ? changedDomains : [];
  return {
    ok: true,
    board_version,
    changed_domains,
    changed_modules: resolveChangedModules(changed_domains, changedModules),
    ...(data && typeof data === "object" ? data : {}),
  };
}

/**
 * Write + bump + sync logs + version read in one D1 batch.
 * statements may start with INSERT; response.last_row_id comes from statements[0].
 */
export async function atomicWriteBatch(
  env,
  statements,
  data,
  changedDomains,
  deletion,
  changedModules,
) {
  const results = await batchD1(env, [
    ...statements,
    { sql: BOARD_VERSION_BUMP_SQL, params: [] },
    ...syncMetaStatementsFromMeta(changedDomains, deletion || null),
    { sql: BOARD_VERSION_SELECT_SQL, params: [] },
  ]);
  const board_version = boardVersionFromBatchResults(results);
  const last_row_id = lastRowIdFromBatchResults(results, 0);
  const payload =
    data && typeof data === "object" ? { ...data } : data || {};
  if (last_row_id != null && payload.last_row_id == null) {
    payload.last_row_id = last_row_id;
  }
  return writeMetaResponse(
    board_version,
    payload,
    changedDomains,
    changedModules,
  );
}

/** 写操作标准响应（单 batch：bump + sync + version）| Standard mutating API response */
export async function finishWrite(env, data, changedDomains, changedModules) {
  const results = await batchD1(env, [
    { sql: BOARD_VERSION_BUMP_SQL, params: [] },
    ...syncMetaStatementsFromMeta(changedDomains, null),
    { sql: BOARD_VERSION_SELECT_SQL, params: [] },
  ]);
  return writeMetaResponse(
    boardVersionFromBatchResults(results),
    data,
    changedDomains,
    changedModules,
  );
}

const WRITE_PATCH_TABLE_RE = /^[a-z_][a-z0-9_]*$/i;

function mergePatchRows(patches, table, rows) {
  if (!WRITE_PATCH_TABLE_RE.test(table) || !Array.isArray(rows) || !rows.length)
    return;
  if (!patches[table]) patches[table] = [];
  rows.forEach(function (row) {
    if (!row) return;
    var rowKey = table === "app_meta" ? row.key : row.id;
    if (rowKey == null) return;
    if (
      !patches[table].some(function (r) {
        return table === "app_meta" ? r.key === row.key : r.id == row.id;
      })
    ) {
      patches[table].push(row);
    }
  });
}

/**
 * 写响应附带 patches/deletions（对齐 Directus read-after-write、Frappe 返回完整 document）
 * Attach row patches / tombstones so clients can update rc cache without refetch.
 * Prefer options.patchRow / options.patchRows to avoid a post-write SELECT.
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
  const patches = {};
  if (options.patchRow && options.patchTable) {
    mergePatchRows(patches, options.patchTable, [options.patchRow]);
  }
  if (options.patchRows && typeof options.patchRows === "object") {
    Object.keys(options.patchRows).forEach(function (table) {
      mergePatchRows(patches, table, options.patchRows[table]);
    });
  }
  if (options.extraPatches && typeof options.extraPatches === "object") {
    Object.keys(options.extraPatches).forEach(function (table) {
      mergePatchRows(patches, table, options.extraPatches[table]);
    });
  }
  const tables = options.patchTables?.length
    ? options.patchTables
    : options.patchTable
      ? [options.patchTable]
      : [];
  const rowIds = options.rowIds || {};
  const defaultRowId = options.rowId;
  for (const table of tables) {
    if (!WRITE_PATCH_TABLE_RE.test(table)) continue;
    if (patches[table] && patches[table].length) continue;
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
      const have = new Set(
        (patches[table] || []).map(function (r) {
          return r.id;
        }),
      );
      const missing = ids.filter(function (id) {
        return !have.has(id);
      });
      if (!missing.length) continue;
      const placeholders = missing
        .map(function () {
          return "?";
        })
        .join(",");
      const rows = await queryD1(
        env,
        `SELECT * FROM ${table} WHERE id IN (${placeholders})`,
        missing,
      );
      mergePatchRows(patches, table, rows);
    }
  }
  if (Object.keys(patches).length) out.patches = patches;
  // Explicit only: incomplete patches must not skip client delta reconcile
  if (options.patchComplete === true) out.patch_complete = true;
  return out;
}

/** 床位最新房务态（board 用 bed_id 匹配）| Latest housekeeping rows for beds */
export async function fetchLatestHousekeepingPatches(env, bedIds) {
  const ids = [
    ...new Set(
      (bedIds || []).filter(function (id) {
        return id != null && id !== "";
      }),
    ),
  ];
  if (!ids.length) return [];
  const placeholders = ids
    .map(function () {
      return "?";
    })
    .join(",");
  return queryD1(
    env,
    `SELECT h.id, h.bed_id, h.status, h.changed_at, h.operator, h.notes
     FROM housekeeping h
     INNER JOIN (
       SELECT bed_id, MAX(changed_at) AS latest_at
       FROM housekeeping
       WHERE bed_id IN (${placeholders})
       GROUP BY bed_id
     ) x ON h.bed_id = x.bed_id AND h.changed_at = x.latest_at`,
    ids,
  );
}

/** 取消挂单后需从缓存移除的未来餐次 | Meal rows deleted after cancel */
export async function fetchMealDeletionsForLodgers(env, lodgerIds, afterDate) {
  const ids = [
    ...new Set(
      (lodgerIds || []).filter(function (id) {
        return id != null && id !== "";
      }),
    ),
  ];
  if (!ids.length || !afterDate) return [];
  const placeholders = ids
    .map(function () {
      return "?";
    })
    .join(",");
  const rows = await queryD1(
    env,
    `SELECT id FROM meals WHERE lodger_id IN (${placeholders}) AND date > ?`,
    ids.concat([afterDate]),
  );
  return rows.map(function (row) {
    return { table_name: "meals", row_id: row.id };
  });
}

export { recordSyncDeletion };
