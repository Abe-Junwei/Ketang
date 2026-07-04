import { requireSession, requireAdmin } from "../../../_shared/auth.js";
import {
  ensureDatabaseReady,
  queryD1,
  safeErrorMessage,
} from "../../../_shared/d1.js";
import { createRequestTimer } from "../../../_shared/timing.js";

/**
 * POST /api/v1/admin/migrate — 显式运行迁移/盖章 schema_ready_version
 * Explicit migration entry (not on normal business hot path).
 */
export async function onRequestPost({ request, env }) {
  if (!env.KETANG_DB) {
    return createRequestTimer().finish(
      { error: "缺少 D1 绑定 KETANG_DB" },
      request,
      500,
    );
  }
  const timer = createRequestTimer();
  try {
    const session = await timer.stage("auth_ms", () =>
      requireSession(request, env, (sql, p) => queryD1(env, sql, p)),
    );
    requireAdmin(session);
    await timer.stage("migrate_ms", () =>
      ensureDatabaseReady(env, { allowMigrationFallback: true }),
    );
    const ready = await queryD1(
      env,
      "SELECT value FROM app_meta WHERE key = ? LIMIT 1",
      ["schema_ready_version"],
    );
    const version = await queryD1(
      env,
      "SELECT MIN(version) AS v FROM schema_version",
      [],
    );
    return timer.finish(
      {
        ok: true,
        schema_version: parseInt(version[0]?.v || "0", 10) || 0,
        schema_ready_version: parseInt(ready[0]?.value || "0", 10) || 0,
      },
      request,
    );
  } catch (error) {
    const status = /登录已过期/.test(error.message)
      ? 401
      : /管理员/.test(error.message)
        ? 403
        : 400;
    return timer.finish(
      { error: safeErrorMessage(error) },
      request,
      status,
    );
  }
}
