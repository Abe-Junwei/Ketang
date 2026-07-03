import { readJson, json } from "../../../_shared/http.js";
import { safeErrorMessage, queryD1 } from "../../../_shared/d1.js";
import { optionalSession } from "../../../_shared/auth.js";
import { createRequestTimer } from "../../../_shared/timing.js";
import { storePerfRumSample } from "../../../_shared/perf-rum-store.js";

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
