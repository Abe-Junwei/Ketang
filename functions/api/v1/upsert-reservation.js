import { json, readJson, apiErrorStatus } from "../../_shared/http.js";
import { requireSession } from "../../_shared/auth.js";
import { ensureBusinessDatabaseReady, queryD1, safeErrorMessage } from "../../_shared/d1.js";
import { requirePermission } from "../../_shared/permissions.js";
import { apiUpsertReservation } from "../../_shared/reservations.js";

export async function onRequestPost({ request, env }) {
  if (!env.KETANG_DB) return json({ error: "缺少 D1 绑定 KETANG_DB" }, 500);
  try {
    await ensureBusinessDatabaseReady(env);
    const session = await requireSession(request, env, (sql, p) =>
      queryD1(env, sql, p),
    );
    await requirePermission(env, session, "reservation.write");
    const body = await readJson(request);
    if (!body) return json({ error: "请求格式错误" }, 400);
    return json(await apiUpsertReservation(env, session, body));
  } catch (error) {
    return json({ error: safeErrorMessage(error) }, apiErrorStatus(error));
  }
}
