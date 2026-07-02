/** HttpOnly refresh cookie helpers | Refresh Cookie 工具 */

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

export function getRefreshCookie(request) {
  return parseCookies(request)[REFRESH_COOKIE_NAME] || "";
}

export function refreshCookieHeader(token, maxAgeSec) {
  return (
    REFRESH_COOKIE_NAME +
    "=" +
    encodeURIComponent(token) +
    "; HttpOnly; Secure; SameSite=Lax; Path=" +
    REFRESH_COOKIE_PATH +
    "; Max-Age=" +
    maxAgeSec
  );
}

export function clearRefreshCookieHeader() {
  return (
    REFRESH_COOKIE_NAME +
    "=; HttpOnly; Secure; SameSite=Lax; Path=" +
    REFRESH_COOKIE_PATH +
    "; Max-Age=0"
  );
}
