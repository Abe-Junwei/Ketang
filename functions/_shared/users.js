import {
  verifySession,
  verifyPassword,
  hashPasswordPlain,
  signAccessToken,
} from "./auth.js";
import { revokeAllRefreshSessionsForUser } from "./refresh-sessions.js";
import { insertAudit, queryD1, runD1 } from "./d1.js";
import { getSessionPermissions, requirePermission } from "./permissions.js";

const WEAK_PASSWORDS = new Set([
  "admin",
  "zhike",
  "123456",
  "password",
  "111111",
]);
const VALID_ROLES = new Set([
  "admin",
  "zhike",
  "kitchen",
  "housekeeping",
  "viewer",
]);

export function validateUsername(username) {
  const value = String(username || "").trim();
  if (!/^[a-zA-Z][a-zA-Z0-9_]{2,19}$/.test(value)) {
    throw new Error("账号须 3-20 位，字母开头，仅含字母、数字、下划线");
  }
  return value;
}

export function validateRole(role) {
  const value = String(role || "").trim();
  if (!VALID_ROLES.has(value)) throw new Error("角色无效");
  return value;
}

export function validateNewPassword(password, oldPassword) {
  const value = String(password || "");
  if (value.length < 6) throw new Error("密码至少 6 位");
  if (oldPassword != null && value === String(oldPassword))
    throw new Error("新密码不能与原密码相同");
  if (WEAK_PASSWORDS.has(value)) throw new Error("不能使用过于简单的密码");
  return value;
}

async function countActiveAdmins(env, excludeId = 0) {
  const rows = await queryD1(
    env,
    "SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND (is_active IS NULL OR is_active = 1) AND id != ?",
    [excludeId],
  );
  return rows[0]?.c || 0;
}

async function bumpAuthVersion(env, userId) {
  await runD1(
    env,
    "UPDATE users SET auth_version = COALESCE(auth_version, 1) + 1 WHERE id = ?",
    [userId],
  );
  await revokeAllRefreshSessionsForUser(env, userId);
  const rows = await queryD1(
    env,
    "SELECT auth_version FROM users WHERE id = ? LIMIT 1",
    [userId],
  );
  return rows[0]?.auth_version || 1;
}

export async function getSessionUser(env, request, queryFn) {
  const session = await verifySession(request, env, queryFn);
  if (!session) return null;
  const rows = await queryFn(
    "SELECT id, username, display_name, role, is_advanced, auth_version FROM users WHERE id = ? AND (is_active IS NULL OR is_active = 1) LIMIT 1",
    [session.id || session.sub],
  );
  const user = rows[0];
  if (!user) return null;
  const authVersion =
    user.auth_version != null ? Number(user.auth_version) || 1 : 1;
  const sessionShape = {
    role: user.role,
    id: user.id,
    sub: user.id,
    is_advanced: !!user.is_advanced,
  };
  const permissions = await getSessionPermissions(env, sessionShape);
  const access_token = await signAccessToken(env, {
    ...user,
    auth_version: authVersion,
  });
  return {
    access_token,
    token: access_token,
    user: {
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      role: user.role,
      is_advanced: !!user.is_advanced,
      auth_version: authVersion,
    },
    permissions,
  };
}

export async function listUsers(env, session) {
  await requirePermission(env, session, "users.read");
  const rows = await queryD1(
    env,
    "SELECT id, username, display_name, role, is_advanced, is_active, created_at FROM users ORDER BY role, username",
    [],
  );
  return rows;
}

export async function createUser(env, session, body) {
  await requirePermission(env, session, "users.write");
  const username = validateUsername(body.username);
  const password = validateNewPassword(body.password);
  const displayName = String(body.display_name || "").trim() || null;
  const role = validateRole(body.role);
  const isAdvanced =
    role === "zhike" && (body.is_advanced === 1 || body.is_advanced === true)
      ? 1
      : 0;
  const existing = await queryD1(
    env,
    "SELECT id FROM users WHERE username = ? LIMIT 1",
    [username],
  );
  if (existing[0]) throw new Error("账号已存在");
  const hash = await hashPasswordPlain(password);
  const meta = await runD1(
    env,
    "INSERT INTO users (username, display_name, role, is_advanced, password, auth_version, must_change_password) VALUES (?, ?, ?, ?, ?, 1, 0)",
    [username, displayName, role, isAdvanced, hash],
  );
  await insertAudit(
    env,
    "新增用户",
    "user",
    meta.last_row_id,
    { username, role },
    session,
  );
  return { id: meta.last_row_id };
}

