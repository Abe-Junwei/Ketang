/** HttpOnly auth cookie helpers | 双 Cookie 会话工具 */

export const ACCESS_COOKIE_NAME = "ketang_access";
export const ACCESS_COOKIE_PATH = "/api";
export const REFRESH_COOKIE_NAME = "ketang_refresh";
export const REFRESH_COOKIE_PATH = "/api/v1/auth";

export function parseCookies(request) {
  const header = request.headers.get("cookie") || "";
  const out = {};
  header.split(";").forEach(function (part) {
    const trimmed = part.trim();
    if (!trimmed) return;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) return;
    const key = trimmed.slice(0, eq);
    const value = trimmed.slice(eq + 1);
    out[key] = decodeURIComponent(value);
  });
  return out;
}

export function getAccessCookie(request) {
  return parseCookies(request)[ACCESS_COOKIE_NAME] || "";
}

export function getRefreshCookie(request) {
  return parseCookies(request)[REFRESH_COOKIE_NAME] || "";
}

function authCookieHeader(name, path, token, maxAgeSec) {
  return (
    name +
    "=" +
    encodeURIComponent(token) +
    "; HttpOnly; Secure; SameSite=Lax; Path=" +
    path +
    "; Max-Age=" +
    maxAgeSec
  );
}

function clearAuthCookieHeader(name, path) {
  return (
    name + "=; HttpOnly; Secure; SameSite=Lax; Path=" + path + "; Max-Age=0"
  );
}

export function accessCookieHeader(token, maxAgeSec) {
  return authCookieHeader(
    ACCESS_COOKIE_NAME,
    ACCESS_COOKIE_PATH,
    token,
    maxAgeSec,
  );
}

export function refreshCookieHeader(token, maxAgeSec) {
  return authCookieHeader(
    REFRESH_COOKIE_NAME,
    REFRESH_COOKIE_PATH,
    token,
    maxAgeSec,
  );
}

export function clearAccessCookieHeader() {
  return clearAuthCookieHeader(ACCESS_COOKIE_NAME, ACCESS_COOKIE_PATH);
}

export function clearRefreshCookieHeader() {
  return clearAuthCookieHeader(REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH);
}

export function clearAllAuthCookieHeaders() {
  return [clearAccessCookieHeader(), clearRefreshCookieHeader()];
}
