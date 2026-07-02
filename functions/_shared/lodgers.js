import {
  batchD1,
  bumpBoardVersion,
  insertAudit,
  queryD1,
  runD1,
} from "./d1.js";
import { parsePersonNameInput, mergePersonNameFields } from "./person.js";

function dormMatchGender(dormType, gender) {
  if (!dormType || dormType === "不限") return true;
  if (!gender) return true;
  if (dormType === "男寮" && !["男", "男众"].includes(gender)) return false;
  if (dormType === "女寮" && !["女", "女众"].includes(gender)) return false;
  return true;
}

function formatDateAddDays(isoDate, days) {
  const cur = new Date(isoDate + "T12:00:00");
  cur.setDate(cur.getDate() + days);
  return cur.toISOString().slice(0, 10);
}

function stayDateRange(startDate, endDate) {
  if (!startDate) return [];
  const dates = [];
  let cur = new Date(startDate + "T12:00:00");
  if (Number.isNaN(cur.getTime())) return [];
  let last = endDate ? new Date(endDate + "T12:00:00") : new Date(cur);
  if (endDate && Number.isNaN(last.getTime())) last = new Date(cur);
  if (!endDate) last.setDate(last.getDate() + 6);
  let safety = 0;
  while (cur <= last && safety < 366) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
    safety++;
  }
  return dates;
}

async function getHouseStatus(env, bedId) {
  const rows = await queryD1(
    env,
    "SELECT status FROM housekeeping WHERE bed_id = ? ORDER BY changed_at DESC LIMIT 1",
    [bedId],
  );
  return rows[0]?.status || "净房";
}

async function isBedAssignable(env, bedId, excludeLodgerId) {
  const beds = await queryD1(env, "SELECT * FROM beds WHERE id = ?", [bedId]);
  const bed = beds[0];
  if (!bed || bed.status === "维修" || bed.status === "备用") return false;
  const occ = await queryD1(
    env,
    "SELECT COUNT(*) AS c FROM lodgers WHERE bed_id = ? AND status = '在住' AND (? IS NULL OR id != ?)",
    [bedId, excludeLodgerId || null, excludeLodgerId || null],
  );
  if ((occ[0]?.c || 0) > 0) return false;
  const hk = await getHouseStatus(env, bedId);
  return hk === "净房" || hk === "可用";
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
  const now = new Date().toISOString();
  if (guest) {
    const updates = [];
    const params = [];
    if (gender && !guest.gender) {
      updates.push("gender = ?");
      params.push(gender);
    }
    if (phone && !guest.phone) {
      updates.push("phone = ?");
      params.push(phone);
    }
    if (idCard && !guest.id_card) {
      updates.push("id_card = ?");
      params.push(idCard);
    }
    if (updates.length) {
      params.push(now, guest.id);
      await runD1(
        env,
        `UPDATE guests SET ${updates.join(", ")}, updated_at = ? WHERE id = ?`,
        params,
      );
    }
    return guest.id;
  }
  const meta = await runD1(
    env,
    "INSERT INTO guests (name, dharma_name, gender, phone, id_card, visit_count, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?)",
    [person.name, null, gender || null, phone || null, idCard || null, now],
  );
  return meta.last_row_id;
}

async function incrementGuestVisit(env, guestId, visitDate) {
  const today = visitDate || new Date().toISOString().slice(0, 10);
  await runD1(
    env,
    "UPDATE guests SET visit_count = visit_count + 1, last_visit_date = ?, updated_at = ? WHERE id = ?",
    [today, new Date().toISOString(), guestId],
  );
}

function mealStatements(
  lodgerId,
  startDate,
  endDate,
  breakfast,
  lunch,
  dinner,
) {
  const bf = breakfast ? 1 : 0;
  const lc = lunch ? 1 : 0;
  const dn = dinner ? 1 : 0;
  return stayDateRange(startDate, endDate).map((date) => ({
    sql: "INSERT OR IGNORE INTO meals (lodger_id, date, breakfast, lunch, dinner) VALUES (?, ?, ?, ?, ?)",
    params: [lodgerId, date, bf, lc, dn],
  }));
}

