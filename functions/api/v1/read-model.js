import { requireSession } from "../../_shared/auth.js";
import { initRemoteDatabase, queryD1, safeErrorMessage } from "../../_shared/d1.js";
import { buildReadModel } from "../../_shared/read-model.js";
import { createRequestTimer } from "../../_shared/timing.js";

/** GET /api/v1/read-model — 单次拉取 UI 读模型 | One-shot client read-model sync */
export async function onRequestGet({ request, env }) {
  if (!env.KETANG_DB) {
    return createRequestTimer()
      .finish({ error: "缺少 D1 绑定 KETANG_DB" }, request, 500);
  }
  const timer = createRequestTimer();
  try {
    const session = await timer.stage("auth_ms", () =>
      requireSession(request, env, (sql, p) => queryD1(env, sql, p)),
    );
    await timer.stage("init_ms", () => initRemoteDatabase(env));
    const payload = await timer.stage("read_model_ms", () =>
      buildReadModel(env, session, { skipInit: true }),
    );
    return timer.finish(payload, request);
  } catch (error) {
    const status = /登录已过期/.test(error.message)
      ? 401
      : /管理员|权限/.test(error.message)
        ? 403
        : 500;
    return timer.finish({ error: safeErrorMessage(error) }, request, status);
  }
}
