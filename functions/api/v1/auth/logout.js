import { json } from "../../../_shared/http.js";
import { safeErrorMessage } from "../../../_shared/d1.js";
import { getRefreshCookie } from "../../../_shared/cookies.js";
import {
  hashRefreshToken,
  revokeRefreshSessionByHash,
} from "../../../_shared/refresh-sessions.js";
import { buildLogoutResponse } from "../../../_shared/auth-response.js";

/** POST /api/v1/auth/logout — 撤销 refresh 并清 Cookie | Logout */
export async function onRequestPost({ request, env }) {
  if (!env.KETANG_DB) {
    return json({ error: "缺少 D1 绑定 KETANG_DB" }, 500);
  }
  try {
    const rawToken = getRefreshCookie(request);
    if (rawToken) {
      const tokenHash = await hashRefreshToken(env, rawToken);
      await revokeRefreshSessionByHash(env, tokenHash);
    }
    return buildLogoutResponse();
  } catch (error) {
    return json({ error: safeErrorMessage(error) }, 500);
  }
}
