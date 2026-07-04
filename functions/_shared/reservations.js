import { batchD1, insertAudit, queryD1, runD1 } from "./d1.js";
import {
  finishWrite,
  enrichWriteResponse,
  fetchLatestHousekeepingPatches,
  fetchMealDeletionsForLodgers,
} from "./write-response.js";
import { parsePersonNameInput } from "./person.js";
import { assertGuestIdentityFields, normalizePhone } from "./validation.js";
import { parseParticipantTagFields } from "./rooming-tags.js";
import { nowIso } from "./sync-timestamp.js";

function participantTagValues(body) {
  const tags = parseParticipantTagFields(body);
  return [tags.participant_identity, tags.age_group, tags.special_needs];
}

async function findOrCreateGuest(env, displayName, gender, phone, idCard) {
  const person = parsePersonNameInput(displayName);
  if (!person.name) return null;
  let guest = null;
  if (phone || idCard) {
    const conds = [];
    const params = [];
    if (phone) {
      conds.push("phone = ?");
      params.push(phone);
    }
    if (idCard) {
      conds.push("id_card = ?");
      params.push(idCard);
    }
    const rows = await queryD1(
      env,
      `SELECT * FROM guests WHERE ${conds.join(" OR ")} LIMIT 1`,
      params,
    );
    guest = rows[0] || null;
  }
  if (!guest) {
    const rows = await queryD1(
      env,
      "SELECT * FROM guests WHERE name = ? LIMIT 1",
      [person.name],
    );
    guest = rows[0] || null;
  }
  if (guest) return guest.id;
  const meta = await runD1(
    env,
    "INSERT INTO guests (name, dharma_name, gender, phone, id_card, visit_count, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?)",
    [
      person.name,
      null,
      gender || null,
      phone || null,
      idCard || null,
      nowIso(),
    ],
  );
  return meta.last_row_id;
}

export async function apiUpsertReservation(env, session, body) {
  const person = parsePersonNameInput(body.name);
  if (!person.name) throw new Error("请填写姓名");
  if (!body.gender || !body.expected_check_in)
    throw new Error("请填写性别和预计入住日期");
  const checkOut = body.expected_check_out || null;
  if (checkOut && checkOut < body.expected_check_in)
    throw new Error("预离日期不能早于入住日期");
  const identity = assertGuestIdentityFields(body);
  const guestId =
    body.guest_id ||
    (await findOrCreateGuest(
      env,
      person.name,
      body.gender,
      identity.phone,
      identity.idCard,
    ));
  if (body.emergency_name || body.emergency_phone) {
    await runD1(
      env,
      "UPDATE guests SET emergency_contact = COALESCE(?, emergency_contact), emergency_phone = COALESCE(?, emergency_phone), updated_at = ? WHERE id = ?",
      [
        body.emergency_name || null,
        normalizePhone(body.emergency_phone),
        nowIso(),
        guestId,
      ],
    );
  }
  const mealBf = body.meal_breakfast ? 1 : 0;
  const mealLc = body.meal_lunch ? 1 : 0;
  const mealDn = body.meal_dinner ? 1 : 0;
  const resvId = parseInt(body.reservation_id, 10);

  if (resvId) {
    const existing = await queryD1(
      env,
      "SELECT * FROM reservations WHERE id=?",
      [resvId],
    );
    const row = existing[0];
    if (!row) throw new Error("预约记录不存在");
    if (row.status === "已入住" || row.status === "已取消")
      throw new Error("已入住或已取消的预约不可编辑");
    await runD1(
      env,
      `UPDATE reservations SET
      guest_id=?, event_id=?, name=?, dharma_name=?, gender=?, phone=?, id_card=?,
      role=?, class_name=?, participant_identity=?, age_group=?, special_needs=?,
      expected_check_in=?, expected_check_out=?,
      room_preference=?, source=?, notes=?, meal_breakfast=?, meal_lunch=?, meal_dinner=?
      WHERE id=?`,
      [
        guestId,
        body.event_id || null,
        person.name,
        person.dharma_name,
        body.gender,
        identity.phone,
        identity.idCard,
        body.role || null,
        body.class_name || null,
        ...participantTagValues(body),
        body.expected_check_in,
        checkOut,
        body.room_preference || null,
        body.source || null,
        body.notes || null,
        mealBf,
        mealLc,
        mealDn,
        resvId,
      ],
    );
    await insertAudit(
      env,
      "更新预约",
      "reservation",
      resvId,
      { guest_id: guestId, name: person.name },
      session,
    );
    return enrichWriteResponse(
      env,
      await finishWrite(
        env,
        { reservation_id: resvId },
        ["reservations"],
        ["reservations"],
      ),
      {
        patchRowIds: {
          reservations: [resvId],
          guests: guestId ? [guestId] : [],
        },
        patchComplete: true,
      },
    );
  }

  const meta = await runD1(
    env,
    `INSERT INTO reservations
    (guest_id, event_id, name, dharma_name, gender, phone, id_card, role, class_name, participant_identity, age_group, special_needs, expected_check_in, expected_check_out, room_preference, source, status, notes, meal_breakfast, meal_lunch, meal_dinner)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '预约', ?, ?, ?, ?)`,
    [
      guestId,
      body.event_id || null,
      person.name,
      person.dharma_name,
      body.gender,
      identity.phone,
      identity.idCard,
      body.role || null,
      body.class_name || null,
      ...participantTagValues(body),
      body.expected_check_in,
      checkOut,
      body.room_preference || null,
      body.source || null,
      body.notes || null,
      mealBf,
      mealLc,
      mealDn,
    ],
  );
  await insertAudit(
    env,
    "添加预约",
    "reservation",
    meta.last_row_id,
    { guest_id: guestId, name: person.name },
    session,
  );
  return enrichWriteResponse(
    env,
    await finishWrite(
      env,
      { reservation_id: meta.last_row_id },
      ["reservations"],
      ["reservations"],
    ),
    {
      patchRowIds: {
        reservations: [meta.last_row_id],
        guests: guestId ? [guestId] : [],
      },
      patchComplete: true,
    },
  );
}