export async function updateUser(env, session, body) {
  await requirePermission(env, session, "users.write");
  const id = parseInt(body.user_id, 10);
  if (!id) throw new Error("缺少用户 ID");
  const rows = await queryD1(env, "SELECT * FROM users WHERE id = ? LIMIT 1", [
    id,
  ]);
  const existing = rows[0];
  if (!existing) throw new Error("用户不存在");
  const displayName = String(body.display_name || "").trim() || null;
  const role = validateRole(body.role);
  const isAdvanced =
    role === "zhike" && (body.is_advanced === 1 || body.is_advanced === true)
      ? 1
      : 0;
  if (existing.role === "admin" && role !== "admin") {
    const admins = await countActiveAdmins(env, id);
    if (admins === 0) throw new Error("不能移除最后一名管理员");
  }
  let hash = null;
  if (body.password) {
    validateNewPassword(body.password);
    hash = await hashPasswordPlain(body.password);
  }
  if (hash) {
    await bumpAuthVersion(env, id);
    await runD1(
      env,
      "UPDATE users SET display_name=?, role=?, is_advanced=?, password=?, must_change_password = 0 WHERE id=?",
      [displayName, role, isAdvanced, hash, id],
    );
  } else {
    await runD1(
      env,
      "UPDATE users SET display_name=?, role=?, is_advanced=? WHERE id=?",
      [displayName, role, isAdvanced, id],
    );
  }
  await insertAudit(
    env,
    "更新用户",
    "user",
    id,
    { username: existing.username, role, password_changed: !!hash },
    session,
  );
  const updated = await queryD1(
    env,
    "SELECT id, username, display_name, role, is_advanced, auth_version FROM users WHERE id = ? LIMIT 1",
    [id],
  );
  const row = updated[0];
  const result = {
    ok: true,
    auth_version: row?.auth_version || 1,
    password_changed: !!hash,
  };
  if (hash && id === (session.id || session.sub) && row) {
    result.user = row;
  }
  return result;
}

export async function deactivateUser(env, session, body) {
  await requirePermission(env, session, "users.write");
  const id = parseInt(body.user_id, 10);
  if (!id) throw new Error("缺少用户 ID");
  if (id === (session.id || session.sub))
    throw new Error("不能停用当前登录账号");
  const rows = await queryD1(env, "SELECT * FROM users WHERE id = ? LIMIT 1", [
    id,
  ]);
  const existing = rows[0];
  if (!existing) throw new Error("用户不存在");
  if (existing.is_active === 0) return { ok: true };
  if (existing.role === "admin") {
    const admins = await countActiveAdmins(env, id);
    if (admins === 0) throw new Error("不能停用最后一名管理员");
  }
  await runD1(
    env,
    "UPDATE users SET is_active = 0, auth_version = COALESCE(auth_version, 1) + 1 WHERE id = ?",
    [id],
  );
  await revokeAllRefreshSessionsForUser(env, id);
  await insertAudit(
    env,
    "停用用户",
    "user",
    id,
    { username: existing.username },
    session,
  );
  return { ok: true };
}

export async function reactivateUser(env, session, body) {
  await requirePermission(env, session, "users.write");
  const id = parseInt(body.user_id, 10);
  if (!id) throw new Error("缺少用户 ID");
  const rows = await queryD1(env, "SELECT * FROM users WHERE id = ? LIMIT 1", [
    id,
  ]);
  const existing = rows[0];
  if (!existing) throw new Error("用户不存在");
  if (existing.is_active !== 0) return { ok: true };
  await runD1(env, "UPDATE users SET is_active = 1 WHERE id = ?", [id]);
  await insertAudit(
    env,
    "启用用户",
    "user",
    id,
    { username: existing.username },
    session,
  );
  return { ok: true };
}

export async function resetUserPassword(env, session, body) {
  await requirePermission(env, session, "users.write");
  const id = parseInt(body.user_id, 10);
  if (!id) throw new Error("缺少用户 ID");
  const password = validateNewPassword(body.password);
  const rows = await queryD1(env, "SELECT * FROM users WHERE id = ? LIMIT 1", [
    id,
  ]);
  const existing = rows[0];
  if (!existing) throw new Error("用户不存在");
  const hash = await hashPasswordPlain(password);
  const authVersion = await bumpAuthVersion(env, id);
  await runD1(
    env,
    "UPDATE users SET password = ?, must_change_password = 0 WHERE id = ?",
    [hash, id],
  );
  await insertAudit(
    env,
    "重置用户密码",
    "user",
    id,
    { username: existing.username },
    session,
  );
  return { ok: true, auth_version: authVersion };
}

export async function changeUserPassword(
  env,
  userId,
  oldPassword,
  newPassword,
) {
  const rows = await queryD1(env, "SELECT * FROM users WHERE id = ? LIMIT 1", [
    userId,
  ]);
  const user = rows[0];
  if (!user) throw new Error("用户不存在");
  validateNewPassword(newPassword, oldPassword);
  if (!(await verifyPassword(oldPassword || "", user.password)))
    throw new Error("原密码错误");
  const hash = await hashPasswordPlain(newPassword);
  const authVersion = await bumpAuthVersion(env, userId);
  await runD1(
    env,
    "UPDATE users SET password = ?, must_change_password = 0 WHERE id = ?",
    [hash, userId],
  );
  const updated = await queryD1(
    env,
    "SELECT id, username, display_name, role, is_advanced, auth_version FROM users WHERE id = ? LIMIT 1",
    [userId],
  );
  return { ok: true, user: updated[0], auth_version: authVersion };
}
