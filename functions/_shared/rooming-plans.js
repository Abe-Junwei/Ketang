import { batchD1, insertAudit, queryD1, runD1 } from "./d1.js";
import { enrichWriteResponse, finishWrite } from "./write-response.js";
import { housekeepingRequiresInspect } from "./operational-settings.js";
import { requirePermission } from "./permissions.js";
import {
  evaluateRoomingConflicts,
  dateRangesOverlap,
} from "./rooming-conflicts.js";

export const PLAN_STATUSES = new Set(["未确认", "待调整", "已确认"]);
export const ITEM_STATUSES = new Set(["未确认", "待调整", "已确认"]);
export const MEMBER_KINDS = new Set(["lodger", "reservation", "forecast"]);

const KIND_ORDER = { lodger: 0, reservation: 1, forecast: 2 };

function text(value) {
  const v = String(value || "").trim();
  return v || null;
}

function requireId(value, label) {
  const id = parseInt(value, 10);
  if (!id) throw new Error(`缺少${label}`);
  return id;
}

function assertInSet(value, allowed, message) {
  if (!allowed.has(value)) throw new Error(message);
  return value;
}

async function roomingWritePatches(env, eventId) {
  const plans = await queryD1(
    env,
    "SELECT * FROM rooming_plans WHERE event_id = ? LIMIT 1",
    [eventId],
  );
  const plan = plans[0];
  if (!plan) return {};
  const assignments = await queryD1(
    env,
    "SELECT * FROM rooming_assignments WHERE plan_id = ? ORDER BY sort_order, id",
    [plan.id],
  );
  return {
    rooming_plans: [plan],
    rooming_assignments: assignments,
  };
}

function roomingAssignmentDeletions(rows) {
  return (rows || []).map(function (row) {
    return { table_name: "rooming_assignments", row_id: row.id };
  });
}

export function dormMatchesGender(dormType, gender) {
  if (!gender) return dormType === "不限";
  return (
    dormType === "不限" ||
    (dormType === "男寮" && gender === "男") ||
    (dormType === "女寮" && gender === "女")
  );
}

function spareRoomExcludeSql(alias, includeSpare) {
  if (includeSpare) return "1=1";
  const a = alias || "r";
  return `(COALESCE(${a}.location, '') NOT LIKE '备用%' AND COALESCE(${a}.location, '') NOT LIKE '%备用床%' AND COALESCE(${a}.name, '') NOT LIKE '备用%')`;
}

export function buildForecastMembers(
  event,
  registeredCount,
  registeredMale,
  registeredFemale,
) {
  const members = [];
  const expected = event.expected_count || 0;
  if (expected <= registeredCount) return members;

  let needMale = 0;
  let needFemale = 0;
  const remaining = expected - registeredCount;
  if (event.gender_type === "男众") {
    needMale = Math.max(0, expected - registeredMale);
  } else if (event.gender_type === "女众") {
    needFemale = Math.max(0, expected - registeredFemale);
  } else {
    const maleRatio =
      registeredCount > 0 ? registeredMale / registeredCount : 0.5;
    needMale = Math.round(remaining * maleRatio);
    needFemale = remaining - needMale;
  }

  let idx = 1;
  for (let i = 0; i < needMale; i++) {
    members.push({
      member_kind: "forecast",
      member_ref_id: null,
      member_name: `预计男众${idx++}`,
      member_gender: "男",
      participant_identity: null,
      age_group: null,
      special_needs: null,
    });
  }
  idx = 1;
  for (let i = 0; i < needFemale; i++) {
    members.push({
      member_kind: "forecast",
      member_ref_id: null,
      member_name: `预计女众${idx++}`,
      member_gender: "女",
      participant_identity: null,
      age_group: null,
      special_needs: null,
    });
  }
  return members;
}

