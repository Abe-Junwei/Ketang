import { queryD1, runD1 } from "./d1.js";
import { assertSessionSecret } from "./auth.js";

/** Refresh token 30 天 | Refresh token TTL */
export const REFRESH_TTL_SEC = 60 * 60 * 24 * 30;

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map(function (b) {
      return b.toString(16).padStart(2, "0");
    })
    .join("");
}

export async function hashRefreshToken(env, token) {
  assertSessionSecret(env);
  return sha256Hex(String(env.KETANG_SESSION_SECRET) + ":refresh:" + token);
}

export async function ensureRefreshSessionsTable(env) {
  await runD1(
    env,
    `CREATE TABLE IF NOT EXISTS refresh_sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      auth_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_used_at TEXT,
      user_agent TEXT,
      ip TEXT,
      revoked INTEGER DEFAULT 0
    )`,
    [],
  );
  await runD1(
    env,
    "CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_sessions(user_id)",
    [],
  );
  await runD1(
    env,
    "CREATE INDEX IF NOT EXISTS idx_refresh_expires ON refresh_sessions(expires_at)",
    [],
  );
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export async function createRefreshSession(env, user, meta) {
  await ensureRefreshSessionsTable(env);
  const id = crypto.randomUUID();
  const token = randomToken();
  const tokenHash = await hashRefreshToken(env, token);
  const authVersion =
    user.auth_version != null ? Number(user.auth_version) || 1 : 1;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + REFRESH_TTL_SEC * 1000).toISOString();
  await runD1(
    env,
    `INSERT INTO refresh_sessions (id, user_id, token_hash, auth_version, created_at, expires_at, last_used_at, user_agent, ip, revoked)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      id,
      user.id,
      tokenHash,
      authVersion,
      now.toISOString(),
      expiresAt,
      now.toISOString(),
      meta?.userAgent || null,
      meta?.ip || null,
    ],
  );
  return { id: id, token: token, expiresAt: expiresAt };
}

export async function revokeRefreshSessionByHash(env, tokenHash) {
  await runD1(
    env,
    "UPDATE refresh_sessions SET revoked = 1 WHERE token_hash = ?",
    [tokenHash],
  );
}

export async function revokeAllRefreshSessionsForUser(env, userId) {
  await ensureRefreshSessionsTable(env);
  await runD1(
    env,
    "UPDATE refresh_sessions SET revoked = 1 WHERE user_id = ? AND revoked = 0",
    [userId],
  );
}

export async function consumeRefreshToken(env, rawToken, meta) {
  await ensureRefreshSessionsTable(env);
  if (!rawToken) return null;
  const tokenHash = await hashRefreshToken(env, rawToken);
  const rows = await queryD1(
    env,
    `SELECT rs.*, u.username, u.display_name, u.role, u.is_advanced, u.auth_version AS user_auth_version
     FROM refresh_sessions rs
     JOIN users u ON u.id = rs.user_id
     WHERE rs.token_hash = ? AND rs.revoked = 0
       AND (u.is_active IS NULL OR u.is_active = 1)
     LIMIT 1`,
    [tokenHash],
  );
  const row = rows[0];
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await revokeRefreshSessionByHash(env, tokenHash);
    return null;
  }
  const dbAv = Number(row.user_auth_version || 1);
  const rowAv = Number(row.auth_version || 1);
  if (dbAv !== rowAv) {
    await revokeAllRefreshSessionsForUser(env, row.user_id);
    return null;
  }
  await runD1(
    env,
    "UPDATE refresh_sessions SET revoked = 1, last_used_at = ? WHERE id = ?",
    [new Date().toISOString(), row.id],
  );
  const user = {
    id: row.user_id,
    username: row.username,
    display_name: row.display_name,
    role: row.role,
    is_advanced: row.is_advanced,
    auth_version: dbAv,
  };
  const rotated = await createRefreshSession(env, user, meta);
  return { user: user, refreshToken: rotated.token };
}