async function assertBedForGender(env, bedId, gender) {
  const rows = await queryD1(
    env,
    "SELECT b.*, r.dorm_type FROM beds b JOIN rooms r ON r.id = b.room_id WHERE b.id = ?",
    [bedId],
  );
  const bed = rows[0];
  if (!bed) throw new Error("床位不存在");
  if (!dormMatchGender(bed.dorm_type, gender))
    throw new Error("该床位所在房间寮类型不符");
  return bed;
}

async function resolveLodgerId(env, guestId, bedId) {
  const rows = await queryD1(
    env,
    "SELECT id FROM lodgers WHERE guest_id = ? AND bed_id = ? AND status = '在住' ORDER BY id DESC LIMIT 1",
    [guestId, bedId],
  );
  return rows[0]?.id || null;
}

export async function apiCheckIn(env, session, body) {
  const bedId = parseInt(body.bed_id, 10);
  if (!bedId) throw new Error("请选择床位");
  const gender = body.gender || null;
  await assertBedForGender(env, bedId, gender);
  if (!(await isBedAssignable(env, bedId)))
    throw new Error("该床位当前不可分配");

  const checkIn = body.check_in_date;
  const checkOut = body.expected_check_out || null;
  if (!checkIn) throw new Error("请填写入住日期");
  if (checkOut && checkOut < checkIn)
    throw new Error("预离日期不能早于入住日期");

  const person = parsePersonNameInput(body.name);
  if (!person.name) throw new Error("请填写姓名");

  const phone = body.phone ? String(body.phone).replace(/\s/g, "") : null;
  const guestId = await findOrCreateGuest(
    env,
    person.name,
    gender,
    phone,
    body.id_card || null,
  );
  await incrementGuestVisit(env, guestId, checkIn);

  const mealBf = body.meal_breakfast ? 1 : 0;
  const mealLc = body.meal_lunch ? 1 : 0;
  const mealDn = body.meal_dinner ? 1 : 0;
  const deposit = parseFloat(body.deposit) || 0;
  const roomFee = parseFloat(body.room_fee) || 0;
  const payMethod = body.pay_method || null;
  const payRemark = body.pay_remark || null;

  if (body.reservation_id) {
    const resvRows = await queryD1(
      env,
      "SELECT status FROM reservations WHERE id = ?",
      [body.reservation_id],
    );
    const resv = resvRows[0];
    if (!resv || !["预约", "已确认"].includes(resv.status))
      throw new Error("该预约状态已变更，请刷新后重试");
  }

  const statements = [];
  if (body.emergency_name || body.emergency_phone) {
    statements.push({
      sql: "UPDATE guests SET emergency_contact = COALESCE(?, emergency_contact), emergency_phone = COALESCE(?, emergency_phone), updated_at = ? WHERE id = ?",
      params: [
        body.emergency_name || null,
        body.emergency_phone || null,
        new Date().toISOString(),
        guestId,
      ],
    });
  }
  statements.push({
    sql: `INSERT INTO lodgers (guest_id, event_id, name, dharma_name, gender, phone, id_card, check_in_date, expected_check_out, bed_id, role, class_name, status, source, notes, meal_default_breakfast, meal_default_lunch, meal_default_dinner)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '在住', ?, ?, ?, ?, ?)`,
    params: [
      guestId,
      body.event_id || null,
      person.name,
      person.dharma_name,
      gender,
      phone,
      body.id_card || null,
      checkIn,
      checkOut,
      bedId,
      body.role || null,
      body.class_name || null,
      body.source || null,
      body.notes || null,
      mealBf,
      mealLc,
      mealDn,
    ],
  });
  statements.push({
    sql: "UPDATE beds SET status='占用' WHERE id = ?",
    params: [bedId],
  });
  statements.push({
    sql: "INSERT INTO housekeeping (bed_id, status, operator, notes) VALUES (?, ?, ?, ?)",
    params: [bedId, "占用", session.username, "办理入住"],
  });
  if (body.reservation_id) {
    statements.push({
      sql: "UPDATE reservations SET status='已入住' WHERE id = ?",
      params: [body.reservation_id],
    });
  }
  await batchD1(env, statements);

  const finalLodgerId = await resolveLodgerId(env, guestId, bedId);
  if (!finalLodgerId) throw new Error("入住登记失败，请重试");

  const tailBatch = [
    ...mealStatements(finalLodgerId, checkIn, checkOut, mealBf, mealLc, mealDn),
  ];
  if (deposit > 0)
    tailBatch.push({
      sql: "INSERT INTO payments (lodger_id, type, amount, method, remark) VALUES (?, '押金', ?, ?, ?)",
      params: [finalLodgerId, deposit, payMethod, payRemark],
    });
  if (roomFee > 0)
    tailBatch.push({
      sql: "INSERT INTO payments (lodger_id, type, amount, method, remark) VALUES (?, '房费', ?, ?, ?)",
      params: [finalLodgerId, roomFee, payMethod, payRemark],
    });
  if (tailBatch.length) await batchD1(env, tailBatch);

  await insertAudit(
    env,
    "入住登记",
    "lodger",
    finalLodgerId,
    { guest_id: guestId, bed_id: bedId, name: person.name },
    session,
  );
  if (deposit > 0 || roomFee > 0) {
    await insertAudit(
      env,
      "收款",
      "lodger",
      finalLodgerId,
      {
        guest_id: guestId,
        name: person.name,
        deposit,
        room_fee: roomFee,
        method: payMethod,
      },
      session,
    );
  }
  if (body.reservation_id)
    await insertAudit(
      env,
      "预约转入住",
      "reservation",
      body.reservation_id,
      { lodger_id: finalLodgerId },
      session,
    );
  await bumpBoardVersion(env);
  return { lodger_id: finalLodgerId };
}

