/** D1 全库 JSON 导出（Cron/R2 备份）| Export D1 snapshot as JSON */

import { queryD1 } from "./d1.js";

const BACKUP_TABLES = [
  "app_meta",
  "users",
  "rooms",
  "beds",
  "guests",
  "lodgers",
  "reservations",
  "events",
  "meals",
  "payments",
  "housekeeping",
  "audit_logs",
  "rooming_plans",
  "rooming_assignments",
  "rooming_adjustments",
  "rooming_queue",
];

export async function exportD1BackupJson(env) {
  const tables = {};
  for (const table of BACKUP_TABLES) {
    try {
      const rows = await queryD1(env, `SELECT * FROM ${table}`);
      tables[table] = rows || [];
    } catch {
      tables[table] = [];
    }
  }
  return {
    exported_at: new Date().toISOString(),
    schema_version: tables.app_meta?.find((r) => r.key === "schema_version")
      ?.value,
    tables,
  };
}
