import { requireSession } from "../../../_shared/auth.js";
import {
  getBoardVersion,
  queryD1,
  safeErrorMessage,
} from "../../../_shared/d1.js";
import {
  buildReadModule,
  buildLodgersHistoryPage,
  isSpecialReadModule,
} from "../../../_shared/read-modules.js";
import { createRequestTimer, wantTiming } from "../../../_shared/timing.js";

/** GET /api/v1/read/:module — 按模块读模型 | Module-scoped read API */
export async function onRequestGet({ request, env, params, waitUntil }) {
  if (!env.KETANG_DB) {
    return new Response(JSON.stringify({ error: "缺少 D1 绑定 KETANG_DB" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  const timer = createRequestTimer();
  const moduleKey = params?.module;
  try {
    const session = await timer.stage("auth_ms", () =>
      requireSession(request, env, (sql, p) => queryD1(env, sql, p)),
    );
    const version = await timer.stage("version_ms", () => getBoardVersion(env));
    const isHistoryPage = isSpecialReadModule(moduleKey);
    const ifNoneMatch = request.headers.get("If-None-Match");
    if (
      !isHistoryPage &&
      ifNoneMatch != null &&
      String(parseInt(ifNoneMatch, 10)) === String(version)
    ) {
      return timer.finish304(request, version);
    }
    const payload = isHistoryPage
      ? await timer.stage("read_module_ms", () => {
          const url = new globalThis.URL(request.url);
          const query = Object.fromEntries(url.searchParams.entries());
          const roles = url.searchParams.getAll("roles");
          if (roles.length) query.roles = roles;
          return buildLodgersHistoryPage(env, session, query, {
            skipInit: true,
          });
        })
      : await timer.stage("read_module_ms", () =>
          buildReadModule(env, session, moduleKey, { skipInit: true }),
        );
    const response = timer.finish(payload, request);
    response.headers.set("ETag", String(payload.board_version));
    if (wantTiming(request)) {
      timer.observe(
        env,
        request,
        {
          endpoint: "read/" + moduleKey,
          source: "read_module",
        },
        waitUntil,
      );
    }
    return response;
  } catch (error) {
    const status = /登录已过期/.test(error.message)
      ? 401
      : /管理员|权限|无效/.test(error.message)
        ? 403
        : 400;
    return timer.finish({ error: safeErrorMessage(error) }, request, status);
  }
}