export async function apiCheckout(env, session, body) {
  const id = parseInt(body.lodger_id, 10);
  const refund = parseFloat(body.refund) || 0;
  if (refund < 0) throw new Error("退款金额不能为负数");
  const rows = await queryD1(
    env,
    "SELECT bed_id, guest_id, name FROM lodgers WHERE id = ? AND status = ?",
    [id, "在住"],
  );
  const l = rows[0];
  if (!l) throw new Error("挂单不存在或已退房");
  const paid = await queryD1(
    env,
    "SELECT COALESCE(SUM(CASE WHEN type IN ('押金','房费') THEN amount ELSE 0 END), 0) AS income, COALESCE(SUM(CASE WHEN type = '退款' THEN amount ELSE 0 END), 0) AS refund_total FROM payments WHERE lodger_id = ?",
    [id],
  );
  const balance = (paid[0]?.income || 0) - (paid[0]?.refund_total || 0);
  if (refund > balance)
    throw new Error(`退款金额不能超过余额 ${balance.toFixed(2)}`);

  const today = new Date().toISOString().slice(0, 10);
  const statements = [
    {
      sql: "UPDATE lodgers SET status='已退', actual_check_out=?, bed_id=NULL WHERE id=?",
      params: [today, id],
    },
  ];
  if (l.bed_id) {
    statements.push({
      sql: "UPDATE beds SET status='可用' WHERE id=?",
      params: [l.bed_id],
    });
    statements.push({
      sql: "INSERT INTO housekeeping (bed_id, status, operator, notes) VALUES (?, ?, ?, ?)",
      params: [l.bed_id, "脏房", session.username, body.notes || "办理退房"],
    });
  }
  if (refund > 0) {
    statements.push({
      sql: "INSERT INTO payments (lodger_id, type, amount, method, remark) VALUES (?, '退款', ?, ?, ?)",
      params: [id, refund, body.refund_method || null, body.notes || null],
    });
  } else {
    statements.push({
      sql: "INSERT INTO payments (lodger_id, type, amount, method, remark) VALUES (?, '退款', 0, ?, ?)",
      params: [id, body.refund_method || null, "退房结算（无退款）"],
    });
  }
  await batchD1(env, statements);
  await insertAudit(
    env,
    "退房",
    "lodger",
    id,
    { guest_id: l.guest_id, bed_id: l.bed_id, refund, name: l.name },
    session,
  );
  if (refund > 0)
    await insertAudit(
      env,
      "退款",
      "lodger",
      id,
      {
        guest_id: l.guest_id,
        name: l.name,
        refund,
        method: body.refund_method,
      },
      session,
    );
  await bumpBoardVersion(env);
  return { ok: true };
}

