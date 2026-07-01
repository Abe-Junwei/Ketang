import { json, readJson, clientIp, checkMemoryRateLimit } from "../_shared/http.js";
import {
  verifyPassword,
  signSession,
  requireSession,
  checkLoginRateLimit,
  recordLoginFailure,
  clearLoginFailures,
  mustChangePassword,
  upgradePasswordHashIfLegacy,
} from "../_shared/auth.js";
import {
  queryD1,
  runD1,
  initRemoteDatabase,
  isDatabaseEmpty,
  assertAllowedSql,
  safeErrorMessage,
} from "../_shared/d1.js";
import { changeUserPassword } from "../_shared/users.js";
import { getSessionPermissions } from "../_shared/permissions.js";
import { createRequestTimer } from "../_shared/timing.js";

const bindQuery = (env) => (sql, params) => queryD1(env, sql, params);
const bindRun = (env) => (sql, params) => runD1(env, sql, params);
const PUBLIC_LOGIN_ROLES = [
  ["admin", "管理员"],
  ["zhike", "知客师"],
  ["kitchen", "厨房"],
  ["housekeeping", "房务"],
  ["viewer", "只读"],
];

function sessionUserPayload(user) {
  return {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    role: user.role,
    auth_version: user.auth_version || 1,
  };
}

async function upgradePasswordHashBestEffort(
  userId,
  password,
  storedHash,
  env,
) {
  try {
    return await upgradePasswordHashIfLegacy(
      userId,
      password,
      storedHash,
      bindRun(env),
    );
  } catch (error) {
    console.warn("password hash upgrade skipped:", error);
    return storedHash;
  }
}

async function buildLoginSuccess(env, request, freshUser, timer) {
  const token = timer
    ? await timer.stage("token_ms", () => signSession(env, freshUser))
    : await signSession(env, freshUser);
  const session = {
    role: freshUser.role,
    id: freshUser.id,
    sub: freshUser.id,
  };
  const permissions = await getSessionPermissions(env, session);
  const body = {
    token,
    user: sessionUserPayload(freshUser),
    permissions,
    must_change_password: mustChangePassword(freshUser),
  };
  return timer ? timer.finish(body, request) : json(body);
}

async function authenticateUsername(env, ip, username, password) {
  await checkLoginRateLimit(env, ip, bindQuery(env), bindRun(env));
  const rows = await queryD1(
    env,
    "SELECT * FROM users WHERE username = ? AND (is_active IS NULL OR is_active = 1) LIMIT 1",
    [username],
  );
  const user = rows[0];
  if (!user || !(await verifyPassword(password || "", user.password))) {
    await recordLoginFailure(env, ip, bindQuery(env), bindRun(env));
    return null;
  }
  await upgradePasswordHashBestEffort(user.id, password || "", user.password, env);
  await clearLoginFailures(env, ip, bindRun(env));
  const freshRows = await queryD1(
    env,
    "SELECT * FROM users WHERE id = ? LIMIT 1",
    [user.id],
  );
  return freshRows[0] || user;
}

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

    if (payload.action === "login_role") {
      const timer = createRequestTimer();
      await timer.stage("init_ms", () => initRemoteDatabase(env));
      await timer.stage("rate_limit_ms", () =>
        checkLoginRateLimit(env, ip, bindQuery(env), bindRun(env)),
      );
      const role = String(payload.role || "");
      if (!PUBLIC_LOGIN_ROLES.some(([value]) => value === role)) {
        await recordLoginFailure(env, ip, bindQuery(env), bindRun(env));
        return timer.finish({ error: "身份或密码错误" }, request, 401);
      }
      const rows = await timer.stage("d1_query_ms", () =>
        queryD1(
          env,
          "SELECT * FROM users WHERE role = ? AND (is_active IS NULL OR is_active = 1) ORDER BY CASE WHEN username = ? THEN 0 ELSE 1 END, username",
          [role, role],
        ),
      );
      let matchedUser = null;
      let passwordMs = 0;
      for (const user of rows) {
        const verifyStart = Date.now();
        const ok = await verifyPassword(payload.password || "", user.password);
        passwordMs += Date.now() - verifyStart;
        if (ok) {
          matchedUser = user;
          break;
        }
      }
      timer.mark("password_ms", passwordMs);
      if (!matchedUser) {
        await recordLoginFailure(env, ip, bindQuery(env), bindRun(env));
        return timer.finish({ error: "身份或密码错误" }, request, 401);
      }
      await upgradePasswordHashBestEffort(
        matchedUser.id,
        payload.password || "",
        matchedUser.password,
        env,
      );
      await clearLoginFailures(env, ip, bindRun(env));
      const freshRows = await queryD1(
        env,
        "SELECT * FROM users WHERE id = ? LIMIT 1",
        [matchedUser.id],
      );
      const freshUser = freshRows[0] || matchedUser;
      return buildLoginSuccess(env, request, freshUser, timer);
    }

    if (payload.action === "login") {
      const timer = createRequestTimer();
      await timer.stage("init_ms", () => initRemoteDatabase(env));
      const freshUser = await timer.stage("login_ms", () =>
        authenticateUsername(env, ip, payload.username, payload.password),
      );
      if (!freshUser) {
        return timer.finish({ error: "账号或密码错误" }, request, 401);
      }
      return buildLoginSuccess(env, request, freshUser, timer);
    }

    const session = await requireSession(request, env, bindQuery(env));

    if (payload.action === "change_password") {
      const result = await changeUserPassword(
        env,
        session.sub || session.id,
        payload.old_password,
        payload.new_password,
      );
      const token = await signSession(env, result.user);
      const refreshed = {
        role: result.user.role,
        id: result.user.id,
        sub: result.user.id,
      };
      const permissions = await getSessionPermissions(env, refreshed);
      return json({
        ok: true,
        token,
        user: {
          id: result.user.id,
          username: result.user.username,
          display_name: result.user.display_name,
          role: result.user.role,
          auth_version: result.user.auth_version || 1,
        },
        permissions,
        must_change_password: false,
      });
    }

    if (payload.action === "batch_query") {
      const queries = Array.isArray(payload.queries)
        ? payload.queries.slice(0, 20)
        : [];
      if (!queries.length) return json({ error: "queries 不能为空" }, 400);
      const results = [];
      for (const item of queries) {
        const sql = assertAllowedSql("batch_query", item.sql, session);
        results.push(await queryD1(env, sql, item.params || []));
      }
      return json({ results });
    }

    if (payload.action === "query") {
      const sql = assertAllowedSql("query", payload.sql, session);
      const rows = await queryD1(env, sql, payload.params || []);
      return json({ rows });
    }

    if (payload.action === "run") {
      const sql = assertAllowedSql("run", payload.sql, session);
      const meta = await runD1(env, sql, payload.params || []);
      return json({ meta });
    }

    if (payload.action === "exec") {
      const sql = assertAllowedSql("exec", payload.sql, session);
      const rows = await queryD1(env, sql, payload.params || []);
      const columns = rows[0] ? Object.keys(rows[0]) : [];
      return json({
        result: [
          {
            columns,
            values: rows.map((row) => columns.map((column) => row[column])),
          },
        ],
      });
    }

    return json({ error: "未知操作" }, 400);
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
