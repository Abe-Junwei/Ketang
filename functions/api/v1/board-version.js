import { json } from '../../_shared/http.js';
import { requireSession } from '../../_shared/auth.js';
import { getBoardVersion, queryD1, safeErrorMessage } from '../../_shared/d1.js';

export async function onRequestGet({ request, env }) {
  if (!env.KETANG_DB) return json({ error: '缺少 D1 绑定 KETANG_DB' }, 500);
  try {
    await requireSession(request, env, (sql, p) => queryD1(env, sql, p));
    const version = await getBoardVersion(env);
    return json({ version });
  } catch (error) {
    const status = /登录已过期/.test(error.message) ? 401 : 500;
    return json({ error: safeErrorMessage(error) }, status);
  }
}
