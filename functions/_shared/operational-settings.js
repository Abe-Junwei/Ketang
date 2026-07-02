import { insertAudit, queryD1, runD1 } from "./d1.js";
import { finishWrite } from "./write-response.js";

export const HK_REQUIRE_INSPECT_KEY = "housekeeping_require_inspect_v1";

/** 可同步给知客/房务的 app_meta 键（不含 role_permissions 等）| Operational keys for lodging roles */
export const LODGING_APP_META_KEYS = [HK_REQUIRE_INSPECT_KEY];

/** 房务状态流转是否允许 | Housekeeping status transition guard */
export function isHousekeepingTransitionAllowed(
  fromStatus,
  toStatus,
  requireInspect,
) {
  const from = fromStatus || "净房";
  const to = toStatus;
  if (!to || from === to) return false;
  if (to === "占用") return true;
  if (to === "脏房") return true;
  if (to === "维修") return true;
  if (from === "维修" && to === "净房") return true;
  if (from === "脏房" && to === "净房") return true;
  if (!requireInspect && from === "净房" && to === "可用") return true;
  if (requireInspect && from === "净房" && to === "查房") return true;
  if (from === "查房" && to === "可用") return true;
  return false;
}

export async function getAppMetaValue(env, key) {
  const rows = await queryD1(
    env,
    "SELECT value FROM app_meta WHERE key = ? LIMIT 1",
    [key],
  );
  return rows[0]?.value ?? null;
}

export async function setAppMetaValue(env, key, value) {
  await runD1(
    env,
    "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, String(value)],
  );
}

export async function housekeepingRequiresInspect(env) {
  const raw = await getAppMetaValue(env, HK_REQUIRE_INSPECT_KEY);
  return raw === "1" || raw === "true";
}

export async function getOperationalSettings(env) {
  return {
    housekeeping_require_inspect: await housekeepingRequiresInspect(env),
  };
}

export async function saveOperationalSettings(env, session, body) {
  const requireInspect = !!body.housekeeping_require_inspect;
  await setAppMetaValue(
    env,
    HK_REQUIRE_INSPECT_KEY,
    requireInspect ? "1" : "0",
  );
  await insertAudit(
    env,
    "更新运营配置",
    "app_meta",
    null,
    { housekeeping_require_inspect: requireInspect },
    session,
  );
  return finishWrite(
    env,
    { housekeeping_require_inspect: requireInspect },
    ["settings", "board"],
    ["board"],
  );
}
