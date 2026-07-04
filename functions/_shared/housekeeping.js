import { batchD1, insertAudit, queryD1 } from "./d1.js";
import { finishWrite, enrichWriteResponse } from "./write-response.js";
import {
  housekeepingRequiresInspect,
  isHousekeepingTransitionAllowed,
} from "./operational-settings.js";

async function getHouseStatus(env, bedId) {
  const rows = await queryD1(
    env,
    "SELECT status FROM housekeeping WHERE bed_id = ? ORDER BY changed_at DESC LIMIT 1",
    [bedId],
  );
  return rows[0]?.status || "净房";
}

export async function apiSetHouseStatus(env, session, body) {
  const bedId = parseInt(body.bed_id, 10);
  const status = body.status;
  if (!bedId || !status) throw new Error("参数不完整");
  if (status === "维修") {
    const occ = await queryD1(
      env,
      "SELECT COUNT(*) AS c FROM lodgers WHERE bed_id=? AND status='在住'",
      [bedId],
    );
    if ((occ[0]?.c || 0) > 0)
      throw new Error("该床位当前有在住住客，不能设为维修");
  }
  const current = await getHouseStatus(env, bedId);
  const requireInspect = await housekeepingRequiresInspect(env);
  if (!isHousekeepingTransitionAllowed(current, status, requireInspect)) {
    throw new Error(
      requireInspect
        ? `当前为「${current}」，需按脏房→净房→查房→可入住流转`
        : `当前为「${current}」，不能直接设为「${status}」`,
    );
  }
  const bedRows = await queryD1(env, "SELECT * FROM beds WHERE id=? LIMIT 1", [
    bedId,
  ]);
  const bed = bedRows[0];
  const statements = [
    {
      sql: "INSERT INTO housekeeping (bed_id, status, operator, notes) VALUES (?, ?, ?, ?)",
      params: [
        bedId,
        status,
        session.username,
        body.notes || `手动设置${status}`,
      ],
    },
  ];
  let bedPatchStatus = bed?.status || null;
  if (status === "维修") {
    statements.push({
      sql: "UPDATE beds SET status='维修' WHERE id=?",
      params: [bedId],
    });
    bedPatchStatus = "维修";
  } else if (status === "净房" || status === "可用") {
    const occ = await queryD1(
      env,
      "SELECT COUNT(*) AS c FROM lodgers WHERE bed_id=? AND status='在住'",
      [bedId],
    );
    if ((occ[0]?.c || 0) === 0) {
      statements.push({
        sql: "UPDATE beds SET status='可用' WHERE id=?",
        params: [bedId],
      });
      bedPatchStatus = "可用";
    }
  }
  await batchD1(env, statements);
  await insertAudit(env, "房务状态变更", "bed", bedId, { status }, session);
  const hkRows = await queryD1(
    env,
    "SELECT * FROM housekeeping WHERE bed_id = ? ORDER BY changed_at DESC LIMIT 1",
    [bedId],
  );
  const bedPatch =
    bed && bedPatchStatus ? { ...bed, status: bedPatchStatus } : bed ? { ...bed } : null;
  return enrichWriteResponse(
    env,
    await finishWrite(env, {}, ["board", "housekeeping"], ["board"]),
    {
      patchRow: bedPatch,
      patchTable: "beds",
      extraPatches: hkRows[0] ? { housekeeping: [hkRows[0]] } : {},
      patchComplete: true,
    },
  );
}
