import { json } from "../../_shared/http.js";
import { requireSession } from "../../_shared/auth.js";
import { queryD1, safeErrorMessage } from "../../_shared/d1.js";
import { buildReadModel } from "../../_shared/read-model.js";

/** GET /api/v1/read-model — 单次拉取 UI 读模型 | One-shot client read-model sync */
export async function onRequestGet({ request, env }) {
  if (!env.KETANG_DB) return json({ error: "缺少 D1 绑定 KETANG_DB" }, 500);
  try {
    const session = await requireSession(request, env, (sql, p) =>
      queryD1(env, sql, p),
    );
    const payload = await buildReadModel(env, session);
    return json(payload);
  } catch (error) {
    const status = /登录已过期/.test(error.message)
      ? 401
      : /管理员|权限/.test(error.message)
        ? 403
        : 500;
    return json({ error: safeErrorMessage(error) }, status);
  }
}
