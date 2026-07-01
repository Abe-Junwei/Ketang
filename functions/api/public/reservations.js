import { json, readJson } from '../../_shared/http.js';
import { initRemoteDatabase, safeErrorMessage } from '../../_shared/d1.js';
import { apiPublicReservation } from '../../_shared/lodgers.js';
import { checkRateLimit, recordRateLimitHit } from '../../_shared/rate-limit.js';
import { clientIp } from '../../_shared/http.js';
import { queryD1, runD1 } from '../../_shared/d1.js';

export async function onRequestPost({ request, env }) {
  if (!env.KETANG_DB) return json({ error: '缺少 D1 绑定 KETANG_DB' }, 500);
  try {
    await initRemoteDatabase(env);
    const ip = clientIp(request);
    const bindQ = (sql, p) => queryD1(env, sql, p);
    const bindR = (sql, p) => runD1(env, sql, p);
    await checkRateLimit(env, ip, 'public_resv', 20, bindQ, bindR, 15 * 60);
    const body = await readJson(request);
    if (!body) return json({ error: '请求格式错误' }, 400);
    if (env.KETANG_PUBLIC_RESERVATIONS === 'false') {
      return json({ error: '线上预约未开放' }, 403);
    }
    const result = await apiPublicReservation(env, body);
    return json(result, 201);
  } catch (error) {
    const status = /过于频繁/.test(error.message) ? 429 : 400;
    return json({ error: safeErrorMessage(error) }, status);
  }
}
