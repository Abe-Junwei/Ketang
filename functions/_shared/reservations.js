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

function buildReservationUpsertPatchRow(row, fields) {
  return {
    ...row,
    guest_id: fields.guestId,
    event_id: fields.eventId,
    name: fields.person.name,
    dharma_name: fields.person.dharma_name,
    gender: fields.gender,
    phone: fields.phone,
    id_card: fields.idCard,
    role: fields.role,
    class_name: fields.className,
    participant_identity: fields.participantIdentity,
    age_group: fields.ageGroup,
    special_needs: fields.specialNeeds,
    expected_check_in: fields.expectedCheckIn,
    expected_check_out: fields.expectedCheckOut,
    room_preference: fields.roomPreference,
    source: fields.source,
    notes: fields.notes,
    meal_breakfast: fields.mealBf,
    meal_lunch: fields.mealLc,
    meal_dinner: fields.mealDn,
  };
}

function buildReservationCreatePatchRow(id, fields) {
  return {
    id: id,
    guest_id: fields.guestId,
    event_id: fields.eventId,
    name: fields.person.name,
    dharma_name: fields.person.dharma_name,
    gender: fields.gender,
    phone: fields.phone,
    id_card: fields.idCard,
    role: fields.role,
    class_name: fields.className,
    participant_identity: fields.participantIdentity,
    age_group: fields.ageGroup,
    special_needs: fields.specialNeeds,
    expected_check_in: fields.expectedCheckIn,
    expected_check_out: fields.expectedCheckOut,
    room_preference: fields.roomPreference,
    source: fields.source,
    status: "预约",
    notes: fields.notes,
    meal_breakfast: fields.mealBf,
    meal_lunch: fields.mealLc,
    meal_dinner: fields.mealDn,
  };
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
  const tags = parseParticipantTagFields(body);
  const patchFields = {
    guestId,
    eventId: body.event_id || null,
    person,
    gender: body.gender,
    phone: identity.phone,
    idCard: identity.idCard,
    role: body.role || null,
    className: body.class_name || null,
    participantIdentity: tags.participant_identity,
    ageGroup: tags.age_group,
    specialNeeds: tags.special_needs,
    expectedCheckIn: body.expected_check_in,
    expectedCheckOut: checkOut,
    roomPreference: body.room_preference || null,
    source: body.source || null,
    notes: body.notes || null,
    mealBf,
    mealLc,
    mealDn,
  };

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
        patchRow: buildReservationUpsertPatchRow(row, patchFields),
        patchTable: "reservations",
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
      patchRow: buildReservationCreatePatchRow(meta.last_row_id, patchFields),
      patchTable: "reservations",
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
    {
      patchRow: { ...r, status: status },
      patchTable: "reservations",
      patchComplete: true,
    },
  );
}

export async function apiBatchEventMembers(env, session, body) {
  const action = body.action;
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) throw new Error("未选择成员");
  const today = new Date().toISOString().slice(0, 10);
  const statements = [];

  const patchRows = { reservations: [], beds: [], lodgers: [] };
  const lodgerCancelIds = [];
  const reservationIds = [];
  for (const item of items) {
    if (item.kind === "reservation") reservationIds.push(item.id);
    if (item.kind === "lodger" && action === "cancel") lodgerCancelIds.push(item.id);
  }
  const reservationById = {};
  if (reservationIds.length) {
    const placeholders = reservationIds
      .map(function () {
        return "?";
      })
      .join(",");
    const rows = await queryD1(
      env,
      `SELECT * FROM reservations WHERE id IN (${placeholders})`,
      reservationIds,
    );
    rows.forEach(function (row) {
      reservationById[row.id] = row;
    });
  }
  for (const item of items) {
    if (item.kind === "reservation") {
      const row = reservationById[item.id];
      if (!row) continue;
      if (action === "cancel") {
        if (["已取消", "已入住"].includes(row.status)) continue;
        patchRows.reservations.push({ ...row, status: "已取消" });
        statements.push({
          sql: "UPDATE reservations SET status='已取消' WHERE id=? AND status NOT IN ('已取消','已入住')",
          params: [item.id],
        });
      }
      if (action === "noshow") {
        if (["已入住", "No-show", "已取消"].includes(row.status)) continue;
        patchRows.reservations.push({ ...row, status: "No-show" });
        statements.push({
          sql: "UPDATE reservations SET status='No-show' WHERE id=? AND status NOT IN ('已入住','No-show','已取消')",
          params: [item.id],
        });
      }
      continue;
    }
  }
  // One query for all bed_ids instead of N | Batch bed lookup
  const bedByLodger = {};
  const lodgerById = {};
  if (lodgerCancelIds.length) {
    const placeholders = lodgerCancelIds
      .map(function () {
        return "?";
      })
      .join(",");
    const rows = await queryD1(
      env,
      `SELECT * FROM lodgers WHERE id IN (${placeholders}) AND status='在住'`,
      lodgerCancelIds,
    );
    rows.forEach(function (row) {
      bedByLodger[row.id] = row.bed_id;
      lodgerById[row.id] = row;
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
    const lodger = lodgerById[lodgerId];
    if (!lodger) return;
    patchRows.lodgers.push({
      ...lodger,
      status: "已取消",
      bed_id: null,
      actual_check_out: today,
    });
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
      patchRows.beds.push({ id: bedId, status: "可用" });
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
  const bedIds = patchRows.beds.map(function (bed) {
    return bed.id;
  });
  const housekeepingPatches = bedIds.length
    ? await fetchLatestHousekeepingPatches(env, bedIds)
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
      patchRows: patchRows,
      deletions: mealDeletions,
      extraPatches: { housekeeping: housekeepingPatches },
      patchComplete: true,
    },
  );
}
