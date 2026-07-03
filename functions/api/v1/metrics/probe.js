import { readJson, json } from "../../../_shared/http.js";
import { safeErrorMessage, queryD1 } from "../../../_shared/d1.js";
import { optionalSession } from "../../../_shared/auth.js";
import { createRequestTimer } from "../../../_shared/timing.js";
import { storeProbeBatch } from "../../../_shared/perf-probe-store.js";

/** POST /api/v1/metrics/probe — 合成探针批量上报 | Synthetic probe batch ingest */
export async function onRequestPost({ request, env }) {
  if (!env.KETANG_DB) {
    return json({ error: "缺少 D1 绑定 KETANG_DB" }, 500);
  }
  const timer = createRequestTimer();
  try {
    const body = await readJson(request);
    if (!body || body.kind !== "probe") {
      return timer.finish({ error: "无效探针载荷" }, request, 400);
    }
    await timer.stage("auth_ms", () =>
      optionalSession(request, env, (sql, p) => queryD1(env, sql, p)),
    );
    const result = await timer.stage("store_ms", () =>
      storeProbeBatch(env, request, body),
    );
    void result;
    return timer.finish204(request);
  } catch (error) {
    const status = /过于频繁/.test(error.message)
      ? 429
      : /samples/.test(error.message)
        ? 400
        : 500;
    return timer.finish({ error: safeErrorMessage(error) }, request, status);
  }
}
