import { json, readJson } from '../../_shared/http.js';
import { requireSession } from '../../_shared/auth.js';
import { queryD1, safeErrorMessage } from '../../_shared/d1.js';
import { apiChangeBed } from '../../_shared/lodgers.js';

export async function onRequestPost({ request, env }) {
  if (!env.KETANG_DB) return json({ error: '缺少 D1 绑定 KETANG_DB' }, 500);
  try {
    const session = await requireSession(request, env, (sql, p) => queryD1(env, sql, p));
    const body = await readJson(request);
    if (!body) return json({ error: '请求格式错误' }, 400);
    return json(await apiChangeBed(env, session, body));
  } catch (error) {
    const status = /登录已过期/.test(error.message) ? 401 : 500;
    return json({ error: safeErrorMessage(error) }, status);
  }
}
