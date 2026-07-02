import { readJson, clientIp, json } from "../../../_shared/http.js";
import { safeErrorMessage } from "../../../_shared/d1.js";
import {
  authenticateByRole,
  authenticateByUsername,
} from "../../../_shared/auth-login.js";
import { buildDualAuthSuccess } from "../../../_shared/auth-response.js";

/** POST /api/v1/auth/login — 双 token 登录 | Login with access + refresh cookie */
export async function onRequestPost({ request, env }) {
  if (!env.KETANG_DB) {
    return json({ error: "缺少 D1 绑定 KETANG_DB" }, 500);
  }
  const body = await readJson(request);
  if (!body) return json({ error: "请求格式错误" }, 400);
  const ip = clientIp(request);
  const meta = {
    ip,
    userAgent: request.headers.get("user-agent") || "",
  };
  try {
    let user = null;
    if (body.role) {
      user = await authenticateByRole(
        env,
        ip,
        String(body.role || ""),
        body.password || "",
      );
    } else if (body.username) {
      user = await authenticateByUsername(
        env,
        ip,
        String(body.username || ""),
        body.password || "",
      );
    } else {
      return json({ error: "请提供 role 或 username" }, 400);
    }
    if (!user) return json({ error: "身份或密码错误" }, 401);
    return await buildDualAuthSuccess(env, request, user, meta);
  } catch (error) {
    return json({ error: safeErrorMessage(error) }, 500);
  }
}
