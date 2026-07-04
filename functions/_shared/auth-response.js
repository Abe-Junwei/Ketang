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
    must_change_password: !!user.must_change_password,
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
  timer,
) {
  const sessionShape = {
    role: freshUser.role,
    id: freshUser.id,
    sub: freshUser.id,
    is_advanced: !!freshUser.is_advanced,
  };
  const stage = async (name, fn) => (timer ? timer.stage(name, fn) : fn());
  const permissions = await stage("permissions_ms", () =>
    getSessionPermissions(env, sessionShape),
  );
  const access_token = await stage("access_token_ms", () =>
    signAccessToken(env, freshUser),
  );
  const refresh = await stage("refresh_session_ms", () =>
    createRefreshSession(env, freshUser, meta),
  );
  const cookies = [
    accessCookieHeader(access_token, ACCESS_TTL_SEC),
    refreshCookieHeader(refresh.token, REFRESH_TTL_SEC),
  ];
  const body = sessionBody(freshUser, permissions, extraBody);
  if (timer) {
    return timer.finishWithCookies(body, request, 200, cookies);
  }
  return jsonWithCookies(body, 200, cookies);
}

/** 续期成功：新 access + 旋转 refresh Cookie | Refresh rotation response */
export async function buildRefreshSuccess(
  env,
  user,
  permissions,
  refreshToken,
  request,
  extraBody,
  timer,
) {
  const access_token = await signAccessToken(env, user);
  const body = sessionBody(user, permissions, extraBody);
  const cookies = [
    accessCookieHeader(access_token, ACCESS_TTL_SEC),
    refreshCookieHeader(refreshToken, REFRESH_TTL_SEC),
  ];
  if (timer && request) {
    return timer.finishWithCookies(body, request, 200, cookies);
  }
  return jsonWithCookies(body, 200, cookies);
}

/** GET /session：续签 access Cookie | Session check with access cookie rotation */
export function buildSessionUserResponse(
  env,
  sessionResult,
  extraBody,
  timer,
  request,
) {
  if (!sessionResult) return null;
  const body = sessionBody(
    sessionResult.user,
    sessionResult.permissions,
    extraBody,
  );
  const cookies = [
    accessCookieHeader(sessionResult.access_token, ACCESS_TTL_SEC),
  ];
  if (timer && request) {
    return timer.finishWithCookies(body, request, 200, cookies);
  }
  return jsonWithCookies(body, 200, cookies);
}

export function buildLogoutResponse() {
  return jsonWithCookies({ ok: true }, 200, clearAllAuthCookieHeaders());
}
