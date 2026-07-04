import { readJson, clientIp, json } from "../../../_shared/http.js";
import { safeErrorMessage } from "../../../_shared/d1.js";
import { getRefreshCookie } from "../../../_shared/cookies.js";
import { consumeRefreshToken } from "../../../_shared/refresh-sessions.js";
import { buildRefreshSuccess } from "../../../_shared/auth-response.js";
import { getSessionPermissions } from "../../../_shared/permissions.js";
import { clearAllAuthCookieHeaders } from "../../../_shared/cookies.js";
import { jsonWithCookies } from "../../../_shared/http.js";
import {
  wantsBootstrapBoardFlag,
  buildAuthBootstrapBoardExtra,
  sessionShapeFromSessionUser,
} from "../../../_shared/auth-bootstrap-board.js";
import { createRequestTimer, wantTiming } from "../../../_shared/timing.js";

/** POST /api/v1/auth/refresh — Cookie 续期 access | Refresh access via HttpOnly cookie */
export async function onRequestPost({ request, env, waitUntil }) {
  if (!env.KETANG_DB) {
    return json({ error: "缺少 D1 绑定 KETANG_DB" }, 500);
  }
  const rawToken = getRefreshCookie(request);
  if (!rawToken) {
    return jsonWithCookies(
      { error: "登录已过期，请重新登录" },
      401,
      clearAllAuthCookieHeaders(),
    );
  }
  const meta = {
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent") || "",
  };
  const timer = createRequestTimer();
  let reqBody = null;
  try {
    reqBody = await readJson(request);
  } catch (e) {
    reqBody = null;
  }
  const bootstrapBoard = wantsBootstrapBoardFlag(
    reqBody && reqBody.bootstrap_board,
  );
  try {
    const rotated = await timer.stage("refresh_ms", () =>
      consumeRefreshToken(env, rawToken, meta),
    );
    if (!rotated) {
      return jsonWithCookies(
        { error: "登录已过期，请重新登录" },
        401,
        clearAllAuthCookieHeaders(),
      );
    }
    const sessionShape = sessionShapeFromSessionUser(rotated.user);
    const permissions = await timer.stage("permissions_ms", () =>
      getSessionPermissions(env, sessionShape),
    );
    let extraBody = {};
    if (bootstrapBoard) {
      extraBody = await buildAuthBootstrapBoardExtra(env, sessionShape, timer);
    }
    const response = await buildRefreshSuccess(
      env,
      rotated.user,
      permissions,
      rotated.refreshToken,
      request,
      extraBody,
      timer,
    );
    if (wantTiming(request)) {
      timer.observe(
        env,
        request,
        { endpoint: "auth/refresh", source: "auth_refresh" },
        waitUntil,
      );
    }
    return response;
  } catch (error) {
    return timer.finish({ error: safeErrorMessage(error) }, request, 500);
  }
}
