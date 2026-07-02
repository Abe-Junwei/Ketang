import { signAccessToken, ACCESS_TTL_SEC } from "./auth.js";
import { createRefreshSession, REFRESH_TTL_SEC } from "./refresh-sessions.js";
import {
  accessCookieHeader,
  refreshCookieHeader,
  clearAllAuthCookieHeaders,
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
    auth_version:
      user.auth_version != null ? Number(user.auth_version) || 1 : 1,
  };
}

function sessionBody(user, permissions, extraBody) {
  return {
    expires_in: ACCESS_TTL_SEC,
    user: sessionUserPayload(user),
    permissions,
    ...(extraBody || {}),
  };
}

/** 登录成功：双 HttpOnly Cookie | Dual HttpOnly cookie login response */
export async function buildDualAuthSuccess(
  env,
  request,
  freshUser,
  meta,
  extraBody,
) {
  const sessionShape = {
    role: freshUser.role,
    id: freshUser.id,
    sub: freshUser.id,
    is_advanced: !!freshUser.is_advanced,
  };
  const permissions = await getSessionPermissions(env, sessionShape);
  const access_token = await signAccessToken(env, freshUser);
  const refresh = await createRefreshSession(env, freshUser, meta);
  return jsonWithCookies(sessionBody(freshUser, permissions, extraBody), 200, [
    accessCookieHeader(access_token, ACCESS_TTL_SEC),
    refreshCookieHeader(refresh.token, REFRESH_TTL_SEC),
  ]);
}

/** 续期成功：新 access + 旋转 refresh Cookie | Refresh rotation response */
export async function buildRefreshSuccess(
  env,
  user,
  permissions,
  refreshToken,
) {
  const access_token = await signAccessToken(env, user);
  return jsonWithCookies(sessionBody(user, permissions), 200, [
    accessCookieHeader(access_token, ACCESS_TTL_SEC),
    refreshCookieHeader(refreshToken, REFRESH_TTL_SEC),
  ]);
}

/** GET /session：续签 access Cookie | Session check with access cookie rotation */
export function buildSessionUserResponse(env, sessionResult) {
  if (!sessionResult) return null;
  const body = {
    expires_in: ACCESS_TTL_SEC,
    user: sessionResult.user,
    permissions: sessionResult.permissions,
  };
  return jsonWithCookies(body, 200, [
    accessCookieHeader(sessionResult.access_token, ACCESS_TTL_SEC),
  ]);
}

export function buildLogoutResponse() {
  return jsonWithCookies({ ok: true }, 200, clearAllAuthCookieHeaders());
}