export async function apiChangeBed(env, session, body) {
  const lodgerId = parseInt(body.lodger_id, 10);
  const bedId = parseInt(body.bed_id, 10);
  if (!bedId) throw new Error("请选择新床位");
  const lodgers = await queryD1(
    env,
    "SELECT * FROM lodgers WHERE id = ? AND status = '在住'",
    [lodgerId],
  );
  const l = lodgers[0];
  if (!l) throw new Error("挂单不存在或已不在住");
  await assertBedForGender(env, bedId, l.gender);
  if (!(await isBedAssignable(env, bedId, lodgerId)))
    throw new Error("该床位当前不可分配");

  const statements = [
    {
      sql: "UPDATE lodgers SET bed_id=? WHERE id=? AND status='在住'",
      params: [bedId, lodgerId],
    },
  ];
  if (l.bed_id) {
    statements.push({
      sql: "UPDATE beds SET status='可用' WHERE id=?",
      params: [l.bed_id],
    });
    statements.push({
      sql: "INSERT INTO housekeeping (bed_id, status, operator, notes) VALUES (?, ?, ?, ?)",
      params: [l.bed_id, "脏房", session.username, "换床释放旧床位"],
    });
  }
  statements.push({
    sql: "UPDATE beds SET status='占用' WHERE id=?",
    params: [bedId],
  });
  statements.push({
    sql: "INSERT INTO housekeeping (bed_id, status, operator, notes) VALUES (?, ?, ?, ?)",
    params: [bedId, "占用", session.username, "换床占用新床位"],
  });
  await batchD1(env, statements);
  await insertAudit(
    env,
    "换床",
    "lodger",
    lodgerId,
    {
      guest_id: l.guest_id,
      old_bed_id: l.bed_id,
      new_bed_id: bedId,
      name: l.name,
    },
    session,
  );
  await bumpBoardVersion(env);
  return { ok: true };
}

export async function apiExtendStay(env, session, body) {
  const id = parseInt(body.lodger_id, 10);
  const date = body.expected_check_out;
  if (!date) throw new Error("请选择新的预离日期");
  const rows = await queryD1(
    env,
    "SELECT * FROM lodgers WHERE id=? AND status='在住'",
    [id],
  );
  const l = rows[0];
  if (!l) throw new Error("挂单不存在或已不在住");
  if (date < l.check_in_date) throw new Error("预离日期不能早于入住日期");

  await batchD1(env, [
    {
      sql: "UPDATE lodgers SET expected_check_out=? WHERE id=? AND status='在住'",
      params: [date, id],
    },
    {
      sql: "DELETE FROM meals WHERE lodger_id=? AND date>?",
      params: [id, date],
    },
  ]);

  const existing = await queryD1(
    env,
    "SELECT date FROM meals WHERE lodger_id=? ORDER BY date DESC LIMIT 1",
    [id],
  );
  const start = existing[0]?.date
    ? formatDateAddDays(existing[0].date, 1)
    : l.check_in_date;
  const mealStmts = mealStatements(
    id,
    start,
    date,
    l.meal_default_breakfast,
    l.meal_default_lunch,
    l.meal_default_dinner,
  );
  if (mealStmts.length) await batchD1(env, mealStmts);

  await insertAudit(
    env,
    "续住",
    "lodger",
    id,
    { guest_id: l.guest_id, name: l.name, new_check_out: date },
    session,
  );
  await bumpBoardVersion(env);
  return { ok: true };
}