export function buildAutoBedAssignments(members, beds) {
  const sortedMembers = members.slice().sort(function (a, b) {
    const ka = KIND_ORDER[a.member_kind] ?? 9;
    const kb = KIND_ORDER[b.member_kind] ?? 9;
    if (ka !== kb) return ka - kb;
    return String(a.member_name || "").localeCompare(
      String(b.member_name || ""),
      "zh",
    );
  });

  const maleBeds = beds.filter((b) => dormMatchesGender(b.dorm_type, "男"));
  const femaleBeds = beds.filter((b) => dormMatchesGender(b.dorm_type, "女"));
  const flexBeds = beds.filter((b) => b.dorm_type === "不限");

  const queues = {
    男: maleBeds.concat(flexBeds),
    女: femaleBeds.concat(flexBeds),
    "": beds.slice(),
  };

  const usedBedIds = new Set();
  const assignments = [];

  sortedMembers.forEach(function (member, index) {
    const gender = member.member_gender || "";
    const pool =
      gender === "男"
        ? queues["男"]
        : gender === "女"
          ? queues["女"]
          : queues[""];
    let bed = null;
    for (let i = 0; i < pool.length; i++) {
      const candidate = pool[i];
      if (!usedBedIds.has(candidate.bed_id)) {
        bed = candidate;
        usedBedIds.add(candidate.bed_id);
        break;
      }
    }
    assignments.push({
      member_kind: member.member_kind,
      member_ref_id: member.member_ref_id,
      member_name: member.member_name,
      member_gender: member.member_gender,
      participant_identity: member.participant_identity,
      age_group: member.age_group,
      special_needs: member.special_needs,
      bed_id: bed ? bed.bed_id : null,
      item_status: "未确认",
      notes: null,
      sort_order: index,
    });
  });

  return assignments;
}

export async function listEventMembersForPlan(env, eventId) {
  const lodgers = await queryD1(
    env,
    `SELECT id, name, gender, participant_identity, age_group, special_needs
     FROM lodgers WHERE event_id = ? AND status = '在住' ORDER BY name`,
    [eventId],
  );
  const reservations = await queryD1(
    env,
    `SELECT id, name, gender, participant_identity, age_group, special_needs
     FROM reservations WHERE event_id = ? AND status IN ('预约', '已确认') ORDER BY name`,
    [eventId],
  );
  const members = [];
  lodgers.forEach(function (row) {
    members.push({
      member_kind: "lodger",
      member_ref_id: row.id,
      member_name: row.name,
      member_gender: row.gender,
      participant_identity: row.participant_identity,
      age_group: row.age_group,
      special_needs: row.special_needs,
    });
  });
  reservations.forEach(function (row) {
    members.push({
      member_kind: "reservation",
      member_ref_id: row.id,
      member_name: row.name,
      member_gender: row.gender,
      participant_identity: row.participant_identity,
      age_group: row.age_group,
      special_needs: row.special_needs,
    });
  });
  const registeredMale = members.filter((m) => m.member_gender === "男").length;
  const registeredFemale = members.filter(
    (m) => m.member_gender === "女",
  ).length;
  const eventRows = await queryD1(env, "SELECT * FROM events WHERE id = ?", [
    eventId,
  ]);
  if (!eventRows.length) throw new Error("营期不存在");
  const forecast = buildForecastMembers(
    eventRows[0],
    members.length,
    registeredMale,
    registeredFemale,
  );
  return members.concat(forecast);
}

export async function listAssignableBeds(env, event, excludeBedIds) {
  const exclude = new Set(
    (excludeBedIds || []).map((id) => parseInt(id, 10)).filter(Boolean),
  );
  const requireInspect = await housekeepingRequiresInspect(env);
  const hkStatuses = requireInspect ? "('可用')" : "('净房','可用')";
  const includeSpare = !!event.include_spare_beds;
  const spareSql = spareRoomExcludeSql("r", includeSpare);
  const rows = await queryD1(
    env,
    `SELECT b.id AS bed_id, b.bed_number, r.id AS room_id, r.name AS room_name,
            r.location, r.dorm_type
     FROM beds b
     JOIN rooms r ON r.id = b.room_id
     LEFT JOIN lodgers l ON l.bed_id = b.id AND l.status = '在住'
     WHERE b.status NOT IN ('维修', '备用') AND l.id IS NULL
       AND ${spareSql}
       AND COALESCE((SELECT status FROM housekeeping WHERE bed_id = b.id ORDER BY changed_at DESC LIMIT 1), '净房') IN ${hkStatuses}
     ORDER BY CASE r.dorm_type WHEN '男寮' THEN 1 WHEN '女寮' THEN 2 ELSE 3 END,
              r.location, r.name, b.bed_number`,
    [],
  );
  return rows.filter((row) => !exclude.has(row.bed_id));
}

