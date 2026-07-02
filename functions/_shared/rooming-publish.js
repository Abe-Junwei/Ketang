import {
  batchD1,
  bumpBoardVersion,
  insertAudit,
  queryD1,
  runD1,
} from "./d1.js";
import { requirePermission } from "./permissions.js";
import { checkRoomingPlanConflicts } from "./rooming-plans.js";

export const QUEUE_STATUSES = new Set(["待办理", "已办理", "已跳过"]);

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

function roomingQueueProcessedAt() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

export async function getRoomingCheckinQueue(env, eventId) {
  return queryD1(
    env,
    `SELECT q.*, r.name AS room_name, r.location AS room_location, r.dorm_type,
            b.bed_number
     FROM rooming_checkin_queue q
     LEFT JOIN beds b ON b.id = q.suggested_bed_id
     LEFT JOIN rooms r ON r.id = b.room_id
     WHERE q.event_id = ?
     ORDER BY q.sort_order, q.id`,
    [eventId],
  );
}

async function getPublishableAssignments(env, planId) {
  return queryD1(
    env,
    `SELECT * FROM rooming_assignments
     WHERE plan_id = ? AND member_kind IN ('lodger', 'reservation')
     ORDER BY sort_order, id`,
    [planId],
  );
}

async function insertQueueFromAssignments(env, planId, eventId, assignments) {
  if (!assignments.length) return;
  const statements = assignments.map(function (row, index) {
    return {
      sql: `INSERT INTO rooming_checkin_queue
        (plan_id, assignment_id, event_id, member_kind, member_ref_id, member_name,
         member_gender, participant_identity, age_group, special_needs, suggested_bed_id,
         queue_status, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '待办理', ?)`,
      params: [
        planId,
        row.id,
        eventId,
        row.member_kind,
        row.member_ref_id,
        row.member_name,
        row.member_gender,
        row.participant_identity,
        row.age_group,
        row.special_needs,
        row.bed_id,
        index,
      ],
    };
  });
  await batchD1(env, statements);
}

export async function publishRoomingPlan(env, session, eventId) {
  await requirePermission(env, session, "settings.write");
  const eventRows = await queryD1(env, "SELECT * FROM events WHERE id = ?", [eventId]);
  if (!eventRows.length) throw new Error("营期不存在");
  const plans = await queryD1(
    env,
    "SELECT * FROM rooming_plans WHERE event_id = ? LIMIT 1",
    [eventId],
  );
  if (!plans.length) throw new Error("请先生成并保存预分房草稿");
  const plan = plans[0];
  if (plan.status !== "已确认") {
    throw new Error("仅「已确认」的预分房方案可发布");
  }
  if (plan.published_at) {
    throw new Error("该方案已发布，如需更新请使用「重新发布」");
  }

  const check = await checkRoomingPlanConflicts(env, session, {
    event_id: eventId,
    plan_id: plan.id,
  });
  if (check.error_count > 0) {
    throw new Error(`存在 ${check.error_count} 项硬性冲突，无法发布`);
  }

  const assignments = await getPublishableAssignments(env, plan.id);
  if (!assignments.length) {
    throw new Error("没有可发布的在住/预约条目（预计占位不会进入待入住清单）");
  }

  await runD1(env, "DELETE FROM rooming_checkin_queue WHERE plan_id = ?", [plan.id]);
  await insertQueueFromAssignments(env, plan.id, eventId, assignments);

  const publishedAt = roomingQueueProcessedAt();
  await runD1(
    env,
    "UPDATE rooming_plans SET published_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [publishedAt, plan.id],
  );
  await bumpBoardVersion(env);
  await insertAudit(
    env,
    "发布预分房待入住清单",
    "rooming_plan",
    plan.id,
    { event_id: eventId, queue_count: assignments.length },
    session,
  );

  return {
    plan: { ...plan, published_at: publishedAt },
    queue: await getRoomingCheckinQueue(env, eventId),
    published_count: assignments.length,
  };
}

