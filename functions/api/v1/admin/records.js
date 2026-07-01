import { json, readJson } from "../../../_shared/http.js";
import { requireSession } from "../../../_shared/auth.js";
import {
  initRemoteDatabase,
  queryD1,
  safeErrorMessage,
} from "../../../_shared/d1.js";
import { handleAdminRecord } from "../../../_shared/admin-records.js";

const bindQuery = (env) => (sql, params) => queryD1(env, sql, params);

export async function onRequestPost({ request, env }) {
  if (!env.KETANG_DB) return json({ error: "缺少 D1 绑定 KETANG_DB" }, 500);
  try {
    await initRemoteDatabase(env);
    const session = await requireSession(request, env, bindQuery(env));
    const body = await readJson(request);
    if (!body?.resource || !body?.action)
      return json({ error: "缺少 resource 或 action" }, 400);
    return json(await handleAdminRecord(env, session, body));
  } catch (error) {
    const status = /登录已过期/.test(error.message)
      ? 401
      : /管理员|权限/.test(error.message)
        ? 403
        : 400;
    return json({ error: safeErrorMessage(error) }, status);
  }
}
