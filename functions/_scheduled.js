/** R2 定时备份 | Scheduled D1 → R2 backup (Phase 6) */

import { initRemoteDatabase } from "./_shared/d1.js";
import { exportD1BackupJson } from "./_shared/backup-export.js";

export async function onScheduled(event, env, ctx) {
  if (!env.KETANG_DB) {
    console.warn("scheduled backup skipped: no KETANG_DB");
    return;
  }
  if (!env.KETANG_BACKUP) {
    console.warn("scheduled backup skipped: no KETANG_BACKUP R2 binding");
    return;
  }
  ctx.waitUntil(runBackup(env));
}

async function runBackup(env) {
  await initRemoteDatabase(env);
  const payload = await exportD1BackupJson(env);
  const stamp = payload.exported_at.replace(/[:.]/g, "-");
  const key = `ketang-backup-${stamp}.json`;
  await env.KETANG_BACKUP.put(key, JSON.stringify(payload), {
    httpMetadata: { contentType: "application/json" },
  });
  console.log("backup written:", key);
}
