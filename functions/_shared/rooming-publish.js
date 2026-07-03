import { batchD1, insertAudit, queryD1, runD1 } from "./d1.js";
import { enrichWriteResponse, finishWrite } from "./write-response.js";
import { apiAssignBed, apiAssignReservationToBed } from "./lodgers.js";
import { requirePermission } from "./permissions.js";
import { checkRoomingPlanConflicts } from "./rooming-plans.js";

export const QUEUE_STATUSES = new Set(["待办理", "已办理", "已跳过"]);
export const ADJUSTMENT_KINDS = new Set([
  "换床",
  "跳过预分",
  "手动备注",
  "其他",
]);

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

async function roomingPublishPatches(env, eventId) {
  const plans = await queryD1(
    env,
    "SELECT * FROM rooming_plans WHERE event_id = ? LIMIT 1",
    [eventId],
  );
  const plan = plans[0];
  const queue = await getRoomingCheckinQueue(env, eventId);
  return {
    rooming_plans: plan ? [plan] : [],
    rooming_checkin_queue: queue,
  };
}

async function roomingQueuePatches(env, queueId) {
  const rows = await queryD1(
    env,
    "SELECT * FROM rooming_checkin_queue WHERE id = ? LIMIT 1",
    [queueId],
  );
  return { rooming_checkin_queue: rows };
}

async function roomingAdjustmentPatches(env, adjustmentId) {
  const rows = await queryD1(
    env,
    "SELECT * FROM rooming_adjustments WHERE id = ? LIMIT 1",
    [adjustmentId],
  );
  return { rooming_adjustments: rows };
}

