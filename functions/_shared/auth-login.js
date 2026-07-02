import {
  verifyPassword,
  checkLoginRateLimit,
  recordLoginFailure,
  clearLoginFailures,
  upgradePasswordHashIfLegacy,
} from "./auth.js";
import { queryD1, runD1, ensureDatabaseForAuth } from "./d1.js";

export const PUBLIC_LOGIN_ROLES = [
  ["admin", "管理员"],
  ["zhike", "知客师"],
  ["kitchen", "厨房"],
  ["housekeeping", "房务"],
  ["viewer", "只读"],
];

const bindQuery = (env) => (sql, params) => queryD1(env, sql, params);
const bindRun = (env) => (sql, params) => runD1(env, sql, params);

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

export async function authenticateByUsername(env, ip, username, password) {
  await ensureDatabaseForAuth(env);
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
  await upgradePasswordHashBestEffort(
    user.id,
    password || "",
    user.password,
    env,
  );
  await clearLoginFailures(env, ip, bindRun(env));
  const freshRows = await queryD1(
    env,
    "SELECT * FROM users WHERE id = ? LIMIT 1",
    [user.id],
  );
  return freshRows[0] || user;
}

export async function authenticateByRole(env, ip, role, password) {
  await ensureDatabaseForAuth(env);
  await checkLoginRateLimit(env, ip, bindQuery(env), bindRun(env));
  if (!PUBLIC_LOGIN_ROLES.some(([value]) => value === role)) {
    await recordLoginFailure(env, ip, bindQuery(env), bindRun(env));
    return null;
  }
  const rows = await queryD1(
    env,
    "SELECT * FROM users WHERE role = ? AND (is_active IS NULL OR is_active = 1) ORDER BY CASE WHEN username = ? THEN 0 ELSE 1 END, username",
    [role, role],
  );
  let matchedUser = null;
  for (const user of rows) {
    const ok = await verifyPassword(password || "", user.password);
    if (ok) {
      matchedUser = user;
      break;
    }
  }
  if (!matchedUser) {
    await recordLoginFailure(env, ip, bindQuery(env), bindRun(env));
    return null;
  }
  await upgradePasswordHashBestEffort(
    matchedUser.id,
    password || "",
    matchedUser.password,
    env,
  );
  await clearLoginFailures(env, ip, bindRun(env));
  const freshRows = await queryD1(
    env,
    "SELECT * FROM users WHERE id = ? LIMIT 1",
    [matchedUser.id],
  );
  return freshRows[0] || matchedUser;
}
