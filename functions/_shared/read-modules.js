import { getBoardVersion, ensureDatabaseReady, queryD1 } from "./d1.js";
import { LODGING_APP_META_KEYS } from "./operational-settings.js";
import { getSessionPermissions } from "./permissions.js";
import { canSyncReadModel, sanitizeRowForRole } from "./read-model.js";

const TABLE_NAME_RE = /^[a-z_][a-z0-9_]*$/i;

/** 模块 → 表清单 | Module to table list */
export const READ_MODULE_TABLES = {
  board: ["rooms", "beds", "lodgers", "housekeeping", "app_meta"],
  lodgers: ["rooms", "beds", "guests", "lodgers", "payments"],
  /** 营期主数据（列表/下拉）；排房表见 event_rooming | Events only; rooming in event_rooming */
  events: ["events"],
  /** 排房表（预分房页按需）| Rooming tables (rooming views only) */
  event_rooming: [
    "rooming_plans",
    "rooming_assignments",
    "rooming_checkin_queue",
    "rooming_adjustments",
  ],
  reservations: ["guests", "reservations"],
  meals: ["rooms", "beds", "guests", "lodgers", "meals"],
  settings: ["rooms", "beds", "guests"],
  settings_rooms: ["rooms"],
  settings_beds: ["rooms", "beds"],
  settings_guests: ["guests"],
  lodgers_active: ["lodgers", "beds"],
  /** 近半年非在住 + 支付（报表/预报轻量）| Recent non-active lodgers + payments */
  lodgers_recent: ["lodgers", "payments"],
  lodgers_lookup: ["lodgers"],
  /** @deprecated 兼容旧探针；等同 lodgers_active */
  lodgers_records: ["lodgers", "beds"],
};

/** board 字段投影 | View-model fields for read/board (G-3 slim payload) */
const BOARD_TABLE_FIELDS = {
  rooms: ["id", "name", "floor", "location", "dorm_type"],
  beds: ["id", "room_id", "bed_number", "status"],
  lodgers: [
    "id",
    "bed_id",
    "name",
    "dharma_name",
    "gender",
    "status",
    "check_in_date",
    "expected_check_out",
    "actual_check_out",
    "event_id",
  ],
  housekeeping: ["bed_id", "status", "changed_at"],
};

const LODGERS_ACTIVE_BED_FIELDS = ["id", "room_id", "bed_number"];
const LODGERS_ACTIVE_LODGER_FIELDS = [
  "id",
  "bed_id",
  "guest_id",
  "name",
  "dharma_name",
  "gender",
  "phone",
  "role",
  "class_name",
  "status",
  "check_in_date",
  "expected_check_out",
  "actual_check_out",
  "event_id",
];
const LODGERS_LOOKUP_FIELDS = [
  "id",
  "name",
  "dharma_name",
  "phone",
  "id_card",
  "status",
  "bed_id",
  "guest_id",
];
const LODGERS_RECENT_DAYS = 180;
const HISTORY_PAGE_MAX = 2000;

function projectRowFields(fields, row) {
  if (!fields || !row || typeof row !== "object") return row;
  const out = {};
  fields.forEach(function (field) {
    if (Object.prototype.hasOwnProperty.call(row, field)) {
      out[field] = row[field];
    }
  });
  return out;
}

function projectBoardRow(table, row) {
  return projectRowFields(BOARD_TABLE_FIELDS[table], row);
}

/** 读模块是否为特殊分页/查询型 | Special query module (not static table list) */
export function isSpecialReadModule(moduleKey) {
  return moduleKey === "lodgers_history_page";
}

const MODULE_PERMISSIONS = {
  board: ["board.read"],
  lodgers: ["lodging.read"],
  events: ["lodging.read"],
  event_rooming: ["lodging.read"],
  reservations: ["reservation.read"],
  meals: ["meals.read"],
  settings: ["settings.read"],
  settings_rooms: ["settings.read"],
  settings_beds: ["settings.read"],
  settings_guests: ["settings.read"],
  lodgers_active: ["lodging.read"],
  lodgers_recent: ["lodging.read"],
  lodgers_lookup: ["lodging.read"],
  lodgers_records: ["lodging.read"],
  lodgers_history_page: ["lodging.read"],
};

function assertModuleKey(moduleKey) {
  if (!READ_MODULE_TABLES[moduleKey] && !isSpecialReadModule(moduleKey)) {
    throw new Error("无效的读模块");
  }
  return moduleKey;
}