export async function apiAssignBed(env, session, body) {
  const lodgerId = parseInt(body.lodger_id, 10);
  const bedId = parseInt(body.bed_id, 10);
  const rows = await queryD1(
    env,
    "SELECT * FROM lodgers WHERE id=? AND status='在住'",
    [lodgerId],
  );
  const l = rows[0];
  if (!l) throw new Error("挂单不存在或已不在住");
  if (l.bed_id) throw new Error("该挂单已有床位");
  await assertBedForGender(env, bedId, l.gender);
  if (!(await isBedAssignable(env, bedId)))
    throw new Error("该床位当前不可分配");
  await batchD1(env, [
    {
      sql: "UPDATE lodgers SET bed_id=? WHERE id=? AND status='在住'",
      params: [bedId, lodgerId],
    },
    { sql: "UPDATE beds SET status='占用' WHERE id=?", params: [bedId] },
    {
      sql: "INSERT INTO housekeeping (bed_id, status, operator, notes) VALUES (?, ?, ?, ?)",
      params: [bedId, "占用", session.username, "分配床位"],
    },
  ]);
  const mealStmts = mealStatements(
    lodgerId,
    l.check_in_date,
    l.expected_check_out,
    l.meal_default_breakfast,
    l.meal_default_lunch,
    l.meal_default_dinner,
  );
  const count = await queryD1(
    env,
    "SELECT COUNT(*) AS c FROM meals WHERE lodger_id=?",
    [lodgerId],
  );
  if ((count[0]?.c || 0) === 0 && mealStmts.length)
    await batchD1(env, mealStmts);
  await insertAudit(
    env,
    "分配床位",
    "lodger",
    lodgerId,
    { guest_id: l.guest_id, bed_id: bedId, name: l.name },
    session,
  );
  await bumpBoardVersion(env);
  return { ok: true };
}

export async function apiAssignReservationToBed(env, session, body) {
  const resvId = parseInt(body.reservation_id, 10);
  const bedId = parseInt(body.bed_id, 10);
  const rRows = await queryD1(env, "SELECT * FROM reservations WHERE id=?", [
    resvId,
  ]);
  const r = rRows[0];
  if (!r || !["预约", "已确认"].includes(r.status))
    throw new Error("该预约当前不可分配床位");
  await assertBedForGender(env, bedId, r.gender);
  if (!(await isBedAssignable(env, bedId)))
    throw new Error("该床位当前不可分配");
  const checkIn = r.expected_check_in || new Date().toISOString().slice(0, 10);
  const checkOut = r.expected_check_out || null;
  if (checkOut && checkOut < checkIn)
    throw new Error("预约离院日期不能早于入住日期");
  const person = mergePersonNameFields(r.name, r.dharma_name);
  const guestId =
    r.guest_id ||
    (await findOrCreateGuest(env, person.name, r.gender, r.phone, r.id_card));
  await incrementGuestVisit(env, guestId, checkIn);
  const mf = {
    breakfast: r.meal_breakfast,
    lunch: r.meal_lunch,
    dinner: r.meal_dinner,
  };
  await batchD1(env, [
    {
      sql: `INSERT INTO lodgers (guest_id, event_id, name, dharma_name, gender, phone, id_card, check_in_date, expected_check_out, bed_id, role, class_name, status, source, notes, meal_default_breakfast, meal_default_lunch, meal_default_dinner)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '在住', ?, ?, ?, ?, ?)`,
      params: [
        guestId,
        r.event_id || null,
        person.name,
        person.dharma_name,
        r.gender || null,
        r.phone || null,
        r.id_card || null,
        checkIn,
        checkOut,
        bedId,
        r.role || null,
        r.class_name || null,
        r.source || "预约分配",
        r.notes || null,
        mf.breakfast ? 1 : 0,
        mf.lunch ? 1 : 0,
        mf.dinner ? 1 : 0,
      ],
    },
    { sql: "UPDATE beds SET status='占用' WHERE id=?", params: [bedId] },
    {
      sql: "INSERT INTO housekeeping (bed_id, status, operator, notes) VALUES (?, ?, ?, ?)",
      params: [bedId, "占用", session.username, "预约分配床位"],
    },
    {
      sql: "UPDATE reservations SET status='已入住' WHERE id=?",
      params: [resvId],
    },
  ]);
  const lodgerId = await resolveLodgerId(env, guestId, bedId);
  if (!lodgerId) throw new Error("预约分配床位失败，请重试");
  const mealStmts = mealStatements(
    lodgerId,
    checkIn,
    checkOut,
    mf.breakfast,
    mf.lunch,
    mf.dinner,
  );
  if (mealStmts.length) await batchD1(env, mealStmts);
  await insertAudit(
    env,
    "预约分配床位",
    "lodger",
    lodgerId,
    { guest_id: guestId, bed_id: bedId, reservation_id: resvId, name: r.name },
    session,
  );
  await insertAudit(
    env,
    "预约转入住",
    "reservation",
    resvId,
    { lodger_id: lodgerId },
    session,
  );
  await bumpBoardVersion(env);
  return { lodger_id: lodgerId };
}

