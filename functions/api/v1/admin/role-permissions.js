import { json, readJson, apiErrorStatus } from "../../../_shared/http.js";
import { requireSession } from "../../../_shared/auth.js";
import {
  ensureDatabaseReady,
  queryD1,
  safeErrorMessage,
} from "../../../_shared/d1.js";
import {
  getRolePermissionsConfig,
  requirePermission,
  saveRolePermissions,
} from "../../../_shared/permissions.js";

/** GET/POST /api/v1/admin/role-permissions — 角色权限矩阵 | Role permission matrix */
export async function onRequestGet({ request, env }) {
  if (!env.KETANG_DB) return json({ error: "缺少 D1 绑定 KETANG_DB" }, 500);
  try {
    const session = await requireSession(request, env, (sql, p) =>
      queryD1(env, sql, p),
    );
    await ensureDatabaseReady(env, { allowMigrationFallback: false });
    await requirePermission(env, session, "users.write");
    return json(await getRolePermissionsConfig(env));
  } catch (error) {
    return json({ error: safeErrorMessage(error) }, apiErrorStatus(error));
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.KETANG_DB) return json({ error: "缺少 D1 绑定 KETANG_DB" }, 500);
  try {
    const session = await requireSession(request, env, (sql, p) =>
      queryD1(env, sql, p),
    );
    await ensureDatabaseReady(env, { allowMigrationFallback: false });
    const body = await readJson(request);
    if (!body) return json({ error: "请求格式错误" }, 400);
    return json(await saveRolePermissions(env, session, body));
  } catch (error) {
    return json({ error: safeErrorMessage(error) }, apiErrorStatus(error));
  }
}