function hasModulePermission(permissions, moduleKey) {
  const required = MODULE_PERMISSIONS[moduleKey] || [];
  return required.some((code) => permissions.includes(code));
}

async function fetchModuleTableRows(env, table, permissions, moduleKey) {
  if (!TABLE_NAME_RE.test(table)) throw new Error("无效的表名");
  if (table === "app_meta") {
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
  /** board 首屏瘦身：在住挂单 + 非净房房态 | Slim board payload for first paint */
  if (moduleKey === "board" && table === "lodgers") {
    return queryD1(
      env,
      `SELECT id, bed_id, name, dharma_name, gender, status,
              check_in_date, expected_check_out, actual_check_out, event_id
       FROM lodgers WHERE status = '在住'`,
      [],
    );
  }
  if (moduleKey === "board" && table === "housekeeping") {
    return queryD1(
      env,
      `SELECT h.bed_id, h.status, h.changed_at FROM housekeeping h
       INNER JOIN (
         SELECT bed_id, MAX(changed_at) AS latest_at
         FROM housekeeping
         GROUP BY bed_id
       ) x ON h.bed_id = x.bed_id AND h.changed_at = x.latest_at
       WHERE h.status != '净房'`,
      [],
    );
  }
  if (
    (moduleKey === "lodgers_active" || moduleKey === "lodgers_records") &&
    table === "lodgers"
  ) {
    const cols = LODGERS_ACTIVE_LODGER_FIELDS.join(", ");
    return queryD1(
      env,
      `SELECT ${cols} FROM lodgers WHERE status = '在住'`,
      [],
    );
  }
  if (
    (moduleKey === "lodgers_active" || moduleKey === "lodgers_records") &&
    table === "beds"
  ) {
    return queryD1(
      env,
      "SELECT id, room_id, bed_number FROM beds WHERE status != '备用'",
      [],
    );
  }
  if (moduleKey === "lodgers_recent" && table === "lodgers") {
    return queryD1(
      env,
      `SELECT * FROM lodgers
       WHERE status != '在住'
         AND (
           (actual_check_out IS NOT NULL AND actual_check_out >= date('now', ?))
           OR (actual_check_out IS NULL AND check_in_date >= date('now', ?))
         )
       ORDER BY check_in_date DESC, id DESC`,
      [`-${LODGERS_RECENT_DAYS} days`, `-${LODGERS_RECENT_DAYS} days`],
    );
  }
  if (moduleKey === "lodgers_lookup" && table === "lodgers") {
    const cols = LODGERS_LOOKUP_FIELDS.join(", ");
    return queryD1(env, `SELECT ${cols} FROM lodgers`, []);
  }
  return queryD1(env, `SELECT * FROM ${table}`, []);
}

export async function buildLodgersHistoryPage(env, session, query, options) {
  if (!options?.skipInit) {
    await ensureDatabaseReady(env, { allowMigrationFallback: false });
  }
  const permissions = await getSessionPermissions(env, session);
  if (!canSyncReadModel(permissions)) throw new Error("权限不足");
  if (!permissions.includes("lodging.read")) throw new Error("权限不足");

  const limit = Math.min(
    Math.max(parseInt(query?.limit, 10) || 500, 1),
    HISTORY_PAGE_MAX,
  );
  const offset = Math.max(parseInt(query?.offset, 10) || 0, 0);
  const start = String(query?.start || "").trim();
  const end = String(query?.end || "").trim();
  const kw = String(query?.kw || "").trim();
  const room = String(query?.room || "").trim();
  const roles = [].concat(query?.roles || []).flatMap(function (v) {
    return String(v || "")
      .split(",")
      .map(function (s) {
        return s.trim();
      })
      .filter(Boolean);
  });

  let sql = `
    SELECT l.*, r.name AS room_name, b.bed_number, e.name AS event_name
    FROM lodgers l
    LEFT JOIN beds b ON b.id = l.bed_id
    LEFT JOIN rooms r ON r.id = b.room_id
    LEFT JOIN events e ON e.id = l.event_id
    WHERE 1=1`;
  const params = [];
  if (start) {
    sql += " AND l.check_in_date >= ?";
    params.push(start);
  }
  if (end) {
    sql += " AND l.check_in_date <= ?";
    params.push(end);
  }
  if (room) {
    sql += " AND (r.name LIKE ? OR b.bed_number LIKE ?)";
    params.push("%" + room + "%", "%" + room + "%");
  }
  if (roles.length) {
    sql +=
      " AND l.role IN (" +
      roles
        .map(function () {
          return "?";
        })
        .join(",") +
      ")";
    params.push.apply(params, roles);
  }
  if (kw) {
    sql += " AND (l.name LIKE ? OR l.dharma_name LIKE ? OR l.phone LIKE ?)";
    params.push("%" + kw + "%", "%" + kw + "%", "%" + kw + "%");
  }
  sql += " ORDER BY l.check_in_date DESC, l.id DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const rows = await queryD1(env, sql, params);
  const version = await getBoardVersion(env);
  return {
    module: "lodgers_history_page",
    board_version: version,
    synced_at: new Date().toISOString(),
    page: { limit, offset, count: rows.length },
    tables: {
      lodgers: rows.map(function (row) {
        return sanitizeRowForRole("lodgers", row, session.role);
      }),
    },
  };
}

export async function buildReadModule(env, session, moduleKey, options) {
  const key = assertModuleKey(moduleKey);
  if (isSpecialReadModule(key)) {
    throw new Error("请使用专用 history 构建器");
  }
  if (!options?.skipInit) {
    await ensureDatabaseReady(env, { allowMigrationFallback: false });
  }
  const permissions = await getSessionPermissions(env, session);
  if (!canSyncReadModel(permissions)) {
    throw new Error("权限不足");
  }
  if (!hasModulePermission(permissions, key)) {
    throw new Error("权限不足");
  }
  const tables = READ_MODULE_TABLES[key];
  const data = {};
  await Promise.all(
    tables.map(async function (table) {
      const rows = await fetchModuleTableRows(env, table, permissions, key);
      data[table] = rows.map((row) => {
        const sanitized = sanitizeRowForRole(table, row, session.role);
        if (key === "board") return projectBoardRow(table, sanitized);
        if (
          (key === "lodgers_active" || key === "lodgers_records") &&
          table === "lodgers"
        ) {
          return projectRowFields(LODGERS_ACTIVE_LODGER_FIELDS, sanitized);
        }
        if (
          (key === "lodgers_active" || key === "lodgers_records") &&
          table === "beds"
        ) {
          return projectRowFields(LODGERS_ACTIVE_BED_FIELDS, sanitized);
        }
        if (key === "lodgers_lookup" && table === "lodgers") {
          return projectRowFields(LODGERS_LOOKUP_FIELDS, sanitized);
        }
        return sanitized;
      });
    }),
  );
  const version = await getBoardVersion(env);
  return {
    module: key,
    board_version: version,
    synced_at: new Date().toISOString(),
    tables: data,
  };
}

export async function buildEventDetailModule(env, session, eventId, options) {
  if (!options?.skipInit) {
    await ensureDatabaseReady(env, { allowMigrationFallback: false });
  }
  const permissions = await getSessionPermissions(env, session);
  if (!permissions.includes("lodging.read")) throw new Error("权限不足");
  const id = parseInt(eventId, 10);
  if (!id) throw new Error("缺少营期 ID");
  const eventRows = await queryD1(env, "SELECT * FROM events WHERE id = ?", [
    id,
  ]);
  if (!eventRows.length) throw new Error("营期不存在");
  const tables = {};
  tables.events = eventRows.map((row) =>
    sanitizeRowForRole("events", row, session.role),
  );
  const [plans, assignments, queue, adjustments] = await Promise.all([
    queryD1(env, "SELECT * FROM rooming_plans WHERE event_id = ?", [id]),
    queryD1(
      env,
      `SELECT ra.* FROM rooming_assignments ra
       JOIN rooming_plans rp ON rp.id = ra.plan_id
       WHERE rp.event_id = ?`,
      [id],
    ),
    queryD1(env, "SELECT * FROM rooming_checkin_queue WHERE event_id = ?", [
      id,
    ]),
    queryD1(env, "SELECT * FROM rooming_adjustments WHERE event_id = ?", [id]),
  ]);
  tables.rooming_plans = plans.map((row) =>
    sanitizeRowForRole("rooming_plans", row, session.role),
  );
  tables.rooming_assignments = assignments.map((row) =>
    sanitizeRowForRole("rooming_assignments", row, session.role),
  );
  tables.rooming_checkin_queue = queue.map((row) =>
    sanitizeRowForRole("rooming_checkin_queue", row, session.role),
  );
  tables.rooming_adjustments = adjustments.map((row) =>
    sanitizeRowForRole("rooming_adjustments", row, session.role),
  );
  const version = await getBoardVersion(env);
  return {
    module: "event_detail",
    event_id: id,
    board_version: version,
    synced_at: new Date().toISOString(),
    tables,
  };
}