export async function apiEditLodger(env, session, body) {
  const id = parseInt(body.lodger_id, 10);
  const person = parsePersonNameInput(body.name);
  if (!person.name) throw new Error("请填写姓名");
  const rows = await queryD1(
    env,
    "SELECT * FROM lodgers WHERE id=? AND status='在住'",
    [id],
  );
  const l = rows[0];
  if (!l) throw new Error("挂单不存在或已不在住");
  const checkIn = body.check_in_date;
  const checkOut = body.expected_check_out || null;
  if (checkOut && checkOut < checkIn)
    throw new Error("预离日期不能早于入住日期");

  await runD1(
    env,
    `UPDATE lodgers SET name=?, dharma_name=?, gender=?, phone=?, id_card=?, check_in_date=?, expected_check_out=?, role=?, class_name=?, event_id=?, notes=? WHERE id=?`,
    [
      person.name,
      person.dharma_name,
      body.gender || null,
      body.phone || null,
      body.id_card || null,
      checkIn,
      checkOut,
      body.role || null,
      body.class_name || null,
      body.event_id || null,
      body.notes || null,
      id,
    ],
  );
  if (l.guest_id) {
    await runD1(
      env,
      "UPDATE guests SET name=?, dharma_name=?, gender=?, phone=?, id_card=?, updated_at=? WHERE id=?",
      [
        person.name,
        person.dharma_name,
        body.gender || null,
        body.phone || null,
        body.id_card || null,
        new Date().toISOString(),
        l.guest_id,
      ],
    );
  }

  const existingRows = await queryD1(
    env,
    "SELECT * FROM meals WHERE lodger_id=?",
    [id],
  );
  const existing = {};
  existingRows.forEach((m) => {
    existing[m.date] = m;
  });
  await runD1(env, "DELETE FROM meals WHERE lodger_id=?", [id]);
  const defaults = {
    breakfast: l.meal_default_breakfast,
    lunch: l.meal_default_lunch,
    dinner: l.meal_default_dinner,
  };
  const mealStmts = stayDateRange(checkIn, checkOut).map((d) => {
    const m = existing[d] || defaults;
    return {
      sql: "INSERT INTO meals (lodger_id, date, breakfast, lunch, dinner) VALUES (?, ?, ?, ?, ?)",
      params: [id, d, m.breakfast ? 1 : 0, m.lunch ? 1 : 0, m.dinner ? 1 : 0],
    };
  });
  if (mealStmts.length) await batchD1(env, mealStmts);

  await insertAudit(
    env,
    "编辑挂单",
    "lodger",
    id,
    { guest_id: l.guest_id, name: person.name },
    session,
  );
  await bumpBoardVersion(env);
  return { ok: true };
}

