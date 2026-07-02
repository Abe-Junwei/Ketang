import { getBoardVersion, initRemoteDatabase, queryD1 } from "./d1.js";
import { LODGING_APP_META_KEYS } from "./operational-settings.js";
import { getSessionPermissions } from "./permissions.js";
import {
  canSyncReadModel,
  sanitizeRowForRole,
} from "./read-model.js";

const TABLE_NAME_RE = /^[a-z_][a-z0-9_]*$/i;

/** 模块 → 表清单 | Module to table list */
export const READ_MODULE_TABLES = {
  board: ["rooms", "beds", "lodgers", "housekeeping", "app_meta"],
  lodgers: ["rooms", "beds", "guests", "lodgers", "payments"],
  events: [
    "events",
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
};

const MODULE_PERMISSIONS = {
  board: ["board.read"],
  lodgers: ["lodging.read"],
  events: ["lodging.read"],
  reservations: ["reservation.read"],
  meals: ["meals.read"],
  settings: ["settings.read"],
  settings_rooms: ["settings.read"],
  settings_beds: ["settings.read"],
  settings_guests: ["settings.read"],
};

function assertModuleKey(moduleKey) {
  if (!READ_MODULE_TABLES[moduleKey]) throw new Error("无效的读模块");
  return moduleKey;
}

function hasModulePermission(permissions, moduleKey) {
  const required = MODULE_PERMISSIONS[moduleKey] || [];
  return required.some((code) => permissions.includes(code));
}

async function fetchModuleTableRows(env, table, permissions) {
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
  return queryD1(env, `SELECT * FROM ${table}`, []);
}

export async function buildReadModule(env, session, moduleKey, options) {
  const key = assertModuleKey(moduleKey);
  if (!options?.skipInit) {
    await initRemoteDatabase(env);
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
      const rows = await fetchModuleTableRows(env, table, permissions);
      data[table] = rows.map((row) =>
        sanitizeRowForRole(table, row, session.role),
      );
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
    await initRemoteDatabase(env);
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
  const roomingTables = [
    "rooming_plans",
    "rooming_assignments",
    "rooming_checkin_queue",
    "rooming_adjustments",
  ];
  await Promise.all(
    roomingTables.map(async function (table) {
      const rows = await queryD1(
        env,
        `SELECT * FROM ${table} WHERE event_id = ?`,
        [id],
      );
      tables[table] = rows.map((row) =>
        sanitizeRowForRole(table, row, session.role),
      );
    }),
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
