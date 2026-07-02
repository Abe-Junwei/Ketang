import { signAccessToken, ACCESS_TTL_SEC } from "./auth.js";
import { createRefreshSession, REFRESH_TTL_SEC } from "./refresh-sessions.js";
import {
  refreshCookieHeader,
  clearRefreshCookieHeader,
} from "./cookies.js";
import { jsonWithCookies } from "./http.js";
import { getSessionPermissions } from "./permissions.js";

export function sessionUserPayload(user) {
  return {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    role: user.role,
    is_advanced: !!user.is_advanced,
    auth_version: user.auth_version != null ? Number(user.auth_version) || 1 : 1,
  };
}

/** 登录成功：短 access + HttpOnly refresh Cookie | Dual-token login response */
export async function buildDualAuthSuccess(env, request, freshUser, meta) {
  const sessionShape = {
    role: freshUser.role,
    id: freshUser.id,
    sub: freshUser.id,
    is_advanced: !!freshUser.is_advanced,
  };
  const permissions = await getSessionPermissions(env, sessionShape);
  const access_token = await signAccessToken(env, freshUser);
  const refresh = await createRefreshSession(env, freshUser, meta);
  const body = {
    access_token,
    token: access_token,
    expires_in: ACCESS_TTL_SEC,
    user: sessionUserPayload(freshUser),
    permissions,
  };
  return jsonWithCookies(body, 200, [
    refreshCookieHeader(refresh.token, REFRESH_TTL_SEC),
  ]);
}

/** 续期成功：新 access + 旋转 refresh Cookie | Refresh rotation response */
export async function buildRefreshSuccess(env, user, permissions, refreshToken) {
  const access_token = await signAccessToken(env, user);
  const body = {
    access_token,
    token: access_token,
    expires_in: ACCESS_TTL_SEC,
    user: sessionUserPayload(user),
    permissions,
  };
  return jsonWithCookies(body, 200, [
    refreshCookieHeader(refreshToken, REFRESH_TTL_SEC),
  ]);
}

export function buildLogoutResponse() {
  return jsonWithCookies({ ok: true }, 200, [clearRefreshCookieHeader()]);
}