export async function apiDeleteLodger(env, session, body) {
  const id = parseInt(body.lodger_id, 10);
  const rows = await queryD1(env, "SELECT * FROM lodgers WHERE id=?", [id]);
  const l = rows[0];
  if (!l) throw new Error("挂单不存在");
  const statements = [
    { sql: "DELETE FROM meals WHERE lodger_id=?", params: [id] },
    { sql: "DELETE FROM payments WHERE lodger_id=?", params: [id] },
    { sql: "DELETE FROM lodgers WHERE id=?", params: [id] },
  ];
  if (l.bed_id) {
    statements.push({
      sql: "UPDATE beds SET status='可用' WHERE id=?",
      params: [l.bed_id],
    });
    statements.push({
      sql: "INSERT INTO housekeeping (bed_id, status, operator, notes) VALUES (?, ?, ?, ?)",
      params: [l.bed_id, "脏房", session.username, "删除挂单释放床位"],
    });
  }
  await batchD1(env, statements);
  await insertAudit(
    env,
    "删除挂单",
    "lodger",
    id,
    { guest_id: l.guest_id, name: l.name },
    session,
  );
  await bumpBoardVersion(env);
  return { ok: true };
}

export async function apiPublicReservation(env, body) {
  const person = parsePersonNameInput(body.name);
  if (!person.name) throw new Error("请填写姓名");
  if (!body.gender) throw new Error("请填写性别");
  const checkIn = body.expected_check_in;
  const checkOut = body.expected_check_out || null;
  if (!checkIn) throw new Error("请填写预计入住日期");
  if (checkOut && checkOut < checkIn)
    throw new Error("预离日期不能早于入住日期");
  const guestId = await findOrCreateGuest(
    env,
    person.name,
    body.gender,
    body.phone || null,
    body.id_card || null,
  );
  const meta = await runD1(
    env,
    `INSERT INTO reservations (guest_id, event_id, name, dharma_name, gender, phone, id_card, role, class_name, expected_check_in, expected_check_out, room_preference, source, status, meal_breakfast, meal_lunch, meal_dinner, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '预约', ?, ?, ?, ?)`,
    [
      guestId,
      body.event_id || null,
      person.name,
      person.dharma_name,
      body.gender,
      body.phone || null,
      body.id_card || null,
      body.role || null,
      body.class_name || null,
      checkIn,
      checkOut,
      body.room_preference || null,
      body.source || "线上预约",
      body.meal_breakfast != null ? (body.meal_breakfast ? 1 : 0) : 1,
      body.meal_lunch != null ? (body.meal_lunch ? 1 : 0) : 1,
      body.meal_dinner != null ? (body.meal_dinner ? 1 : 0) : 1,
      body.notes || null,
    ],
  );
  await bumpBoardVersion(env);
  return { reservation_id: meta.last_row_id };
}

async function findEventByName(env, name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return null;
  const rows = await queryD1(
    env,
    "SELECT id, name FROM events WHERE name = ? LIMIT 1",
    [trimmed],
  );
  return rows[0] || null;
}

async function findAssignableBed(env, gender, roomPreference) {
  const pref = String(roomPreference || "").trim();
  if (pref) {
    const exact = await queryD1(
      env,
      `SELECT b.id, b.room_id, b.bed_number, b.status, r.name AS room_name, r.dorm_type
       FROM beds b
       JOIN rooms r ON r.id = b.room_id
       LEFT JOIN lodgers l ON l.bed_id = b.id AND l.status = '在住'
       WHERE b.status NOT IN ('维修','备用') AND l.id IS NULL
         AND (r.name LIKE ? OR r.location LIKE ?)
       ORDER BY b.id
       LIMIT 40`,
      ["%" + pref + "%", "%" + pref + "%"],
    );
    for (const bed of exact) {
      if (!(await isBedAssignable(env, bed.id))) continue;
      if (!dormMatchGender(bed.dorm_type, gender)) continue;
      return bed;
    }
  }
  const beds = await queryD1(
    env,
    `SELECT b.id, b.room_id, b.bed_number, b.status, r.name AS room_name, r.dorm_type
     FROM beds b
     JOIN rooms r ON r.id = b.room_id
     LEFT JOIN lodgers l ON l.bed_id = b.id AND l.status = '在住'
     WHERE b.status NOT IN ('维修','备用') AND l.id IS NULL
     ORDER BY r.id, b.id`,
    [],
  );
  for (const bed of beds) {
    if (!(await isBedAssignable(env, bed.id))) continue;
    if (!dormMatchGender(bed.dorm_type, gender)) continue;
    return bed;
  }
  return null;
}

