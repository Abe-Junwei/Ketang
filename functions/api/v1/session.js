import { json } from '../../_shared/http.js';
import { initRemoteDatabase, queryD1, safeErrorMessage } from '../../_shared/d1.js';
import { getSessionUser } from '../../_shared/users.js';

export async function onRequestGet({ request, env }) {
  if (!env.KETANG_DB) return json({ error: '缺少 D1 绑定 KETANG_DB' }, 500);
  try {
    await initRemoteDatabase(env);
    const bindQuery = (sql, p) => queryD1(env, sql, p);
    const result = await getSessionUser(env, request, bindQuery);
    if (!result) return json({ error: '登录已过期，请重新登录' }, 401);
    return json(result);
  } catch (error) {
    return json({ error: safeErrorMessage(error) }, 500);
  }
}
