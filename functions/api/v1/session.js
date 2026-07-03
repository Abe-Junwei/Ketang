import { createRequestTimer, wantTiming } from "../../_shared/timing.js";
import { getSessionUser } from "../../_shared/users.js";
import { queryD1, safeErrorMessage } from "../../_shared/d1.js";
import { buildSessionUserResponse } from "../../_shared/auth-response.js";
import { clearAccessCookieHeader } from "../../_shared/cookies.js";
import { jsonWithCookies } from "../../_shared/http.js";
import {
  wantsBootstrapBoardFlag,
  buildAuthBootstrapBoardExtra,
  sessionShapeFromSessionUser,
} from "../../_shared/auth-bootstrap-board.js";

/** GET /api/v1/session — 会话自检，不触发 schema init | Session check without full init */
export async function onRequestGet({ request, env, waitUntil }) {
  if (!env.KETANG_DB) {
    return createRequestTimer().finish(
      { error: "缺少 D1 绑定 KETANG_DB" },
      request,
      500,
    );
  }
  const timer = createRequestTimer();
  let bootstrapBoard = false;
  try {
    const url = new globalThis.URL(request.url);
    bootstrapBoard = wantsBootstrapBoardFlag(
      url.searchParams.get("bootstrap_board"),
    );
  } catch (e) {
    /* ignore malformed URL */
  }
  try {
    const result = await timer.stage("session_ms", () =>
      getSessionUser(env, request, (sql, params) => queryD1(env, sql, params)),
    );
    if (!result) {
      return jsonWithCookies({ error: "登录已过期，请重新登录" }, 401, [
        clearAccessCookieHeader(),
      ]);
    }
    let extraBody = {};
    if (bootstrapBoard) {
      extraBody = await buildAuthBootstrapBoardExtra(
        env,
        sessionShapeFromSessionUser(result.user),
        timer,
      );
    }
    const response = buildSessionUserResponse(
      env,
      result,
      extraBody,
      timer,
      request,
    );
    if (wantTiming(request)) {
      timer.observe(
        env,
        request,
        { endpoint: "session", source: "auth_session" },
        waitUntil,
      );
    }
    return response;
  } catch (error) {
    return timer.finish({ error: safeErrorMessage(error) }, request, 500);
  }
}