async function checkInBatchRow(env, session, row, mealDefaults) {
  const person = parsePersonNameInput(row.name);
  if (!person.name) throw new Error("姓名/性别缺失");
  if (!row.gender) throw new Error("姓名/性别缺失");

  const checkIn = row.check_in_date || mealDefaults.today;
  const checkOut = row.expected_check_out || null;
  if (checkOut && checkOut < checkIn)
    throw new Error("预离日期早于入住日期");

  const bed = await findAssignableBed(env, row.gender, row.room_preference);
  if (!bed) throw new Error("无可用床位");

  const evt = row.event_name
    ? await findEventByName(env, row.event_name)
    : null;
  const phone = row.phone ? String(row.phone).replace(/\s/g, "") : null;
  const guestId = await findOrCreateGuest(
    env,
    person.name,
    row.gender,
    phone,
    row.id_card || null,
  );
  await incrementGuestVisit(env, guestId, checkIn);

  const mealBf = mealDefaults.breakfast ? 1 : 0;
  const mealLc = mealDefaults.lunch ? 1 : 0;
  const mealDn = mealDefaults.dinner ? 1 : 0;

  const statements = [
    {
      sql: `INSERT INTO lodgers (guest_id, event_id, name, dharma_name, gender, phone, id_card, check_in_date, expected_check_out, bed_id, role, class_name, status, source, notes, meal_default_breakfast, meal_default_lunch, meal_default_dinner)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '在住', '法会批量导入', ?, ?, ?, ?)`,
      params: [
        guestId,
        evt ? evt.id : null,
        person.name,
        row.dharma_name || null,
        row.gender,
        phone,
        row.id_card || null,
        checkIn,
        checkOut,
        bed.id,
        row.role || null,
        row.class_name || null,
        row.notes || null,
        mealBf,
        mealLc,
        mealDn,
      ],
    },
    {
      sql: "UPDATE beds SET status='占用' WHERE id = ?",
      params: [bed.id],
    },
    {
      sql: "INSERT INTO housekeeping (bed_id, status, operator, notes) VALUES (?, ?, ?, ?)",
      params: [bed.id, "占用", session.username, "法会批量导入"],
    },
  ];
  await batchD1(env, statements);

  const lodgerId = await resolveLodgerId(env, guestId, bed.id);
  if (!lodgerId) throw new Error("写入失败，请重试");

  const mealStmts = mealStatements(
    lodgerId,
    checkIn,
    checkOut,
    mealBf,
    mealLc,
    mealDn,
  );
  if (mealStmts.length) await batchD1(env, mealStmts);

  await insertAudit(
    env,
    "批量导入入住",
    "lodger",
    lodgerId,
    { guest_id: guestId, bed_id: bed.id, name: person.name },
    session,
  );
  return { lodger_id: lodgerId, bed_id: bed.id };
}

/** CSV 批量入住 | Batch check-in from parsed CSV rows */
export async function apiBatchCheckIn(env, session, body) {
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) throw new Error("导入数据为空");
  if (rows.length > 100) throw new Error("单次最多导入 100 条");

  const mealDefaults = {
    breakfast: !!body.meal_breakfast,
    lunch: !!body.meal_lunch,
    dinner: !!body.meal_dinner,
    today: new Date().toISOString().slice(0, 10),
  };
  if (!mealDefaults.breakfast && !mealDefaults.lunch && !mealDefaults.dinner) {
    throw new Error("请至少选择一餐用斋");
  }

  let success = 0;
  const failed = [];
  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx] || {};
    try {
      await checkInBatchRow(env, session, row, mealDefaults);
      success++;
    } catch (error) {
      failed.push({
        line: idx + 2,
        name: row.name || "",
        error: error.message || String(error),
      });
    }
  }
  if (success > 0) await bumpBoardVersion(env);
  return { success: success, fail: failed.length, failed: failed };
}
