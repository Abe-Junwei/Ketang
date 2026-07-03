import { json, jsonWithCookies } from "./http.js";

/** 是否返回阶段耗时 | Include stage timing in response */
export function wantTiming(request) {
  try {
    const url = new globalThis.URL(request.url);
    if (url.searchParams.get("timing") === "1") return true;
  } catch (e) {
    /* ignore */
  }
  return request.headers.get("x-ketang-debug") === "timing";
}

/** 请求级计时器 | Per-request stage timer */
export function createRequestTimer() {
  const startedAt = Date.now();
  const stages = {};

  return {
    mark(name, ms) {
      stages[name] = ms != null ? ms : Date.now() - startedAt;
    },
    async stage(name, fn) {
      const t0 = Date.now();
      const result = await fn();
      stages[name] = Date.now() - t0;
      return result;
    },
    finish(body, request, status = 200) {
      stages.total_ms = Date.now() - startedAt;
      if (wantTiming(request)) {
        console.log("ketang_timing", JSON.stringify(stages));
        return json({ ...body, _timing: stages }, status);
      }
      return json(body, status);
    },
    finishWithCookies(body, request, status, cookieHeaders) {
      stages.total_ms = Date.now() - startedAt;
      const payload = wantTiming(request) ? { ...body, _timing: stages } : body;
      if (wantTiming(request)) {
        console.log("ketang_timing", JSON.stringify(stages));
      }
      return jsonWithCookies(payload, status, cookieHeaders);
    },
    finish304(request, etag) {
      stages.total_ms = Date.now() - startedAt;
      const headers = new globalThis.Headers({ ETag: String(etag) });
      if (wantTiming(request)) {
        console.log("ketang_timing", JSON.stringify(stages));
        headers.set("X-Ketang-Timing", JSON.stringify(stages));
      }
      return new Response(null, { status: 304, headers });
    },
  };
}
