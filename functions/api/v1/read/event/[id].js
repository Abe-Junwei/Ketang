import { requireSession } from "../../../../_shared/auth.js";
import {
  getBoardVersion,
  queryD1,
  safeErrorMessage,
} from "../../../../_shared/d1.js";
import { buildEventDetailModule } from "../../../../_shared/read-modules.js";
import { createRequestTimer } from "../../../../_shared/timing.js";

/** GET /api/v1/read/event/:id — 单营期排房读模型 */
export async function onRequestGet({ request, env, params }) {
  if (!env.KETANG_DB) {
    return new Response(JSON.stringify({ error: "缺少 D1 绑定 KETANG_DB" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  const timer = createRequestTimer();
  try {
    const session = await timer.stage("auth_ms", () =>
      requireSession(request, env, (sql, p) => queryD1(env, sql, p)),
    );
    const version = await timer.stage("version_ms", () => getBoardVersion(env));
    const ifNoneMatch = request.headers.get("If-None-Match");
    if (
      ifNoneMatch != null &&
      String(parseInt(ifNoneMatch, 10)) === String(version)
    ) {
      return new Response(null, {
        status: 304,
        headers: { ETag: String(version) },
      });
    }
    const payload = await timer.stage("read_module_ms", () =>
      buildEventDetailModule(env, session, params?.id, { skipInit: true }),
    );
    const response = timer.finish(payload, request);
    response.headers.set("ETag", String(payload.board_version));
    return response;
  } catch (error) {
    const status = /登录已过期/.test(error.message)
      ? 401
      : /管理员|权限|不存在|缺少/.test(error.message)
        ? 403
        : 400;
    return timer.finish({ error: safeErrorMessage(error) }, request, status);
  }
}
