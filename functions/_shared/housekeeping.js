import { batchD1, bumpBoardVersion, insertAudit, queryD1 } from './d1.js';

export async function apiSetHouseStatus(env, session, body) {
  const bedId = parseInt(body.bed_id, 10);
  const status = body.status;
  if (!bedId || !status) throw new Error('参数不完整');
  if (status === '维修') {
    const occ = await queryD1(env, "SELECT COUNT(*) AS c FROM lodgers WHERE bed_id=? AND status='在住'", [bedId]);
    if ((occ[0]?.c || 0) > 0) throw new Error('该床位当前有在住住客，不能设为维修');
  }
  const statements = [
    { sql: 'INSERT INTO housekeeping (bed_id, status, operator, notes) VALUES (?, ?, ?, ?)', params: [bedId, status, session.username, body.notes || `手动设置${status}`] }
  ];
  if (status === '维修') {
    statements.push({ sql: "UPDATE beds SET status='维修' WHERE id=?", params: [bedId] });
  } else if (status === '净房' || status === '可用') {
    const occ = await queryD1(env, "SELECT COUNT(*) AS c FROM lodgers WHERE bed_id=? AND status='在住'", [bedId]);
    if ((occ[0]?.c || 0) === 0) statements.push({ sql: "UPDATE beds SET status='可用' WHERE id=?", params: [bedId] });
  }
  await batchD1(env, statements);
  await insertAudit(env, '房务状态变更', 'bed', bedId, { status }, session);
  await bumpBoardVersion(env);
  return { ok: true };
}
