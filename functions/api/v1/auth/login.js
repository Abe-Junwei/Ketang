import { readJson, clientIp, json } from "../../../_shared/http.js";
import { safeErrorMessage } from "../../../_shared/d1.js";
import {
  authenticateByRole,
  authenticateByUsername,
} from "../../../_shared/auth-login.js";
import { buildDualAuthSuccess } from "../../../_shared/auth-response.js";
import { buildReadModule } from "../../../_shared/read-modules.js";
import { createRequestTimer, wantTiming } from "../../../_shared/timing.js";

function wantsBootstrapBoard(body) {
  const v = body && body.bootstrap_board;
  return v === true || v === 1 || v === "1";
}

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
  const bootstrapBoard = wantsBootstrapBoard(body);
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
      const sessionShape = {
        role: user.role,
        id: user.id,
        sub: user.id,
        is_advanced: !!user.is_advanced,
      };
      const boardPayload = await timer.stage("read_board_ms", () =>
        buildReadModule(env, sessionShape, "board", { skipInit: true }),
      );
      extraBody.read_modules = { board: boardPayload };
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
