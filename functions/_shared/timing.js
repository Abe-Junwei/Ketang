import { json, jsonWithCookies } from "./http.js";
import { recordPerfObservation } from "./perf-ae.js";

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

/** 请求追踪 ID | Per-request correlation id */
export function createRequestId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `kr_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function stageHeaderName(key) {
  return String(key)
    .replace(/_ms$/, "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 32);
}

/** W3C Server-Timing + X-Ketang-Request-Id | Attach timing headers for RUM */
export function applyTimingHeaders(headers, stages, requestId, request) {
  if (!headers) return;
  if (requestId) headers.set("X-Ketang-Request-Id", requestId);
  const parts = [];
  Object.keys(stages || {}).forEach(function (key) {
    if (key === "total_ms") return;
    const val = stages[key];
    if (typeof val === "number" && val >= 0) {
      parts.push(`${stageHeaderName(key)};dur=${Math.round(val)}`);
    }
  });
  if (stages?.total_ms != null) {
    parts.push(`total;dur=${Math.round(stages.total_ms)}`);
  }
  if (parts.length) headers.set("Server-Timing", parts.join(", "));
  if (wantTiming(request)) {
    headers.set("X-Ketang-Timing", JSON.stringify(stages));
  }
}

function attachTimerHeaders(response, stages, requestId, request) {
  applyTimingHeaders(response.headers, stages, requestId, request);
  return response;
}

/** 请求级计时器 | Per-request stage timer */
export function createRequestTimer() {
  const startedAt = Date.now();
  const stages = {};
  const requestId = createRequestId();

  return {
    requestId,
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
        return attachTimerHeaders(
          json({ ...body, _timing: stages }, status),
          stages,
          requestId,
          request,
        );
      }
      return attachTimerHeaders(json(body, status), stages, requestId, request);
    },
    finishWithCookies(body, request, status, cookieHeaders) {
      stages.total_ms = Date.now() - startedAt;
      const payload = wantTiming(request) ? { ...body, _timing: stages } : body;
      if (wantTiming(request)) {
        console.log("ketang_timing", JSON.stringify(stages));
      }
      return attachTimerHeaders(
        jsonWithCookies(payload, status, cookieHeaders),
        stages,
        requestId,
        request,
      );
    },
    finish304(request, etag) {
      stages.total_ms = Date.now() - startedAt;
      const headers = new globalThis.Headers({ ETag: String(etag) });
      applyTimingHeaders(headers, stages, requestId, request);
      if (wantTiming(request)) {
        console.log("ketang_timing", JSON.stringify(stages));
      }
      return new Response(null, { status: 304, headers });
    },
    finish204(request) {
      stages.total_ms = Date.now() - startedAt;
      const headers = new globalThis.Headers();
      applyTimingHeaders(headers, stages, requestId, request);
      if (wantTiming(request)) {
        console.log("ketang_timing", JSON.stringify(stages));
      }
      return new Response(null, { status: 204, headers });
    },
    observe(env, request, meta, waitUntil) {
      if (!env || !request) return;
      stages.total_ms = Date.now() - startedAt;
      recordPerfObservation(
        env,
        request,
        {
          endpoint: meta?.endpoint || "unknown",
          server_ms: stages.total_ms,
          request_id: requestId,
          server_timing: { ...stages },
          source: meta?.source || "server",
          bytes: meta?.bytes,
        },
        waitUntil,
      );
    },
  };
}
