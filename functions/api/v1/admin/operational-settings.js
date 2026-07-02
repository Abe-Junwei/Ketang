import { json, readJson, apiErrorStatus } from "../../../_shared/http.js";
import { requireSession } from "../../../_shared/auth.js";
import {
  ensureDatabaseForAuth,
  queryD1,
  safeErrorMessage,
} from "../../../_shared/d1.js";
import { requirePermission } from "../../../_shared/permissions.js";
import {
  getOperationalSettings,
  saveOperationalSettings,
} from "../../../_shared/operational-settings.js";

/** GET/POST /api/v1/admin/operational-settings — 房务等运营配置 | Operational settings */
export async function onRequestGet({ request, env }) {
  if (!env.KETANG_DB) return json({ error: "缺少 D1 绑定 KETANG_DB" }, 500);
  try {
    const session = await requireSession(request, env, (sql, p) =>
      queryD1(env, sql, p),
    );
    await ensureDatabaseForAuth(env);
    await requirePermission(env, session, "users.write");
    return json(await getOperationalSettings(env));
  } catch (error) {
    return json({ error: safeErrorMessage(error) }, apiErrorStatus(error));
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.KETANG_DB) return json({ error: "缺少 D1 绑定 KETANG_DB" }, 500);
  try {
    const session = await requireSession(request, env, (sql, p) =>
      queryD1(env, sql, p),
    );
    await ensureDatabaseForAuth(env);
    await requirePermission(env, session, "users.write");
    const body = await readJson(request);
    if (!body) return json({ error: "请求格式错误" }, 400);
    return json(await saveOperationalSettings(env, session, body));
  } catch (error) {
    return json({ error: safeErrorMessage(error) }, apiErrorStatus(error));
  }
}
