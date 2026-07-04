import { readJson, json } from "../../../_shared/http.js";
import { safeErrorMessage, queryD1 } from "../../../_shared/d1.js";
import {
  optionalSession,
  requireSession,
  requireAdmin,
} from "../../../_shared/auth.js";
import { createRequestTimer } from "../../../_shared/timing.js";
import {
  storePerfRumSample,
  aggregatePerfRumSummary,
} from "../../../_shared/perf-rum-store.js";

/** POST /api/v1/metrics/perf — 浏览器 RUM 采样上报 | Browser perf RUM ingest */
export async function onRequestPost({ request, env }) {
  if (!env.KETANG_DB) {
    return json({ error: "缺少 D1 绑定 KETANG_DB" }, 500);
  }
  const timer = createRequestTimer();
  try {
    const body = await readJson(request);
    if (!body || body.kind !== "perf") {
      return timer.finish({ error: "无效 RUM 载荷" }, request, 400);
    }
    const session = await timer.stage("auth_ms", () =>
      optionalSession(request, env, (sql, p) => queryD1(env, sql, p)),
    );
    await timer.stage("store_ms", () =>
      storePerfRumSample(env, request, body, session),
    );
    return timer.finish204(request);
  } catch (error) {
    const status = /过于频繁/.test(error.message)
      ? 429
      : /metrics/.test(error.message)
        ? 400
        : 500;
    return timer.finish({ error: safeErrorMessage(error) }, request, status);
  }
}

/** GET /api/v1/metrics/perf — 管理员查看最近 RUM 聚合 | Admin RUM summary */
export async function onRequestGet({ request, env }) {
  if (!env.KETANG_DB) {
    return json({ error: "缺少 D1 绑定 KETANG_DB" }, 500);
  }
  const timer = createRequestTimer();
  try {
    const session = await timer.stage("auth_ms", () =>
      requireSession(request, env, (sql, p) => queryD1(env, sql, p)),
    );
    requireAdmin(session);
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get("limit") || "100", 10);
    const summary = await timer.stage("aggregate_ms", () =>
      aggregatePerfRumSummary(env, limit),
    );
    return timer.finish(summary, request);
  } catch (error) {
    const status = /登录已过期/.test(error.message)
      ? 401
      : /管理员/.test(error.message)
        ? 403
        : 500;
    return timer.finish({ error: safeErrorMessage(error) }, request, status);
  }
}
