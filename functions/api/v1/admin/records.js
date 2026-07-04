import { readJson } from "../../../_shared/http.js";
import { requireSession } from "../../../_shared/auth.js";
import {
  ensureDatabaseReady,
  queryD1,
  safeErrorMessage,
} from "../../../_shared/d1.js";
import { handleAdminRecord } from "../../../_shared/admin-records.js";
import { createRequestTimer } from "../../../_shared/timing.js";

const bindQuery = (env) => (sql, params) => queryD1(env, sql, params);

/** POST /api/v1/admin/records — 管理写入口（分段计时） */
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
    await timer.stage("init_ms", () =>
      ensureDatabaseReady(env, { allowMigrationFallback: false }),
    );
    const session = await timer.stage("auth_ms", () =>
      requireSession(request, env, bindQuery(env)),
    );
    const body = await timer.stage("parse_ms", () => readJson(request));
    if (!body?.resource || !body?.action) {
      return timer.finish({ error: "缺少 resource 或 action" }, request, 400);
    }
    const subtiming = {};
    const result = await handleAdminRecord(env, session, body, subtiming);
    timer.mark("handler_ms", subtiming.handler_ms || 0);
    timer.mark("write_tail_ms", subtiming.write_tail_ms || 0);
    timer.mark("patch_ms", subtiming.patch_ms || 0);
    timer.mark(
      "biz_ms",
      (subtiming.handler_ms || 0) +
        (subtiming.write_tail_ms || 0) +
        (subtiming.patch_ms || 0),
    );
    return timer.finish(result, request);
  } catch (error) {
    const status = /登录已过期/.test(error.message)
      ? 401
      : /管理员|权限/.test(error.message)
        ? 403
        : 400;
    return timer.finish({ error: safeErrorMessage(error) }, request, status);
  }
}
