import { json, readJson } from "../_shared/http.js";

/** Legacy POST /api/db — fully retired; use /api/v1/* instead */
const LEGACY_DB_RETIRED = {
  error:
    "POST /api/db 已完全退役。登录请用 POST /api/v1/auth/login；数据库初始化请用 POST /api/v1/admin/migrate（需管理员会话与 x-ketang-bootstrap）。",
};

export async function onRequestPost({ request, env }) {
  if (!env.KETANG_DB) return json({ error: "缺少 D1 绑定 KETANG_DB" }, 500);
  await readJson(request);
  return json(LEGACY_DB_RETIRED, 410);
}
