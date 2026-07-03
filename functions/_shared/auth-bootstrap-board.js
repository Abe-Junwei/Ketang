import { buildReadModule } from "./read-modules.js";

/** 解析 bootstrap_board 请求标志 | Parse bootstrap_board flag from body/query */
export function wantsBootstrapBoardFlag(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

/** session API user → buildReadModule session shape */
export function sessionShapeFromSessionUser(user) {
  return {
    role: user.role,
    id: user.id,
    sub: user.id,
    is_advanced: !!user.is_advanced,
  };
}

/** DB user row → buildReadModule session shape */
export function sessionShapeFromDbUser(user) {
  return sessionShapeFromSessionUser(user);
}

/** 认证响应附加 board read_modules | Attach slim board module to auth response */
export async function buildAuthBootstrapBoardExtra(env, sessionShape, timer) {
  const boardPayload = timer
    ? await timer.stage("read_board_ms", () =>
        buildReadModule(env, sessionShape, "board", { skipInit: true }),
      )
    : await buildReadModule(env, sessionShape, "board", { skipInit: true });
  return { read_modules: { board: boardPayload } };
}
