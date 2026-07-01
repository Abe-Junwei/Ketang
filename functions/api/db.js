import { json, readJson, clientIp } from '../_shared/http.js';
import {
  verifyPassword, signSession, requireSession, checkLoginRateLimit,
  recordLoginFailure, clearLoginFailures, mustChangePassword, sha256Hex
} from '../_shared/auth.js';
import {
  queryD1, runD1, initRemoteDatabase, isDatabaseEmpty, assertAllowedSql, safeErrorMessage
} from '../_shared/d1.js';
import { checkRateLimit } from '../_shared/rate-limit.js';

const bindQuery = (env) => (sql, params) => queryD1(env, sql, params);
const bindRun = (env) => (sql, params) => runD1(env, sql, params);

export async function onRequestPost({ request, env }) {
  if (!env.KETANG_DB) return json({ error: '缺少 D1 绑定 KETANG_DB' }, 500);
  const payload = await readJson(request);
  if (!payload) return json({ error: '请求格式错误' }, 400);
  const ip = clientIp(request);

  try {
    if (payload.action === 'init') {
      if (payload.force === true) {
        const empty = await isDatabaseEmpty(env);
        if (!empty) {
          const secret = request.headers.get('x-ketang-bootstrap') || '';
          if (!env.KETANG_BOOTSTRAP_SECRET || secret !== env.KETANG_BOOTSTRAP_SECRET) {
            return json({ error: '数据库已初始化，禁止强制 reseed' }, 403);
          }
        }
      }
      const seeded = await initRemoteDatabase(env);
      return json({ ok: true, seeded, already_initialized: !seeded });
    }

    if (payload.action === 'users') {
      await initRemoteDatabase(env);
      await checkRateLimit(env, ip, 'users_list', 30, bindQuery(env), bindRun(env), 60);
      const rows = await queryD1(env, 'SELECT username, display_name, role FROM users WHERE is_active IS NULL OR is_active = 1 ORDER BY role, username', []);
      return json({ rows });
    }

    if (payload.action === 'login') {
      await initRemoteDatabase(env);
      await checkLoginRateLimit(env, ip, bindQuery(env), bindRun(env));
      const rows = await queryD1(env, 'SELECT * FROM users WHERE username = ? AND (is_active IS NULL OR is_active = 1) LIMIT 1', [payload.username]);
      const user = rows[0];
      if (!user || !(await verifyPassword(payload.password || '', user.password))) {
        await recordLoginFailure(env, ip, bindQuery(env), bindRun(env));
        return json({ error: '账号或密码错误' }, 401);
      }
      await clearLoginFailures(env, ip, bindRun(env));
      const token = await signSession(env, user);
      return json({
        token,
        user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role },
        must_change_password: mustChangePassword(user)
      });
    }

    const session = await requireSession(request, env, bindQuery);

    if (payload.action === 'change_password') {
      const rows = await queryD1(env, 'SELECT * FROM users WHERE id = ? LIMIT 1', [session.sub || session.id]);
      const user = rows[0];
      if (!user || !(await verifyPassword(payload.old_password || '', user.password))) {
        return json({ error: '原密码错误' }, 401);
      }
      const newPassword = String(payload.new_password || '');
      if (newPassword.length < 6) return json({ error: '新密码至少 6 位' }, 400);
      const salt = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
      const hash = 'sha256$' + salt + '$' + await sha256Hex(salt + newPassword);
      await runD1(env, 'UPDATE users SET password = ? WHERE id = ?', [hash, user.id]);
      return json({ ok: true });
    }

    if (payload.action === 'batch_query') {
      const queries = Array.isArray(payload.queries) ? payload.queries.slice(0, 20) : [];
      if (!queries.length) return json({ error: 'queries 不能为空' }, 400);
      const results = [];
      for (const item of queries) {
        const sql = assertAllowedSql('batch_query', item.sql, session);
        results.push(await queryD1(env, sql, item.params || []));
      }
      return json({ results });
    }

    if (payload.action === 'query') {
      const sql = assertAllowedSql('query', payload.sql, session);
      const rows = await queryD1(env, sql, payload.params || []);
      return json({ rows });
    }

    if (payload.action === 'run') {
      const sql = assertAllowedSql('run', payload.sql, session);
      const meta = await runD1(env, sql, payload.params || []);
      return json({ meta });
    }

    if (payload.action === 'exec') {
      const sql = assertAllowedSql('exec', payload.sql, session);
      const rows = await queryD1(env, sql, payload.params || []);
      const columns = rows[0] ? Object.keys(rows[0]) : [];
      return json({ result: [{ columns, values: rows.map(row => columns.map(column => row[column])) }] });
    }

    return json({ error: '未知操作' }, 400);
  } catch (error) {
    console.error('Ketang API error:', error);
    const status = /登录已过期/.test(error.message) ? 401 : (/过于频繁|尝试过多/.test(error.message) ? 429 : 500);
    return json({ error: safeErrorMessage(error) }, status);
  }
}
