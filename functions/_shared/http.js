export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

/** JSON + Set-Cookie（双 token 登录/续期）| JSON with Set-Cookie headers */
export function jsonWithCookies(body, status, cookieHeaders) {
  const headers = new globalThis.Headers({
    "content-type": "application/json; charset=utf-8",
  });
  (cookieHeaders || []).forEach(function (cookie) {
    headers.append("Set-Cookie", cookie);
  });
  return new Response(JSON.stringify(body), { status, headers });
}

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

const memoryRateBuckets = new Map();

/** 无 D1 依赖的轻量限流 | In-memory IP rate limit (per Worker isolate) */
export function checkMemoryRateLimit(ip, bucket, maxCount, windowMs) {
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const entry = memoryRateBuckets.get(key);
  if (!entry || now - entry.start > windowMs) {
    memoryRateBuckets.set(key, { start: now, count: 1 });
    return;
  }
  entry.count += 1;
  if (entry.count > maxCount) throw new Error("请求过于频繁，请稍后再试");
}
