import { json, readJson } from "../../_shared/http.js";
import { requireSession } from "../../_shared/auth.js";
import { queryD1, safeErrorMessage } from "../../_shared/d1.js";
import { requirePermission } from "../../_shared/permissions.js";
import { apiCheckIn } from "../../_shared/lodgers.js";

const bindQuery = (env) => (sql, params) => queryD1(env, sql, params);

export async function onRequestPost({ request, env }) {
  if (!env.KETANG_DB) return json({ error: "缺少 D1 绑定 KETANG_DB" }, 500);
  try {
    const session = await requireSession(request, env, bindQuery(env));
    await requirePermission(env, session, "lodging.checkin");
    const body = await readJson(request);
    if (!body) return json({ error: "请求格式错误" }, 400);
    const result = await apiCheckIn(env, session, body);
    return json(result);
  } catch (error) {
    const status = /登录已过期/.test(error.message)
      ? 401
      : /权限不足/.test(error.message)
        ? 403
        : 500;
    return json({ error: safeErrorMessage(error) }, status);
  }
}
