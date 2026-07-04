import { readJson } from "../../../_shared/http.js";
import { requireSession } from "../../../_shared/auth.js";
import {
  initRemoteDatabase,
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
    await timer.stage("init_ms", () => initRemoteDatabase(env));
    const session = await timer.stage("auth_ms", () =>
      requireSession(request, env, bindQuery(env)),
    );
    const body = await timer.stage("parse_ms", () => readJson(request));
    if (!body?.resource || !body?.action) {
      return timer.finish({ error: "缺少 resource 或 action" }, request, 400);
    }
    // biz_ms includes write_tail + patch until Phase E splits them
    const result = await timer.stage("biz_ms", () =>
      handleAdminRecord(env, session, body),
    );
    return timer.finish(result, request);
  } catch (error) {
    const status = /登录已过期/.test(error.message)
      ? 401
      : /管理员|权限/.test(error.message)
        ? 403
        : 400;
    return timer.finish(
      { error: safeErrorMessage(error) },
      request,
      status,
    );
  }
}
