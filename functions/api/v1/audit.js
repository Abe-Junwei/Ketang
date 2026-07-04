import { json, readJson } from "../../_shared/http.js";
import { requireSession } from "../../_shared/auth.js";
import {
  ensureBusinessDatabaseReady,
  insertAudit,
  queryD1,
  safeErrorMessage,
} from "../../_shared/d1.js";

/** POST /api/v1/audit — 客户端审计日志（替代 /api/db run audit）| Client audit log */
export async function onRequestPost({ request, env }) {
  if (!env.KETANG_DB) return json({ error: "缺少 D1 绑定 KETANG_DB" }, 500);
  try {
    await ensureBusinessDatabaseReady(env);
    const session = await requireSession(request, env, (sql, p) =>
      queryD1(env, sql, p),
    );
    const body = await readJson(request);
    if (!body || !body.action) return json({ error: "缺少 action" }, 400);
    await insertAudit(
      env,
      String(body.action),
      body.target_type || null,
      body.target_id != null ? body.target_id : null,
      body.detail || {},
      session,
    );
    return json({ ok: true });
  } catch (error) {
    const status = /登录已过期/.test(error.message) ? 401 : 500;
    return json({ error: safeErrorMessage(error) }, status);
  }
}
