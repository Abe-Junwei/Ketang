import { clientIp, json } from "../../../_shared/http.js";
import { safeErrorMessage } from "../../../_shared/d1.js";
import { getRefreshCookie } from "../../../_shared/cookies.js";
import { consumeRefreshToken } from "../../../_shared/refresh-sessions.js";
import { buildRefreshSuccess } from "../../../_shared/auth-response.js";
import { getSessionPermissions } from "../../../_shared/permissions.js";
import { clearAllAuthCookieHeaders } from "../../../_shared/cookies.js";
import { jsonWithCookies } from "../../../_shared/http.js";

/** POST /api/v1/auth/refresh — Cookie 续期 access | Refresh access via HttpOnly cookie */
export async function onRequestPost({ request, env }) {
  if (!env.KETANG_DB) {
    return json({ error: "缺少 D1 绑定 KETANG_DB" }, 500);
  }
  const rawToken = getRefreshCookie(request);
  if (!rawToken) {
    return jsonWithCookies(
      { error: "登录已过期，请重新登录" },
      401,
      clearAllAuthCookieHeaders(),
    );
  }
  const meta = {
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent") || "",
  };
  try {
    const rotated = await consumeRefreshToken(env, rawToken, meta);
    if (!rotated) {
      return jsonWithCookies(
        { error: "登录已过期，请重新登录" },
        401,
        clearAllAuthCookieHeaders(),
      );
    }
    const sessionShape = {
      role: rotated.user.role,
      id: rotated.user.id,
      sub: rotated.user.id,
      is_advanced: !!rotated.user.is_advanced,
    };
    const permissions = await getSessionPermissions(env, sessionShape);
    return await buildRefreshSuccess(
      env,
      rotated.user,
      permissions,
      rotated.refreshToken,
    );
  } catch (error) {
    return json({ error: safeErrorMessage(error) }, 500);
  }
}
