export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

export async function readJson(request) {
  try {
    return await request.json();
  } catch (e) {
    return null;
  }
}

export function clientIp(request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

/** 统一 API 错误状态码 | Map domain errors to HTTP status */
export function apiErrorStatus(error, fallback = 500) {
  const message = error?.message || String(error);
  if (/登录已过期/.test(message)) return 401;
  if (/权限不足|需要管理员/.test(message)) return 403;
  if (/过于频繁|尝试过多/.test(message)) return 429;
  return fallback;
}
