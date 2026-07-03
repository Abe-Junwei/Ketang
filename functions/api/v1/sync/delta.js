import { requireSession } from "../../../_shared/auth.js";
import {
  ensureDatabaseForAuth,
  getBoardVersion,
  queryD1,
  safeErrorMessage,
} from "../../../_shared/d1.js";
import { buildSyncDelta } from "../../../_shared/sync-delta.js";
import { createRequestTimer } from "../../../_shared/timing.js";

/** GET /api/v1/sync/delta?since= — 按域增量同步 */
export async function onRequestGet({ request, env }) {
  if (!env.KETANG_DB) {
    return new Response(JSON.stringify({ error: "缺少 D1 绑定 KETANG_DB" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  const timer = createRequestTimer();
  const url = new globalThis.URL(request.url);
  const since = parseInt(url.searchParams.get("since") || "0", 10) || 0;
  try {
    const session = await timer.stage("auth_ms", () =>
      requireSession(request, env, (sql, p) => queryD1(env, sql, p)),
    );
    await timer.stage("init_ms", () => ensureDatabaseForAuth(env));
    const currentVersion = await getBoardVersion(env);
    const ifNoneMatch = request.headers.get("If-None-Match");
    if (
      ifNoneMatch != null &&
      since > 0 &&
      String(parseInt(ifNoneMatch, 10)) === String(currentVersion) &&
      since >= currentVersion
    ) {
      return timer.finish304(request, currentVersion);
    }
    const payload = await timer.stage("delta_ms", () =>
      buildSyncDelta(env, session, since, { skipInit: true }),
    );
    const response = timer.finish(payload, request);
    response.headers.set(
      "ETag",
      String(payload.board_version || currentVersion),
    );
    return response;
  } catch (error) {
    const status = /登录已过期/.test(error.message)
      ? 401
      : /管理员|权限/.test(error.message)
        ? 403
        : 500;
    return timer.finish({ error: safeErrorMessage(error) }, request, status);
  }
}
