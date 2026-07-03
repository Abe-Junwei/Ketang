import { readJson, clientIp, json } from "../../../_shared/http.js";
import { safeErrorMessage } from "../../../_shared/d1.js";
import {
  authenticateByRole,
  authenticateByUsername,
} from "../../../_shared/auth-login.js";
import { buildDualAuthSuccess } from "../../../_shared/auth-response.js";
import {
  wantsBootstrapBoardFlag,
  buildAuthBootstrapBoardExtra,
  sessionShapeFromDbUser,
} from "../../../_shared/auth-bootstrap-board.js";
import { createRequestTimer, wantTiming } from "../../../_shared/timing.js";

/** POST /api/v1/auth/login — 双 token 登录 | Login with access + refresh cookie */
export async function onRequestPost({ request, env, waitUntil }) {
  if (!env.KETANG_DB) {
    return json({ error: "缺少 D1 绑定 KETANG_DB" }, 500);
  }
  const body = await readJson(request);
  if (!body) return json({ error: "请求格式错误" }, 400);
  const ip = clientIp(request);
  const meta = {
    ip,
    userAgent: request.headers.get("user-agent") || "",
  };
  const timer = createRequestTimer();
  const bootstrapBoard = wantsBootstrapBoardFlag(body && body.bootstrap_board);
  try {
    let user = null;
    if (body.role) {
      user = await timer.stage("auth_ms", () =>
        authenticateByRole(
          env,
          ip,
          String(body.role || ""),
          body.password || "",
        ),
      );
    } else if (body.username) {
      user = await timer.stage("auth_ms", () =>
        authenticateByUsername(
          env,
          ip,
          String(body.username || ""),
          body.password || "",
        ),
      );
    } else {
      return timer.finish({ error: "请提供 role 或 username" }, request, 400);
    }
    if (!user) return timer.finish({ error: "身份或密码错误" }, request, 401);

    let extraBody = {};
    if (bootstrapBoard) {
      extraBody = await buildAuthBootstrapBoardExtra(
        env,
        sessionShapeFromDbUser(user),
        timer,
      );
    }

    const response = await buildDualAuthSuccess(
      env,
      request,
      user,
      meta,
      extraBody,
      timer,
    );
    if (wantTiming(request)) {
      timer.observe(
        env,
        request,
        { endpoint: "auth/login", source: "auth_login" },
        waitUntil,
      );
    }
    return response;
  } catch (error) {
    return timer.finish({ error: safeErrorMessage(error) }, request, 500);
  }
}
