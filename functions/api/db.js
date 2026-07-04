import {
  json,
  readJson,
  clientIp,
  checkMemoryRateLimit,
} from "../_shared/http.js";
import { requireSession } from "../_shared/auth.js";
import {
  queryD1,
  initRemoteDatabase,
  isDatabaseEmpty,
  safeErrorMessage,
} from "../_shared/d1.js";

const bindQuery = (env) => (sql, params) => queryD1(env, sql, params);
const PUBLIC_LOGIN_ROLES = [
  ["admin", "管理员"],
  ["zhike", "知客师"],
  ["kitchen", "厨房"],
  ["housekeeping", "房务"],
  ["viewer", "只读"],
];

const LEGACY_LOGIN_RETIRED = {
  error: "请改用 POST /api/v1/auth/login（/api/db 登录已退役）",
};

export async function onRequestPost({ request, env }) {
  if (!env.KETANG_DB) return json({ error: "缺少 D1 绑定 KETANG_DB" }, 500);
  const payload = await readJson(request);
  if (!payload) return json({ error: "请求格式错误" }, 400);
  const ip = clientIp(request);

  try {
    if (payload.action === "init") {
      if (payload.force === true) {
        const empty = await isDatabaseEmpty(env);
        if (!empty) {
          const secret = request.headers.get("x-ketang-bootstrap") || "";
          if (
            !env.KETANG_BOOTSTRAP_SECRET ||
            secret !== env.KETANG_BOOTSTRAP_SECRET
          ) {
            return json({ error: "数据库已初始化，禁止强制 reseed" }, 403);
          }
        }
      }
      const seeded = await initRemoteDatabase(env);
      return json({ ok: true, seeded, already_initialized: !seeded });
    }

    if (payload.action === "users") {
      checkMemoryRateLimit(ip, "users_list", 30, 60 * 1000);
      const rows = PUBLIC_LOGIN_ROLES.map(([role, label]) => ({
        username: role,
        display_name: label,
        role,
      }));
      return json({ rows });
    }

    if (payload.action === "login_role" || payload.action === "login") {
      return json(LEGACY_LOGIN_RETIRED, 410);
    }

    await requireSession(request, env, bindQuery(env));

    if (payload.action === "change_password") {
      return json(
        {
          error:
            "请改用 POST /api/v1/auth/change-password（/api/db SQL 网关已退役）",
        },
        410,
      );
    }

    return json(
      {
        error:
          "SQL 网关 query/run/batch_query 已退役，请使用 /api/v1/* 业务 API",
      },
      410,
    );
  } catch (error) {
    console.error("Ketang API error:", error);
    const status = /登录已过期|原密码错误/.test(error.message)
      ? 401
      : /权限不足/.test(error.message)
        ? 403
        : /过于频繁|尝试过多/.test(error.message)
          ? 429
          : /密码|账号|用户|管理员|缺少/.test(error.message)
            ? 400
            : 500;
    return json({ error: safeErrorMessage(error) }, status);
  }
}
