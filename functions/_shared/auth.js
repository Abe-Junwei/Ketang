import { isDefaultPasswordHash } from './schema.js';

export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length === 3 && parts[0] === 'sha256') {
    return await sha256Hex(parts[1] + password) === parts[2];
  }
  return stored === password;
}

function base64UrlEncode(value) {
  return btoa(typeof value === 'string' ? value : JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return atob(normalized);
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function assertSessionSecret(env) {
  if (!env.KETANG_SESSION_SECRET || env.KETANG_SESSION_SECRET.length < 32) {
    throw new Error('KETANG_SESSION_SECRET 必须至少 32 字符');
  }
}

export async function signSession(env, user) {
  assertSessionSecret(env);
  const now = Math.floor(Date.now() / 1000);
  const payload = base64UrlEncode({ sub: user.id, username: user.username, role: user.role, iat: now, exp: now + 60 * 60 * 12 });
  const signature = await hmac(env.KETANG_SESSION_SECRET, payload);
  return `${payload}.${signature}`;
}

export async function verifySession(request, env, queryD1) {
  assertSessionSecret(env);
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = await hmac(env.KETANG_SESSION_SECRET, payload);
  if (signature !== expected) return null;
  const session = JSON.parse(base64UrlDecode(payload));
  if (!session.exp || session.exp < Math.floor(Date.now() / 1000)) return null;
  const users = await queryD1('SELECT id, username, role FROM users WHERE id = ? AND (is_active IS NULL OR is_active = 1) LIMIT 1', [session.sub]);
  return users[0] ? { ...session, role: users[0].role, username: users[0].username, id: users[0].id } : null;
}

export async function requireSession(request, env, queryD1) {
  const session = await verifySession(request, env, queryD1);
  if (!session) throw new Error('登录已过期，请重新登录');
  return session;
}

export function requireAdmin(session) {
  if (session.role !== 'admin') throw new Error('需要管理员权限');
}

const LOGIN_WINDOW_SEC = 15 * 60;
const LOGIN_MAX_FAILS = 8;

export async function checkLoginRateLimit(env, ip, queryD1, runD1) {
  const now = Math.floor(Date.now() / 1000);
  const rows = await queryD1('SELECT fail_count, window_start FROM login_attempts WHERE ip = ?', [ip]);
  const row = rows[0];
  if (!row) return;
  if (now - row.window_start > LOGIN_WINDOW_SEC) {
    await runD1('DELETE FROM login_attempts WHERE ip = ?', [ip]);
    return;
  }
  if (row.fail_count >= LOGIN_MAX_FAILS) throw new Error('登录尝试过多，请 15 分钟后再试');
}

export async function recordLoginFailure(env, ip, queryD1, runD1) {
  const now = Math.floor(Date.now() / 1000);
  const rows = await queryD1('SELECT fail_count, window_start FROM login_attempts WHERE ip = ?', [ip]);
  const row = rows[0];
  if (!row || now - row.window_start > LOGIN_WINDOW_SEC) {
    await runD1('INSERT INTO login_attempts (ip, fail_count, window_start) VALUES (?, 1, ?) ON CONFLICT(ip) DO UPDATE SET fail_count = 1, window_start = excluded.window_start', [ip, now]);
    return;
  }
  await runD1('UPDATE login_attempts SET fail_count = fail_count + 1 WHERE ip = ?', [ip]);
}

export async function clearLoginFailures(env, ip, runD1) {
  await runD1('DELETE FROM login_attempts WHERE ip = ?', [ip]);
}

export function mustChangePassword(user) {
  return isDefaultPasswordHash(user.password);
}