async function listDraftReservedBedIds(env, eventId, planId, event) {
  const range = {
    start: event.arrival_date || event.start_date,
    end: event.departure_date || event.end_date,
  };
  const rows = await queryD1(
    env,
    `SELECT ra.bed_id, e.arrival_date, e.departure_date, e.start_date, e.end_date
     FROM rooming_assignments ra
     JOIN rooming_plans rp ON rp.id = ra.plan_id
     JOIN events e ON e.id = rp.event_id
     WHERE ra.bed_id IS NOT NULL AND rp.event_id != ? AND (? = 0 OR rp.id != ?)`,
    [eventId, planId || 0, planId || 0],
  );
  const ids = new Set();
  rows.forEach((row) => {
    const otherStart = row.arrival_date || row.start_date;
    const otherEnd = row.departure_date || row.end_date;
    if (dateRangesOverlap(range.start, range.end, otherStart, otherEnd)) {
      ids.add(row.bed_id);
    }
  });
  return [...ids];
}

export async function getRoomingPlanBundle(env, eventId) {
  const plans = await queryD1(
    env,
    "SELECT * FROM rooming_plans WHERE event_id = ? LIMIT 1",
    [eventId],
  );
  if (!plans.length) return { plan: null, assignments: [] };
  const plan = plans[0];
  const assignments = await queryD1(
    env,
    `SELECT ra.*, r.name AS room_name, r.location AS room_location, r.dorm_type,
            b.bed_number
     FROM rooming_assignments ra
     LEFT JOIN beds b ON b.id = ra.bed_id
     LEFT JOIN rooms r ON r.id = b.room_id
     WHERE ra.plan_id = ?
     ORDER BY ra.sort_order, ra.id`,
    [plan.id],
  );
  return { plan, assignments };
}

async function ensurePlanForEvent(env, session, eventId) {
  const eventRows = await queryD1(env, "SELECT * FROM events WHERE id = ?", [
    eventId,
  ]);
  if (!eventRows.length) throw new Error("营期不存在");
  const existing = await queryD1(
    env,
    "SELECT * FROM rooming_plans WHERE event_id = ? LIMIT 1",
    [eventId],
  );
  if (existing.length) return existing[0];
  const event = eventRows[0];
  await runD1(
    env,
    `INSERT INTO rooming_plans (event_id, name, status, notes, updated_at)
     VALUES (?, ?, '未确认', '', CURRENT_TIMESTAMP)`,
    [eventId, `${event.name} 预分房`],
  );
  const plan = (
    await queryD1(
      env,
      "SELECT * FROM rooming_plans WHERE event_id = ? LIMIT 1",
      [eventId],
    )
  )[0];
  await insertAudit(
    env,
    "创建预分房草稿",
    "rooming_plan",
    plan.id,
    { event_id: eventId, name: event.name },
    session,
  );
  return plan;
}

