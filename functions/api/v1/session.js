import { createRequestTimer } from "../../_shared/timing.js";
import { getSessionUser } from "../../_shared/users.js";
import { queryD1, safeErrorMessage } from "../../_shared/d1.js";

/** GET /api/v1/session — 会话自检，不触发 schema init | Session check without full init */
export async function onRequestGet({ request, env }) {
  if (!env.KETANG_DB) {
    return createRequestTimer().finish(
      { error: "缺少 D1 绑定 KETANG_DB" },
      request,
      500,
    );
  }
  const timer = createRequestTimer();
  try {
    const result = await timer.stage("session_ms", () =>
      getSessionUser(env, request, (sql, params) => queryD1(env, sql, params)),
    );
    if (!result) {
      return timer.finish({ error: "登录已过期，请重新登录" }, request, 401);
    }
    return timer.finish(result, request);
  } catch (error) {
    return timer.finish({ error: safeErrorMessage(error) }, request, 500);
  }
}