export async function republishRoomingPlan(env, session, eventId, body) {
  await requirePermission(env, session, "settings.write");
  if (!body || !body.confirm_republish) {
    throw new Error("重新发布需要确认（confirm_republish）");
  }
  const plans = await queryD1(
    env,
    "SELECT * FROM rooming_plans WHERE event_id = ? LIMIT 1",
    [eventId],
  );
  if (!plans.length) throw new Error("预分房方案不存在");
  const plan = plans[0];
  if (!plan.published_at) throw new Error("尚未发布，请使用首次发布");
  if (plan.status !== "已确认") {
    throw new Error("仅「已确认」的预分房方案可重新发布");
  }

  const check = await checkRoomingPlanConflicts(env, session, {
    event_id: eventId,
    plan_id: plan.id,
  });
  if (check.error_count > 0) {
    throw new Error(`存在 ${check.error_count} 项硬性冲突，无法重新发布`);
  }

  const assignments = await getPublishableAssignments(env, plan.id);
  if (!assignments.length) {
    throw new Error("没有可发布的在住/预约条目");
  }

  const existing = await queryD1(
    env,
    "SELECT assignment_id, queue_status FROM rooming_checkin_queue WHERE plan_id = ?",
    [plan.id],
  );
  const finalizedAssignmentIds = new Set(
    existing
      .filter(function (row) {
        return row.queue_status !== "待办理" && row.assignment_id != null;
      })
      .map(function (row) {
        return row.assignment_id;
      }),
  );
  const pendingAssignments = assignments.filter(function (row) {
    return !finalizedAssignmentIds.has(row.id);
  });

  await runD1(
    env,
    "DELETE FROM rooming_checkin_queue WHERE plan_id = ? AND queue_status = '待办理'",
    [plan.id],
  );
  await insertQueueFromAssignments(env, plan.id, eventId, pendingAssignments);
  await runD1(
    env,
    "UPDATE rooming_plans SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [plan.id],
  );
  await bumpBoardVersion(env);
  await insertAudit(
    env,
    "重新发布预分房待入住清单",
    "rooming_plan",
    plan.id,
    { event_id: eventId, pending_count: pendingAssignments.length },
    session,
  );

  return {
    plan: plan,
    queue: await getRoomingCheckinQueue(env, eventId),
    published_count: pendingAssignments.length,
  };
}

export async function updateRoomingQueueItem(env, session, body) {
  await requirePermission(env, session, "lodging.checkin");
  const queueId = requireId(body.queue_id, "待入住条目");
  const status = assertInSet(
    body.queue_status || "已办理",
    QUEUE_STATUSES,
    "无效的清单状态",
  );
  const rows = await queryD1(
    env,
    "SELECT * FROM rooming_checkin_queue WHERE id = ?",
    [queueId],
  );
  if (!rows.length) throw new Error("待入住条目不存在");
  const processedAt = status === "待办理" ? null : roomingQueueProcessedAt();
  await runD1(
    env,
    "UPDATE rooming_checkin_queue SET queue_status = ?, processed_at = ? WHERE id = ?",
    [status, processedAt, queueId],
  );
  await bumpBoardVersion(env);
  await insertAudit(
    env,
    "更新待入住清单",
    "rooming_checkin_queue",
    queueId,
    { queue_status: status },
    session,
  );
  return rows[0];
}

export async function handleRoomingPublishAction(env, session, body) {
  const action = text(body.action);
  if (!action) throw new Error("缺少 action");
  const eventId = parseInt(body.event_id, 10) || 0;

  if (action === "queue") {
    await requirePermission(env, session, "lodging.read");
    if (!eventId) throw new Error("缺少营期");
    const queue = await getRoomingCheckinQueue(env, eventId);
    const plan = (
      await queryD1(
        env,
        "SELECT * FROM rooming_plans WHERE event_id = ? LIMIT 1",
        [eventId],
      )
    )[0];
    return { plan: plan || null, queue: queue };
  }

  if (action === "publish") {
    if (!eventId) throw new Error("缺少营期");
    return publishRoomingPlan(env, session, eventId);
  }

  if (action === "republish") {
    if (!eventId) throw new Error("缺少营期");
    return republishRoomingPlan(env, session, eventId, body);
  }

  if (action === "update_queue") {
    return updateRoomingQueueItem(env, session, body);
  }

  throw new Error("未知 action: " + action);
}
