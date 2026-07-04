import { readJson, clientIp, json } from "../../../_shared/http.js";
import { requireSession } from "../../../_shared/auth.js";
import {
  ensureDatabaseForAuth,
  queryD1,
  safeErrorMessage,
} from "../../../_shared/d1.js";
import { changeUserPassword } from "../../../_shared/users.js";
import { buildDualAuthSuccess } from "../../../_shared/auth-response.js";

/** POST /api/v1/auth/change-password | Change password with new session cookies */
export async function onRequestPost({ request, env }) {
  if (!env.KETANG_DB) return json({ error: "缺少 D1 绑定 KETANG_DB" }, 500);
  const body = await readJson(request);
  if (!body) return json({ error: "请求格式错误" }, 400);
  try {
    await ensureDatabaseForAuth(env);
    const session = await requireSession(request, env, (sql, p) =>
      queryD1(env, sql, p),
    );
    const result = await changeUserPassword(
      env,
      session.sub || session.id,
      body.old_password,
      body.new_password,
    );
    const meta = {
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent") || "",
    };
    return await buildDualAuthSuccess(env, request, result.user, meta, {
      ok: true,
    });
  } catch (error) {
    const status = /登录已过期/.test(error.message)
      ? 401
      : /原密码错误|密码|用户/.test(error.message)
        ? 400
        : 500;
    return json({ error: safeErrorMessage(error) }, status);
  }
}
