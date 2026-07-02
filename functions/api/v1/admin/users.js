import {
  json,
  readJson,
  apiErrorStatus,
  clientIp,
} from "../../../_shared/http.js";
import { requireSession } from "../../../_shared/auth.js";
import { buildDualAuthSuccess } from "../../../_shared/auth-response.js";
import {
  initRemoteDatabase,
  queryD1,
  safeErrorMessage,
} from "../../../_shared/d1.js";
import {
  listUsers,
  createUser,
  updateUser,
  deactivateUser,
  reactivateUser,
  resetUserPassword,
} from "../../../_shared/users.js";

const bindQuery = (env) => (sql, p) => queryD1(env, sql, p);

export async function onRequestGet({ request, env }) {
  if (!env.KETANG_DB) return json({ error: "缺少 D1 绑定 KETANG_DB" }, 500);
  try {
    await initRemoteDatabase(env);
    const session = await requireSession(request, env, bindQuery(env));
    const users = await listUsers(env, session);
    return json({ users });
  } catch (error) {
    const status = apiErrorStatus(error, 400);
    return json({ error: safeErrorMessage(error) }, status);
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.KETANG_DB) return json({ error: "缺少 D1 绑定 KETANG_DB" }, 500);
  try {
    await initRemoteDatabase(env);
    const session = await requireSession(request, env, bindQuery(env));
    const body = await readJson(request);
    if (!body?.action) return json({ error: "缺少 action" }, 400);
    if (body.action === "create")
      return json(await createUser(env, session, body));
    if (body.action === "update") {
      const result = await updateUser(env, session, body);
      if (result.user) {
        const meta = {
          ip: clientIp(request),
          userAgent: request.headers.get("user-agent") || "",
        };
        return await buildDualAuthSuccess(env, request, result.user, meta, {
          ok: true,
          password_changed: !!result.password_changed,
        });
      }
      return json(result);
    }
    if (body.action === "deactivate")
      return json(await deactivateUser(env, session, body));
    if (body.action === "reactivate")
      return json(await reactivateUser(env, session, body));
    if (body.action === "reset_password")
      return json(await resetUserPassword(env, session, body));
    return json({ error: "未知 action" }, 400);
  } catch (error) {
    const status = apiErrorStatus(error, 400);
    return json({ error: safeErrorMessage(error) }, status);
  }
}