export async function apiUpdateReservationStatus(env, session, body) {
  const id = parseInt(body.reservation_id, 10);
  const status = body.status;
  const rows = await queryD1(env, "SELECT * FROM reservations WHERE id=?", [
    id,
  ]);
  const r = rows[0];
  if (!r) throw new Error("预约不存在");
  await runD1(env, "UPDATE reservations SET status=? WHERE id=?", [status, id]);
  await insertAudit(
    env,
    "更新预约状态",
    "reservation",
    id,
    { name: r.name, from: r.status, to: status },
    session,
  );
  return enrichWriteResponse(
    env,
    await finishWrite(env, {}, ["reservations"], ["reservations"]),
    { patchTable: "reservations", rowId: id, patchComplete: true },
  );
}

export async function apiBatchEventMembers(env, session, body) {
  const action = body.action;
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) throw new Error("未选择成员");
  const today = new Date().toISOString().slice(0, 10);
  const statements = [];

  const patchRowIds = { reservations: [], beds: [], lodgers: [] };
  const lodgerCancelIds = [];
  for (const item of items) {
    if (item.kind === "reservation") {
      patchRowIds.reservations.push(item.id);
      if (action === "cancel")
        statements.push({
          sql: "UPDATE reservations SET status='已取消' WHERE id=? AND status NOT IN ('已取消','已入住')",
          params: [item.id],
        });
      if (action === "noshow")
        statements.push({
          sql: "UPDATE reservations SET status='No-show' WHERE id=? AND status NOT IN ('已入住','No-show','已取消')",
          params: [item.id],
        });
      continue;
    }
    if (item.kind === "lodger" && action === "cancel") {
      lodgerCancelIds.push(item.id);
    }
  }
  // One query for all bed_ids instead of N | Batch bed lookup
  const bedByLodger = {};
  if (lodgerCancelIds.length) {
    const placeholders = lodgerCancelIds
      .map(function () {
        return "?";
      })
      .join(",");
    const rows = await queryD1(
      env,
      `SELECT id, bed_id FROM lodgers WHERE id IN (${placeholders}) AND status='在住'`,
      lodgerCancelIds,
    );
    rows.forEach(function (row) {
      bedByLodger[row.id] = row.bed_id;
    });
  }
  const activeLodgerIds = Object.keys(bedByLodger).map(function (id) {
    return parseInt(id, 10);
  });
  const mealDeletions = await fetchMealDeletionsForLodgers(
    env,
    activeLodgerIds,
    today,
  );
  activeLodgerIds.forEach(function (lodgerId) {
    patchRowIds.lodgers.push(lodgerId);
    const bedId = bedByLodger[lodgerId];
    statements.push({
      sql: "UPDATE lodgers SET status='已取消', bed_id=NULL, actual_check_out=? WHERE id=? AND status='在住'",
      params: [today, lodgerId],
    });
    statements.push({
      sql: "DELETE FROM meals WHERE lodger_id=? AND date>?",
      params: [lodgerId, today],
    });
    if (bedId) {
      patchRowIds.beds.push(bedId);
      statements.push({
        sql: "UPDATE beds SET status='可用' WHERE id=?",
        params: [bedId],
      });
      statements.push({
        sql: "INSERT INTO housekeeping (bed_id, status, operator, notes) VALUES (?, ?, ?, ?)",
        params: [bedId, "脏房", session.username, "批量取消挂单释放床位"],
      });
    }
  });

  if (!statements.length) throw new Error("没有可执行的变更");
  await batchD1(env, statements);
  await insertAudit(
    env,
    action === "noshow" ? "批量标记 No-show" : "批量取消成员",
    "event",
    body.event_id || null,
    { count: items.length },
    session,
  );
  const housekeepingPatches = patchRowIds.beds.length
    ? await fetchLatestHousekeepingPatches(env, patchRowIds.beds)
    : [];
  return enrichWriteResponse(
    env,
    await finishWrite(
      env,
      { count: items.length },
      ["reservations", "lodging", "meals"],
      ["reservations", "board", "lodgers_active", "meals"],
    ),
    {
      patchRowIds: patchRowIds,
      deletions: mealDeletions,
      extraPatches: { housekeeping: housekeepingPatches },
      patchComplete: true,
    },
  );
}