export async function generateRoomingPlanAssignments(env, session, eventId) {
  await requirePermission(env, session, "settings.write");
  const eventRows = await queryD1(env, "SELECT * FROM events WHERE id = ?", [
    eventId,
  ]);
  if (!eventRows.length) throw new Error("营期不存在");
  const event = eventRows[0];
  const plan = await ensurePlanForEvent(env, session, eventId);
  const members = await listEventMembersForPlan(env, eventId);
  const reservedBedIds = await listDraftReservedBedIds(
    env,
    eventId,
    plan.id,
    event,
  );
  const beds = await listAssignableBeds(env, event, reservedBedIds);
  const draft = buildAutoBedAssignments(members, beds);
  const oldAssignments = await queryD1(
    env,
    "SELECT id FROM rooming_assignments WHERE plan_id = ?",
    [plan.id],
  );

  await runD1(env, "DELETE FROM rooming_assignments WHERE plan_id = ?", [
    plan.id,
  ]);
  const statements = draft.map(function (item) {
    return {
      sql: `INSERT INTO rooming_assignments
        (plan_id, member_kind, member_ref_id, member_name, member_gender,
         participant_identity, age_group, special_needs, bed_id, item_status, notes, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        plan.id,
        item.member_kind,
        item.member_ref_id,
        item.member_name,
        item.member_gender,
        item.participant_identity,
        item.age_group,
        item.special_needs,
        item.bed_id,
        item.item_status,
        item.notes,
        item.sort_order,
      ],
    };
  });
  if (statements.length) await batchD1(env, statements);
  await runD1(
    env,
    "UPDATE rooming_plans SET status = '未确认', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [plan.id],
  );
  await insertAudit(
    env,
    "自动生成预分房",
    "rooming_plan",
    plan.id,
    { count: draft.length },
    session,
  );
  const bundle = await getRoomingPlanBundle(env, eventId);
  const writeMeta = await finishWrite(
    env,
    {},
    ["events"],
    ["events", "event_rooming"],
  );
  return enrichWriteResponse(
    env,
    { ...bundle, ...writeMeta },
    {
      deletions: roomingAssignmentDeletions(oldAssignments),
      extraPatches: await roomingWritePatches(env, eventId),
      patchComplete: true,
    },
  );
}

export async function saveRoomingPlan(env, session, body) {
  await requirePermission(env, session, "settings.write");
  const planId = requireId(body.plan_id, "预分房方案");
  const plans = await queryD1(env, "SELECT * FROM rooming_plans WHERE id = ?", [
    planId,
  ]);
  if (!plans.length) throw new Error("预分房方案不存在");
  const plan = plans[0];
  const status = assertInSet(
    body.status || plan.status,
    PLAN_STATUSES,
    "无效的方案状态",
  );
  const notes = text(body.notes ?? plan.notes) || "";

  if (status === "已确认") {
    const check = await checkRoomingPlanConflicts(env, session, {
      event_id: plan.event_id,
      plan_id: planId,
      assignments: body.assignments,
    });
    if (check.error_count > 0) {
      throw new Error(
        `存在 ${check.error_count} 项硬性冲突，请先处理后再标记为「已确认」`,
      );
    }
  }

  const items = Array.isArray(body.assignments) ? body.assignments : null;
  if (items) {
    const existing = await queryD1(
      env,
      "SELECT id FROM rooming_assignments WHERE plan_id = ?",
      [planId],
    );
    const existingIds = new Set(existing.map((row) => row.id));
    const statements = [];
    items.forEach(function (item) {
      const id = parseInt(item.id, 10);
      if (!id || !existingIds.has(id)) return;
      const itemStatus = assertInSet(
        item.item_status || "未确认",
        ITEM_STATUSES,
        "无效的条目状态",
      );
      const bedId = item.bed_id ? parseInt(item.bed_id, 10) : null;
      statements.push({
        sql: `UPDATE rooming_assignments
              SET bed_id = ?, item_status = ?, notes = ?
              WHERE id = ? AND plan_id = ?`,
        params: [bedId, itemStatus, text(item.notes), id, planId],
      });
    });
    if (statements.length) await batchD1(env, statements);
  }

  await runD1(
    env,
    "UPDATE rooming_plans SET status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [status, notes, planId],
  );
  await insertAudit(
    env,
    "保存预分房草稿",
    "rooming_plan",
    planId,
    { status: status },
    session,
  );
  const bundle = await getRoomingPlanBundle(env, plan.event_id);
  const writeMeta = await finishWrite(
    env,
    {},
    ["events"],
    ["events", "event_rooming"],
  );
  return enrichWriteResponse(
    env,
    { ...bundle, ...writeMeta },
    {
      extraPatches: await roomingWritePatches(env, plan.event_id),
      patchComplete: true,
    },
  );
}

async function enrichAssignmentsForConflict(env, assignments) {
  const rows = Array.isArray(assignments) ? assignments : [];
  const enriched = [];
  for (const row of rows) {
    if (!row.bed_id) {
      enriched.push({ ...row });
      continue;
    }
    const meta = await queryD1(
      env,
      `SELECT b.id AS bed_id, b.bed_number, b.status AS bed_status, b.suitable_elder AS bed_suitable_elder,
              r.name AS room_name, r.location AS room_location, r.dorm_type, r.room_type,
              r.suitable_elder AS room_suitable_elder
       FROM beds b JOIN rooms r ON r.id = b.room_id WHERE b.id = ?`,
      [row.bed_id],
    );
    enriched.push({ ...row, ...(meta[0] || {}) });
  }
  return enriched;
}

async function listOccupiedBedsForConflict(env, bedIds) {
  if (!bedIds.length) return [];
  const placeholders = bedIds.map(() => "?").join(",");
  return queryD1(
    env,
    `SELECT l.id AS lodger_id, l.name AS lodger_name, l.event_id, l.bed_id, l.check_in_date,
            COALESCE(l.actual_check_out, l.expected_check_out) AS check_out_date,
            e.name AS event_name, r.name AS room_name, r.location AS room_location, b.bed_number
     FROM lodgers l
     JOIN beds b ON b.id = l.bed_id
     JOIN rooms r ON r.id = b.room_id
     LEFT JOIN events e ON e.id = l.event_id
     WHERE l.status = '在住' AND l.bed_id IN (${placeholders})`,
    bedIds,
  );
}

async function listOtherPlanBedUsage(env, bedIds, eventId, planId) {
  if (!bedIds.length) return [];
  const placeholders = bedIds.map(() => "?").join(",");
  const rows = await queryD1(
    env,
    `SELECT ra.bed_id, ra.member_name, rp.id AS plan_id, rp.event_id, e.name AS event_name,
            e.arrival_date, e.departure_date, e.start_date, e.end_date,
            r.name AS room_name, r.location AS room_location, b.bed_number
     FROM rooming_assignments ra
     JOIN rooming_plans rp ON rp.id = ra.plan_id
     JOIN events e ON e.id = rp.event_id
     LEFT JOIN beds b ON b.id = ra.bed_id
     LEFT JOIN rooms r ON r.id = b.room_id
     WHERE ra.bed_id IN (${placeholders}) AND rp.event_id != ? AND rp.id != ? AND ra.bed_id IS NOT NULL`,
    [...bedIds, eventId, planId || 0],
  );
  return rows.map((row) => ({
    bed_id: row.bed_id,
    member_name: row.member_name,
    event_id: row.event_id,
    event_name: row.event_name,
    start: row.arrival_date || row.start_date,
    end: row.departure_date || row.end_date,
    room_name: row.room_name,
    room_location: row.room_location,
    bed_number: row.bed_number,
  }));
}

async function buildHkByBed(env, bedIds) {
  const map = {};
  if (!bedIds.length) return map;
  const placeholders = bedIds.map(() => "?").join(",");
  const rows = await queryD1(
    env,
    `SELECT bed_id, status FROM housekeeping WHERE bed_id IN (${placeholders}) ORDER BY changed_at DESC`,
    bedIds,
  );
  rows.forEach((row) => {
    if (!map[row.bed_id]) map[row.bed_id] = row.status;
  });
  return map;
}

export async function checkRoomingPlanConflicts(env, session, body) {
  await requirePermission(env, session, "settings.read");
  const eventId = parseInt(body.event_id, 10) || 0;
  if (!eventId) throw new Error("缺少营期");
  const planId = parseInt(body.plan_id, 10) || 0;
  const eventRows = await queryD1(env, "SELECT * FROM events WHERE id = ?", [
    eventId,
  ]);
  if (!eventRows.length) throw new Error("营期不存在");

  let assignments = body.assignments;
  if (!Array.isArray(assignments) || !assignments.length) {
    const bundle = await getRoomingPlanBundle(env, eventId);
    assignments = bundle.assignments;
  }
  const enriched = await enrichAssignmentsForConflict(env, assignments);
  const bedIds = [
    ...new Set(
      enriched
        .filter((row) => row.bed_id)
        .map((row) => parseInt(row.bed_id, 10)),
    ),
  ];
  return evaluateRoomingConflicts({
    event: eventRows[0],
    assignments: enriched,
    occupiedBeds: await listOccupiedBedsForConflict(env, bedIds),
    otherPlanBeds: await listOtherPlanBedUsage(env, bedIds, eventId, planId),
    hkByBed: await buildHkByBed(env, bedIds),
    requireInspect: await housekeepingRequiresInspect(env),
  });
}

export async function handleRoomingPlanAction(env, session, body) {
  const action = text(body.action);
  if (!action) throw new Error("缺少 action");
  const eventId = parseInt(body.event_id, 10) || 0;

  if (action === "get") {
    await requirePermission(env, session, "settings.read");
    if (!eventId) throw new Error("缺少营期");
    return getRoomingPlanBundle(env, eventId);
  }

  if (action === "ensure") {
    await requirePermission(env, session, "settings.write");
    if (!eventId) throw new Error("缺少营期");
    await ensurePlanForEvent(env, session, eventId);
    const bundle = await getRoomingPlanBundle(env, eventId);
    const writeMeta = await finishWrite(
      env,
      {},
      ["events"],
      ["events", "event_rooming"],
    );
    return enrichWriteResponse(
      env,
      { ...bundle, ...writeMeta },
      {
        extraPatches: await roomingWritePatches(env, eventId),
        patchComplete: true,
      },
    );
  }

  if (action === "generate") {
    if (!eventId) throw new Error("缺少营期");
    return generateRoomingPlanAssignments(env, session, eventId);
  }

  if (action === "save") {
    return saveRoomingPlan(env, session, body);
  }

  if (action === "check") {
    return checkRoomingPlanConflicts(env, session, body);
  }

  throw new Error("未知 action: " + action);
}