function roomingQueueDeletions(rows) {
  return (rows || []).map(function (row) {
    return { table_name: "rooming_checkin_queue", row_id: row.id };
  });
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

function buildQueueInsertStatements(planId, eventId, assignments) {
  return assignments.map(function (row, index) {
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
}

async function runAtomicRoomingBatch(env, statements) {
  if (!statements.length) return;
  await batchD1(env, statements);
}

async function insertQueueFromAssignments(env, planId, eventId, assignments) {
  const statements = buildQueueInsertStatements(planId, eventId, assignments);
  if (statements.length) await batchD1(env, statements);
}

export async function publishRoomingPlan(env, session, eventId) {
  await requirePermission(env, session, "settings.write");
  const eventRows = await queryD1(env, "SELECT * FROM events WHERE id = ?", [
    eventId,
  ]);
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

  const publishedAt = roomingQueueProcessedAt();
  const oldQueue = await queryD1(
    env,
    "SELECT id FROM rooming_checkin_queue WHERE plan_id = ?",
    [plan.id],
  );
  await runAtomicRoomingBatch(env, [
    {
      sql: "DELETE FROM rooming_checkin_queue WHERE plan_id = ?",
      params: [plan.id],
    },
    ...buildQueueInsertStatements(plan.id, eventId, assignments),
    {
      sql: "UPDATE rooming_plans SET published_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      params: [publishedAt, plan.id],
    },
  ]);
  await insertAudit(
    env,
    "发布预分房待入住清单",
    "rooming_plan",
    plan.id,
    { event_id: eventId, queue_count: assignments.length },
    session,
  );

  const payload = {
    plan: { ...plan, published_at: publishedAt },
    queue: await getRoomingCheckinQueue(env, eventId),
    published_count: assignments.length,
  };
  const writeMeta = await finishWrite(
    env,
    {},
    ["events", "lodging"],
    ["events", "board"],
  );
  return enrichWriteResponse(env, { ...payload, ...writeMeta }, {
    deletions: roomingQueueDeletions(oldQueue),
    extraPatches: await roomingPublishPatches(env, eventId),
  });
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
  const pendingQueue = await queryD1(
    env,
    "SELECT id FROM rooming_checkin_queue WHERE plan_id = ? AND queue_status = '待办理'",
    [plan.id],
  );

  await runAtomicRoomingBatch(env, [
    {
      sql: "DELETE FROM rooming_checkin_queue WHERE plan_id = ? AND queue_status = '待办理'",
      params: [plan.id],
    },
    ...buildQueueInsertStatements(plan.id, eventId, pendingAssignments),
    {
      sql: "UPDATE rooming_plans SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      params: [plan.id],
    },
  ]);
  await insertAudit(
    env,
    "重新发布预分房待入住清单",
    "rooming_plan",
    plan.id,
    { event_id: eventId, pending_count: pendingAssignments.length },
    session,
  );

  const payload = {
    plan: plan,
    queue: await getRoomingCheckinQueue(env, eventId),
    published_count: pendingAssignments.length,
  };
  const writeMeta = await finishWrite(
    env,
    {},
    ["events", "lodging"],
    ["events", "board"],
  );
  return enrichWriteResponse(env, { ...payload, ...writeMeta }, {
    deletions: roomingQueueDeletions(pendingQueue),
    extraPatches: await roomingPublishPatches(env, eventId),
  });
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
  await insertAudit(
    env,
    "更新待入住清单",
    "rooming_checkin_queue",
    queueId,
    { queue_status: status },
    session,
  );
  const writeMeta = await finishWrite(env, {}, ["events"], ["events"]);
  const extraPatches = await roomingQueuePatches(env, queueId);
  const updatedRow = extraPatches.rooming_checkin_queue[0] || rows[0];
  return enrichWriteResponse(env, { ...updatedRow, ...writeMeta }, {
    extraPatches: extraPatches,
  });
}

async function roomingQueueAssignAlreadyDoneServer(env, item) {
  if (!item.member_ref_id) return false;
  if (item.member_kind === "lodger") {
    const rows = await queryD1(
      env,
      "SELECT bed_id FROM lodgers WHERE id=? AND status='在住'",
      [item.member_ref_id],
    );
    return !!(rows[0] && rows[0].bed_id == item.suggested_bed_id);
  }
  if (item.member_kind === "reservation") {
    const rows = await queryD1(
      env,
      "SELECT status FROM reservations WHERE id=?",
      [item.member_ref_id],
    );
    return !!(rows[0] && rows[0].status === "已入住");
  }
  return false;
}

async function markRoomingQueueDone(env, session, queueId, options) {
  const processedAt = roomingQueueProcessedAt();
  await runD1(
    env,
    "UPDATE rooming_checkin_queue SET queue_status = ?, processed_at = ? WHERE id = ?",
    ["已办理", processedAt, queueId],
  );
  await insertAudit(
    env,
    "更新待入住清单",
    "rooming_checkin_queue",
    queueId,
    { queue_status: "已办理" },
    session,
  );
  if (options && options.deferFinishWrite) {
    return { ok: true, deferred: true };
  }
  return finishWrite(
    env,
    {},
    ["events", "lodging", "board"],
    ["events", "board"],
  );
}

export async function processRoomingQueueCheckin(env, session, body) {
  await requirePermission(env, session, "lodging.checkin");
  const queueId = requireId(body.queue_id, "待入住条目");
  const rows = await queryD1(
    env,
    "SELECT * FROM rooming_checkin_queue WHERE id = ?",
    [queueId],
  );
  if (!rows.length) throw new Error("待入住条目不存在");
  const item = rows[0];
  if (item.queue_status !== "待办理") throw new Error("该条目已处理");
  if (!item.suggested_bed_id) throw new Error("该条目未指定建议床位");
  if (!item.member_ref_id) throw new Error("该条目缺少关联人员");

  let assigned = await roomingQueueAssignAlreadyDoneServer(env, item);
  let assignedLodgerId = item.member_kind === "lodger" ? item.member_ref_id : null;
  const deferOpts = { deferFinishWrite: true };
  if (!assigned) {
    try {
      if (item.member_kind === "lodger") {
        await apiAssignBed(
          env,
          session,
          {
            lodger_id: item.member_ref_id,
            bed_id: item.suggested_bed_id,
          },
          deferOpts,
        );
      } else {
        const assignResult = await apiAssignReservationToBed(
          env,
          session,
          {
            reservation_id: item.member_ref_id,
            bed_id: item.suggested_bed_id,
          },
          deferOpts,
        );
        assignedLodgerId = assignResult?.lodger_id || null;
      }
      assigned = true;
    } catch (err) {
      if (await roomingQueueAssignAlreadyDoneServer(env, item)) {
        assigned = true;
      } else if (item.member_kind === "lodger") {
        const lodgerRows = await queryD1(
          env,
          "SELECT bed_id FROM lodgers WHERE id=? AND status='在住'",
          [item.member_ref_id],
        );
        if (lodgerRows[0]?.bed_id) {
          throw new Error("该挂单已占用其他床位，请手动处理或跳过本条");
        }
      }
      if (!assigned) throw err;
    }
  }

  await markRoomingQueueDone(env, session, queueId, deferOpts);
  const changedDomains =
    item.member_kind === "reservation"
      ? ["events", "lodging", "board", "reservations", "meals"]
      : ["events", "lodging", "board", "meals"];
  const changedModules =
    item.member_kind === "reservation"
      ? ["events", "board", "reservations", "meals"]
      : ["events", "board", "meals"];
  return enrichWriteResponse(
    env,
    await finishWrite(
      env,
      {
        member_name: item.member_name,
        queue_id: queueId,
      },
      changedDomains,
      changedModules,
    ),
    {
      patchRowIds: {
        beds: item.suggested_bed_id ? [item.suggested_bed_id] : [],
        lodgers: assignedLodgerId ? [assignedLodgerId] : [],
        reservations:
          item.member_kind === "reservation" ? [item.member_ref_id] : [],
      },
      extraPatches: await roomingQueuePatches(env, queueId),
    },
  );
}

export async function logRoomingAdjustment(env, session, body) {
  await requirePermission(env, session, "lodging.checkin");
  const eventId = requireId(body.event_id, "营期");
  const kind = assertInSet(
    body.adjustment_kind || "其他",
    ADJUSTMENT_KINDS,
    "无效的调整类型",
  );
  const planId = parseInt(body.plan_id, 10) || null;
  const queueId = parseInt(body.queue_id, 10) || null;
  const lodgerId = parseInt(body.lodger_id, 10) || null;
  const fromBedId = parseInt(body.from_bed_id, 10) || null;
  const toBedId = parseInt(body.to_bed_id, 10) || null;
  const operator =
    text(body.operator) ||
    text(session?.display_name) ||
    text(session?.username) ||
    null;
  const meta = await runD1(
    env,
    `INSERT INTO rooming_adjustments
      (event_id, plan_id, queue_id, lodger_id, adjustment_kind, member_name,
       from_bed_id, to_bed_id, reason, operator)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      eventId,
      planId,
      queueId,
      lodgerId,
      kind,
      text(body.member_name),
      fromBedId,
      toBedId,
      text(body.reason),
      operator,
    ],
  );
  await insertAudit(
    env,
    "记录排房调整",
    "rooming_adjustments",
    eventId,
    { adjustment_kind: kind, member_name: text(body.member_name) },
    session,
  );
  return enrichWriteResponse(
    env,
    await finishWrite(env, {}, ["events"], ["events"]),
    { extraPatches: await roomingAdjustmentPatches(env, meta.last_row_id) },
  );
}

export async function getRoomingRetrospective(env, session, eventId) {
  await requirePermission(env, session, "lodging.read");
  const eventRows = await queryD1(env, "SELECT * FROM events WHERE id = ?", [
    eventId,
  ]);
  if (!eventRows.length) throw new Error("营期不存在");
  const plan = (
    await queryD1(
      env,
      "SELECT * FROM rooming_plans WHERE event_id = ? LIMIT 1",
      [eventId],
    )
  )[0];
  const queue = await getRoomingCheckinQueue(env, eventId);
  const adjustments = await queryD1(
    env,
    `SELECT a.*,
            fb.bed_number AS from_bed_number,
            fr.name AS from_room_name,
            fr.location AS from_room_location,
            tb.bed_number AS to_bed_number,
            tr.name AS to_room_name,
            tr.location AS to_room_location
     FROM rooming_adjustments a
     LEFT JOIN beds fb ON fb.id = a.from_bed_id
     LEFT JOIN rooms fr ON fr.id = fb.room_id
     LEFT JOIN beds tb ON tb.id = a.to_bed_id
     LEFT JOIN rooms tr ON tr.id = tb.room_id
     WHERE a.event_id = ?
     ORDER BY a.created_at DESC, a.id DESC`,
    [eventId],
  );
  const summary = {
    total: queue.length,
    pending: queue.filter(function (row) {
      return row.queue_status === "待办理";
    }).length,
    done: queue.filter(function (row) {
      return row.queue_status === "已办理";
    }).length,
    skipped: queue.filter(function (row) {
      return row.queue_status === "已跳过";
    }).length,
    adjustments: adjustments.length,
  };
  return {
    event: eventRows[0],
    plan: plan || null,
    queue: queue,
    adjustments: adjustments,
    summary: summary,
  };
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

  if (action === "process_queue") {
    return processRoomingQueueCheckin(env, session, body);
  }

  if (action === "log_adjustment") {
    return logRoomingAdjustment(env, session, body);
  }

  if (action === "retrospective") {
    if (!eventId) throw new Error("缺少营期");
    return getRoomingRetrospective(env, session, eventId);
  }

  throw new Error("未知 action: " + action);
}
