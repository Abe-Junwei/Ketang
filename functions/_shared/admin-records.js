import { batchD1, insertAudit, queryD1, runD1 } from "./d1.js";
import {
  atomicWriteBatch,
  auditLogStatement,
  enrichWriteResponse,
  fetchLatestHousekeepingPatches,
  fetchMealDeletionsForLodgers,
  finishWrite,
} from "./write-response.js";
import { parsePersonNameInput } from "./person.js";
import { housekeepingRequiresInspect } from "./operational-settings.js";
import { requirePermission } from "./permissions.js";
import { assertGuestIdentityFields } from "./validation.js";
import { nowIso } from "./sync-timestamp.js";
import {
  EVENT_ROOMING_COLUMN_SQL,
  EVENT_ROOMING_SET_SQL,
  eventRoomingValues,
  parseBedTagFields,
  parseEventRoomingFields,
  parseRoomTagFields,
} from "./rooming-tags.js";

const DORM_TYPES = new Set(["男寮", "女寮", "不限"]);
const BED_STATUSES = new Set(["可用", "维修", "备用"]);
const GENDERS = new Set(["男", "女"]);
const LODGER_STATUSES = new Set(["在住", "已退"]);
const EVENT_TYPES = new Set(["禅营", "禅七", "法会", "修道班", "其他"]);
const EVENT_GENDERS = new Set(["男众", "女众", "混合"]);
const EVENT_STATUSES = new Set([
  "筹备中",
  "招生中",
  "进行中",
  "已结束",
  "已取消",
]);

/** admin/records 子阶段计时 | Sub-stage timing for records handler */
let _recordTiming = null;

function flushHandlerMs() {
  if (!_recordTiming || _recordTiming._handlerT0 == null) return;
  _recordTiming.handler_ms =
    (_recordTiming.handler_ms || 0) + (Date.now() - _recordTiming._handlerT0);
  _recordTiming._handlerT0 = null;
}

function markHandlerStart() {
  if (_recordTiming) _recordTiming._handlerT0 = Date.now();
}

async function recordWriteBatch(env, ...args) {
  flushHandlerMs();
  const t0 = Date.now();
  const result = await atomicWriteBatch(env, ...args);
  if (_recordTiming) {
    _recordTiming.write_tail_ms =
      (_recordTiming.write_tail_ms || 0) + (Date.now() - t0);
  }
  markHandlerStart();
  return result;
}

async function recordFinishWrite(env, ...args) {
  flushHandlerMs();
  const t0 = Date.now();
  const result = await finishWrite(env, ...args);
  if (_recordTiming) {
    _recordTiming.write_tail_ms =
      (_recordTiming.write_tail_ms || 0) + (Date.now() - t0);
  }
  markHandlerStart();
  return result;
}

async function recordEnrichWrite(env, writeMeta, options) {
  flushHandlerMs();
  const t0 = Date.now();
  const result = await enrichWriteResponse(env, writeMeta, options);
  if (_recordTiming) {
    _recordTiming.patch_ms = (_recordTiming.patch_ms || 0) + (Date.now() - t0);
  }
  markHandlerStart();
  return result;
}

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

function dormMatchesGender(dormType, gender) {
  return (
    dormType === "不限" ||
    (dormType === "男寮" && gender === "男") ||
    (dormType === "女寮" && gender === "女")
  );
}

function buildRoomPatchRow(roomId, body, tags) {
  return {
    id: roomId,
    name: text(body.name),
    location: text(body.location),
    floor: parseInt(body.floor, 10) || 1,
    dorm_type: body.dorm_type || "不限",
    notes: text(body.notes),
    room_type: tags.room_type,
    suitable_elder: tags.suitable_elder,
    suitable_child: tags.suitable_child,
    near_zen_hall: tags.near_zen_hall,
    flexible_use: tags.flexible_use,
  };
}

function buildBedPatchRow(bedId, roomId, bedNumber, status, body, bedTags) {
  return {
    id: bedId,
    room_id: roomId,
    bed_number: bedNumber,
    status: status,
    notes: text(body.notes),
    bed_type: bedTags.bed_type,
    suitable_elder: bedTags.suitable_elder,
    is_flexible: bedTags.is_flexible,
  };
}

function buildGuestPatchRow(guestId, person, body, gender, phone, idCard, now) {
  return {
    id: guestId,
    name: person.name,
    dharma_name: person.dharma_name,
    gender: gender,
    phone: phone,
    id_card: idCard,
    emergency_contact: text(body.emergency_contact),
    emergency_phone: text(body.emergency_phone),
    notes: text(body.notes),
    created_at: now,
    updated_at: now,
  };
}

/** In-memory lodger patch after admin update (avoid post-write SELECT) */
function buildLodgerPatchRow(id, lodger, fields) {
  return {
    ...lodger,
    id,
    name: fields.name,
    dharma_name: fields.dharma_name,
    gender: fields.gender,
    phone: fields.phone,
    id_card: fields.id_card,
    check_in_date: fields.check_in_date,
    expected_check_out: fields.expected_check_out,
    actual_check_out: fields.actual_check_out,
    status: fields.status,
    source: fields.source,
    bed_id: fields.bed_id,
    notes: fields.notes,
  };
}

function dateRange(start, end) {
  if (!start || !end) return [];
  const days = [];
  const current = new Date(`${start}T00:00:00`);
  const stop = new Date(`${end}T00:00:00`);
  while (!Number.isNaN(current.getTime()) && current < stop) {
    days.push(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + 1);
  }
  return days;
}

async function upsertRoom(env, session, body) {
  const id = parseInt(body.room_id, 10) || 0;
  const name = text(body.name);
  if (!name) throw new Error("房间名为必填");
  const dormType = assertInSet(
    body.dorm_type || "不限",
    DORM_TYPES,
    "请选择有效的寮房类型",
  );
  const floor = parseInt(body.floor, 10) || 1;
  const dup = await queryD1(
    env,
    "SELECT id FROM rooms WHERE name = ? AND id != ? LIMIT 1",
    [name, id],
  );
  if (dup[0]) throw new Error("房间名已存在");

  if (id) {
    const existing = await queryD1(
      env,
      "SELECT id FROM rooms WHERE id = ? LIMIT 1",
      [id],
    );
    if (!existing[0]) throw new Error("房间不存在");
    const tags = parseRoomTagFields(body);
    const writeMeta = await recordWriteBatch(
      env,
      [
        {
          sql: "UPDATE rooms SET name=?, location=?, floor=?, dorm_type=?, notes=?, room_type=?, suitable_elder=?, suitable_child=?, near_zen_hall=?, flexible_use=? WHERE id=?",
          params: [
            name,
            text(body.location),
            floor,
            dormType,
            text(body.notes),
            tags.room_type,
            tags.suitable_elder,
            tags.suitable_child,
            tags.near_zen_hall,
            tags.flexible_use,
            id,
          ],
        },
        auditLogStatement("更新房间", "room", id, { name }, session),
      ],
      { room_id: id },
      ["settings"],
      null,
      ["settings_rooms"],
    );
    return recordEnrichWrite(env, writeMeta, {
      patchTable: "rooms",
      patchRow: buildRoomPatchRow(id, body, tags),
      patchComplete: true,
    });
  }

  const tags = parseRoomTagFields(body);
  const writeMeta = await recordWriteBatch(
    env,
    [
      {
        sql: "INSERT INTO rooms (name, location, floor, dorm_type, notes, room_type, suitable_elder, suitable_child, near_zen_hall, flexible_use) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params: [
          name,
          text(body.location),
          floor,
          dormType,
          text(body.notes),
          tags.room_type,
          tags.suitable_elder,
          tags.suitable_child,
          tags.near_zen_hall,
          tags.flexible_use,
        ],
      },
      auditLogStatement("新增房间", "room", null, { name }, session, {
        useLastInsertRowId: true,
      }),
    ],
    {},
    ["settings"],
    null,
    ["settings_rooms"],
  );
  const roomId = writeMeta.last_row_id;
  if (!roomId) throw new Error("新增房间失败");
  writeMeta.room_id = roomId;
  return recordEnrichWrite(env, writeMeta, {
    patchTable: "rooms",
    patchRow: buildRoomPatchRow(roomId, body, tags),
    patchComplete: true,
  });
}

async function deleteRoom(env, session, body) {
  const id = requireId(body.room_id, "房间 ID");
  const rows = await queryD1(
    env,
    "SELECT name FROM rooms WHERE id = ? LIMIT 1",
    [id],
  );
  const room = rows[0];
  if (!room) throw new Error("房间不存在");
  const beds = await queryD1(
    env,
    "SELECT COUNT(*) AS c FROM beds WHERE room_id = ?",
    [id],
  );
  if ((beds[0]?.c || 0) > 0)
    throw new Error(
      `该房间下还有 ${beds[0].c} 张床位，请先删除床位后再删除房间`,
    );
  return recordEnrichWrite(
    env,
    await recordWriteBatch(
      env,
      [
        { sql: "DELETE FROM rooms WHERE id = ?", params: [id] },
        auditLogStatement("删除房间", "room", id, { name: room.name }, session),
      ],
      {},
      ["settings"],
      { table_name: "rooms", row_id: id },
      ["settings_rooms"],
    ),
    {
      deletion: { table_name: "rooms", row_id: id },
      patchComplete: true,
    },
  );
}

async function upsertBed(env, session, body) {
  const id = parseInt(body.bed_id, 10) || 0;
  const roomId = requireId(body.room_id, "房间 ID");
  const bedNumber = text(body.bed_number);
  if (!bedNumber) throw new Error("床位号为必填");
  const status = assertInSet(
    body.status || "可用",
    BED_STATUSES,
    "请选择有效的床位状态",
  );
  const room = (
    await queryD1(env, "SELECT id FROM rooms WHERE id = ? LIMIT 1", [roomId])
  )[0];
  if (!room) throw new Error("房间不存在");
  const dup = await queryD1(
    env,
    "SELECT id FROM beds WHERE room_id = ? AND bed_number = ? AND id != ? LIMIT 1",
    [roomId, bedNumber, id],
  );
  if (dup[0]) throw new Error("该房间下已存在相同床位号");

  const occRows = id
    ? await queryD1(
        env,
        "SELECT COUNT(*) AS c FROM lodgers WHERE bed_id = ? AND status = '在住'",
        [id],
      )
    : [{ c: 0 }];
  const occupied = (occRows[0]?.c || 0) > 0;
  if (occupied && (status === "维修" || status === "备用"))
    throw new Error("该床位当前有住客，不能设为维修或备用");

  const bedTags = parseBedTagFields(body);

  if (id) {
    const old = (
      await queryD1(env, "SELECT status FROM beds WHERE id = ? LIMIT 1", [id])
    )[0];
    if (!old) throw new Error("床位不存在");
    const statements = [
      {
        sql: "UPDATE beds SET room_id=?, bed_number=?, status=?, notes=?, bed_type=?, suitable_elder=?, is_flexible=? WHERE id=?",
        params: [
          roomId,
          bedNumber,
          status,
          text(body.notes),
          bedTags.bed_type,
          bedTags.suitable_elder,
          bedTags.is_flexible,
          id,
        ],
      },
    ];
    if (old.status !== status) {
      statements.push({
        sql: "INSERT INTO housekeeping (bed_id, status, operator, notes) VALUES (?, ?, ?, ?)",
        params: [
          id,
          status,
          session.username,
          `信息管理修改床位状态：${status}`,
        ],
      });
    }
    statements.push(
      auditLogStatement(
        "更新床位",
        "bed",
        id,
        { room_id: roomId, bed_number: bedNumber, status },
        session,
      ),
    );
    const writeMeta = await recordWriteBatch(
      env,
      statements,
      { bed_id: id },
      ["settings"],
      null,
      ["settings_beds"],
    );
    return recordEnrichWrite(env, writeMeta, {
      patchTable: "beds",
      patchRow: buildBedPatchRow(id, roomId, bedNumber, status, body, bedTags),
      patchComplete: true,
    });
  }

  const writeMeta = await recordWriteBatch(
    env,
    [
      {
        sql: "INSERT INTO beds (room_id, bed_number, status, notes, bed_type, suitable_elder, is_flexible) VALUES (?, ?, ?, ?, ?, ?, ?)",
        params: [
          roomId,
          bedNumber,
          status,
          text(body.notes),
          bedTags.bed_type,
          bedTags.suitable_elder,
          bedTags.is_flexible,
        ],
      },
      {
        sql: "INSERT INTO housekeeping (bed_id, status, operator, notes) VALUES (last_insert_rowid(), ?, ?, ?)",
        params: [status, session.username, "新增床位"],
      },
      auditLogStatement(
        "新增床位",
        "bed",
        null,
        { room_id: roomId, bed_number: bedNumber, status },
        session,
        { useLastInsertRowId: true },
      ),
    ],
    {},
    ["settings"],
    null,
    ["settings_beds"],
  );
  const bedId = writeMeta.last_row_id;
  if (!bedId) throw new Error("新增床位失败");
  writeMeta.bed_id = bedId;
  return recordEnrichWrite(env, writeMeta, {
    patchTable: "beds",
    patchRow: buildBedPatchRow(bedId, roomId, bedNumber, status, body, bedTags),
    patchComplete: true,
  });
}

async function deleteBed(env, session, body) {
  const id = requireId(body.bed_id, "床位 ID");
  const rows = await queryD1(
    env,
    `SELECT b.*, r.name AS room_name,
    (SELECT COUNT(*) FROM lodgers WHERE bed_id = b.id AND status = '在住') AS occupant_count
    FROM beds b JOIN rooms r ON r.id = b.room_id WHERE b.id = ?`,
    [id],
  );
  const bed = rows[0];
  if (!bed) throw new Error("床位不存在");
  if ((bed.occupant_count || 0) > 0)
    throw new Error("该床位当前有在住住客，无法删除");
  const assignmentIds = (
    await queryD1(env, "SELECT id FROM rooming_assignments WHERE bed_id = ?", [
      id,
    ])
  ).map(function (r) {
    return r.id;
  });
  const queueIds = (
    await queryD1(
      env,
      "SELECT id FROM rooming_checkin_queue WHERE suggested_bed_id = ?",
      [id],
    )
  ).map(function (r) {
    return r.id;
  });
  const adjustmentIds = (
    await queryD1(
      env,
      "SELECT id FROM rooming_adjustments WHERE from_bed_id = ? OR to_bed_id = ?",
      [id, id],
    )
  ).map(function (r) {
    return r.id;
  });
  const writeMeta = await recordWriteBatch(
    env,
    [
      {
        sql: "UPDATE rooming_assignments SET bed_id = NULL WHERE bed_id = ?",
        params: [id],
      },
      {
        sql: "UPDATE rooming_checkin_queue SET suggested_bed_id = NULL WHERE suggested_bed_id = ?",
        params: [id],
      },
      {
        sql: "UPDATE rooming_adjustments SET from_bed_id = NULL WHERE from_bed_id = ?",
        params: [id],
      },
      {
        sql: "UPDATE rooming_adjustments SET to_bed_id = NULL WHERE to_bed_id = ?",
        params: [id],
      },
      { sql: "DELETE FROM housekeeping WHERE bed_id = ?", params: [id] },
      { sql: "DELETE FROM beds WHERE id = ?", params: [id] },
      auditLogStatement(
        "删除床位",
        "bed",
        id,
        { room_id: bed.room_id, bed_number: bed.bed_number },
        session,
      ),
    ],
    {},
    ["settings", "events"],
    { table_name: "beds", row_id: id },
    ["settings_beds", "event_rooming", "board"],
  );
  async function rowsByIds(table, ids) {
    if (!ids.length) return [];
    const placeholders = ids
      .map(function () {
        return "?";
      })
      .join(",");
    return queryD1(
      env,
      `SELECT * FROM ${table} WHERE id IN (${placeholders})`,
      ids,
    );
  }
  const extraPatches = {
    rooming_assignments: await rowsByIds("rooming_assignments", assignmentIds),
    rooming_checkin_queue: await rowsByIds("rooming_checkin_queue", queueIds),
    rooming_adjustments: await rowsByIds("rooming_adjustments", adjustmentIds),
  };
  return recordEnrichWrite(env, writeMeta, {
    deletions: [
      { table_name: "beds", row_id: id },
      { table_name: "housekeeping", bed_id: id },
    ],
    extraPatches: extraPatches,
    patchComplete: true,
  });
}

async function upsertGuest(env, session, body) {
  const id = parseInt(body.guest_id, 10) || 0;
  const person = parsePersonNameInput(body.name);
  if (!person.name) throw new Error("姓名 / 法名为必填");
  const gender = assertInSet(body.gender || "男", GENDERS, "请选择有效性别");
  const identity = assertGuestIdentityFields({
    id_card: body.id_card,
    phone: body.phone,
    emergency_name: body.emergency_contact,
    emergency_phone: body.emergency_phone,
  });
  const phone = identity.phone;
  const idCard = identity.idCard;
  const now = nowIso();

  if (phone) {
    const dupPhone = await queryD1(
      env,
      'SELECT id FROM guests WHERE phone = ? AND phone <> "" AND id != ? LIMIT 1',
      [phone, id],
    );
    if (dupPhone[0]) throw new Error("该手机号已存在");
  }
  const dupId = await queryD1(
    env,
    'SELECT id FROM guests WHERE id_card = ? AND id_card <> "" AND id != ? LIMIT 1',
    [idCard, id],
  );
  if (dupId[0]) throw new Error("该身份证已存在");

  if (id) {
    const existing = await queryD1(
      env,
      "SELECT id FROM guests WHERE id = ? LIMIT 1",
      [id],
    );
    if (!existing[0]) throw new Error("住客档案不存在");
    const writeMeta = await recordWriteBatch(
      env,
      [
        {
          sql: "UPDATE guests SET name=?, dharma_name=?, gender=?, phone=?, id_card=?, emergency_contact=?, emergency_phone=?, notes=?, updated_at=? WHERE id=?",
          params: [
            person.name,
            person.dharma_name,
            gender,
            phone,
            idCard,
            text(body.emergency_contact),
            text(body.emergency_phone),
            text(body.notes),
            now,
            id,
          ],
        },
        {
          sql: "UPDATE lodgers SET name=?, dharma_name=?, gender=?, phone=?, id_card=? WHERE guest_id=?",
          params: [person.name, person.dharma_name, gender, phone, idCard, id],
        },
        auditLogStatement(
          "更新住客档案",
          "guest",
          id,
          { name: person.name, phone },
          session,
        ),
      ],
      { guest_id: id },
      ["settings"],
      null,
      ["settings_guests"],
    );
    return recordEnrichWrite(env, writeMeta, {
      patchTable: "guests",
      patchRow: buildGuestPatchRow(
        id,
        person,
        body,
        gender,
        phone,
        idCard,
        now,
      ),
      patchComplete: true,
    });
  }

  const writeMeta = await recordWriteBatch(
    env,
    [
      {
        sql: `INSERT INTO guests (name, dharma_name, gender, phone, id_card, emergency_contact, emergency_phone, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          person.name,
          person.dharma_name,
          gender,
          phone,
          idCard,
          text(body.emergency_contact),
          text(body.emergency_phone),
          text(body.notes),
          now,
          now,
        ],
      },
      auditLogStatement(
        "新增住客档案",
        "guest",
        null,
        { name: person.name, phone },
        session,
        { useLastInsertRowId: true },
      ),
    ],
    {},
    ["settings"],
    null,
    ["settings_guests"],
  );
  const guestId = writeMeta.last_row_id;
  if (!guestId) throw new Error("新增住客档案失败");
  writeMeta.guest_id = guestId;
  return recordEnrichWrite(env, writeMeta, {
    patchTable: "guests",
    patchRow: buildGuestPatchRow(
      guestId,
      person,
      body,
      gender,
      phone,
      idCard,
      now,
    ),
    patchComplete: true,
  });
}

async function deleteGuest(env, session, body) {
  const id = requireId(body.guest_id, "住客 ID");
  const guest = (
    await queryD1(env, "SELECT name FROM guests WHERE id = ? LIMIT 1", [id])
  )[0];
  if (!guest) throw new Error("住客档案不存在");
  const refs = await queryD1(
    env,
    "SELECT COUNT(*) AS c FROM lodgers WHERE guest_id = ?",
    [id],
  );
  if ((refs[0]?.c || 0) > 0)
    throw new Error(`该档案已被 ${refs[0].c} 条挂单记录引用，无法删除`);
  return recordEnrichWrite(
    env,
    await recordWriteBatch(
      env,
      [
        { sql: "DELETE FROM guests WHERE id = ?", params: [id] },
        auditLogStatement(
          "删除住客档案",
          "guest",
          id,
          { name: guest.name },
          session,
        ),
      ],
      {},
      ["settings"],
      { table_name: "guests", row_id: id },
      ["settings_guests"],
    ),
    {
      deletion: { table_name: "guests", row_id: id },
      patchComplete: true,
    },
  );
}

async function upsertEvent(env, session, body) {
  const id = parseInt(body.event_id, 10) || 0;
  const name = text(body.name);
  if (!name) throw new Error("请输入营期名称");
  const eventType = assertInSet(
    body.event_type || "禅营",
    EVENT_TYPES,
    "营期类型无效",
  );
  const genderType = assertInSet(
    body.gender_type || "混合",
    EVENT_GENDERS,
    "性别类型无效",
  );
  const status = assertInSet(
    body.status || "筹备中",
    EVENT_STATUSES,
    "营期状态无效",
  );
  const expected = parseInt(body.expected_count, 10) || 0;
  const startDate = text(body.start_date);
  const endDate = text(body.end_date);
  const includeSpareBeds = body.include_spare_beds ? 1 : 0;
  const rooming = parseEventRoomingFields(body);
  const roomingValues = eventRoomingValues(rooming);
  if (startDate && endDate && endDate < startDate)
    throw new Error("结束日期不能早于开始日期");
  if (
    rooming.arrival_date &&
    rooming.departure_date &&
    rooming.departure_date < rooming.arrival_date
  ) {
    throw new Error("离寺日期不能早于报到日期");
  }

  function buildEventPatchRow(eventId) {
    return {
      id: eventId,
      name,
      event_type: eventType,
      gender_type: genderType,
      expected_count: expected,
      start_date: startDate,
      end_date: endDate,
      status,
      notes: text(body.notes),
      include_spare_beds: includeSpareBeds,
      ...rooming,
    };
  }

  if (id) {
    const old = (
      await queryD1(env, "SELECT status FROM events WHERE id = ? LIMIT 1", [id])
    )[0];
    if (!old) throw new Error("营期不存在");
    const statements = [
      {
        sql: `UPDATE events SET name=?, event_type=?, gender_type=?, expected_count=?, start_date=?, end_date=?, status=?, notes=?, include_spare_beds=?, ${EVENT_ROOMING_SET_SQL} WHERE id=?`,
        params: [
          name,
          eventType,
          genderType,
          expected,
          startDate,
          endDate,
          status,
          text(body.notes),
          includeSpareBeds,
          ...roomingValues,
          id,
        ],
      },
    ];
    const patchRows = { beds: [], reservations: [], lodgers: [] };
    let mealDeletions = [];
    let housekeepingPatches = [];
    let cancelCascade = false;
    if (status === "已取消" && old.status !== "已取消") {
      cancelCascade = true;
      const today = new Date().toISOString().slice(0, 10);
      const lodgers = await queryD1(
        env,
        "SELECT * FROM lodgers WHERE event_id=? AND status='在住'",
        [id],
      );
      const reservations = await queryD1(
        env,
        "SELECT * FROM reservations WHERE event_id=? AND status IN ('预约','已确认')",
        [id],
      );
      const lodgerIds = lodgers.map(function (l) {
        return l.id;
      });
      mealDeletions = await fetchMealDeletionsForLodgers(env, lodgerIds, today);
      lodgers.forEach((lodger) => {
        patchRows.lodgers.push({
          ...lodger,
          status: "已取消",
          bed_id: null,
          actual_check_out: today,
        });
        statements.push({
          sql: "UPDATE lodgers SET status='已取消', bed_id=NULL, actual_check_out=? WHERE id=?",
          params: [today, lodger.id],
        });
        statements.push({
          sql: "DELETE FROM meals WHERE lodger_id=? AND date>?",
          params: [lodger.id, today],
        });
        if (lodger.bed_id) {
          patchRows.beds.push({ id: lodger.bed_id, status: "可用" });
          statements.push({
            sql: "UPDATE beds SET status='可用' WHERE id=?",
            params: [lodger.bed_id],
          });
          statements.push({
            sql: "INSERT INTO housekeeping (bed_id, status, operator, notes) VALUES (?, ?, ?, ?)",
            params: [
              lodger.bed_id,
              "脏房",
              session.username,
              "营期取消释放床位",
            ],
          });
        }
      });
      reservations.forEach((row) => {
        patchRows.reservations.push({ ...row, status: "已取消" });
      });
      statements.push({
        sql: "UPDATE reservations SET status='已取消' WHERE event_id=? AND status IN ('预约','已确认')",
        params: [id],
      });
    }
    statements.push(
      auditLogStatement("更新营期", "event", id, { name }, session),
    );
    const domains = cancelCascade
      ? ["events", "lodging", "reservations", "meals"]
      : ["events"];
    const modules = cancelCascade
      ? ["events", "board", "lodgers_active", "reservations", "meals"]
      : ["events"];
    const writeMeta = await recordWriteBatch(
      env,
      statements,
      { event_id: id },
      domains,
      null,
      modules,
    );
    if (cancelCascade && patchRows.beds.length) {
      housekeepingPatches = await fetchLatestHousekeepingPatches(
        env,
        patchRows.beds.map(function (bed) {
          return bed.id;
        }),
      );
    }
    return recordEnrichWrite(
      env,
      writeMeta,
      cancelCascade
        ? {
            patchTable: "events",
            patchRow: buildEventPatchRow(id),
            patchRows: patchRows,
            deletions: mealDeletions,
            extraPatches: { housekeeping: housekeepingPatches },
            patchComplete: true,
          }
        : {
            patchTable: "events",
            patchRow: buildEventPatchRow(id),
            patchComplete: true,
          },
    );
  }

  // Single D1 batch: INSERT + audit + version bump + sync logs + version read
  const writeMeta = await recordWriteBatch(
    env,
    [
      {
        sql: `INSERT INTO events (name, event_type, gender_type, expected_count, start_date, end_date, status, notes, include_spare_beds, ${EVENT_ROOMING_COLUMN_SQL}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${roomingValues.map(() => "?").join(", ")})`,
        params: [
          name,
          eventType,
          genderType,
          expected,
          startDate,
          endDate,
          status,
          text(body.notes),
          includeSpareBeds,
          ...roomingValues,
        ],
      },
      auditLogStatement("新增营期", "event", null, { name }, session, {
        useLastInsertRowId: true,
      }),
    ],
    {},
    ["events"],
    null,
    ["events"],
  );
  const eventId = writeMeta.last_row_id;
  if (!eventId) throw new Error("新增营期失败");
  writeMeta.event_id = eventId;
  return recordEnrichWrite(env, writeMeta, {
    patchTable: "events",
    patchRow: buildEventPatchRow(eventId),
    patchComplete: true,
  });
}

async function deleteEvent(env, session, body) {
  const id = requireId(body.event_id, "营期 ID");
  const event = (
    await queryD1(env, "SELECT name FROM events WHERE id = ? LIMIT 1", [id])
  )[0];
  if (!event) throw new Error("营期不存在");
  const refs = await queryD1(
    env,
    "SELECT (SELECT COUNT(*) FROM lodgers WHERE event_id = ?) + (SELECT COUNT(*) FROM reservations WHERE event_id = ?) AS c",
    [id, id],
  );
  if ((refs[0]?.c || 0) > 0)
    throw new Error(
      `该营期下还有 ${refs[0].c} 条记录，无法删除。请先取消或转移这些记录。`,
    );
  return recordEnrichWrite(
    env,
    await recordWriteBatch(
      env,
      [
        { sql: "DELETE FROM events WHERE id = ?", params: [id] },
        auditLogStatement(
          "删除营期",
          "event",
          id,
          { name: event.name },
          session,
        ),
      ],
      {},
      ["events"],
      { table_name: "events", row_id: id },
      ["events"],
    ),
    {
      deletion: { table_name: "events", row_id: id },
      patchComplete: true,
    },
  );
}

async function updateLodgerRecord(env, session, body) {
  const id = requireId(body.lodger_id, "挂单 ID");
  const rows = await queryD1(
    env,
    "SELECT * FROM lodgers WHERE id = ? LIMIT 1",
    [id],
  );
  const lodger = rows[0];
  if (!lodger) throw new Error("挂单记录不存在");
  const person = parsePersonNameInput(body.name);
  if (!person.name) throw new Error("姓名 / 法名为必填");
  const gender = assertInSet(body.gender || "", GENDERS, "请选择有效性别");
  const status = assertInSet(
    body.status || "在住",
    LODGER_STATUSES,
    "挂单状态无效",
  );
  const checkIn = text(body.check_in_date);
  const expectedOut = text(body.expected_check_out);
  if (!checkIn || !expectedOut) throw new Error("请选择入住日期和预离日期");
  if (expectedOut < checkIn) throw new Error("预离日期不能早于入住日期");
  let emergencyName = body.emergency_name;
  let emergencyPhone = body.emergency_phone;
  if (lodger.guest_id) {
    const guestRows = await queryD1(
      env,
      "SELECT emergency_contact, emergency_phone FROM guests WHERE id = ? LIMIT 1",
      [lodger.guest_id],
    );
    const guest = guestRows[0];
    if (guest) {
      if (emergencyName == null || emergencyName === "") {
        emergencyName = guest.emergency_contact;
      }
      if (emergencyPhone == null || emergencyPhone === "") {
        emergencyPhone = guest.emergency_phone;
      }
    }
  }
  const identity = assertGuestIdentityFields({
    id_card: body.id_card,
    phone: body.phone,
    emergency_name: emergencyName,
    emergency_phone: emergencyPhone,
  });
  const bedId = body.bed_id ? parseInt(body.bed_id, 10) : null;

  if (bedId) {
    const other = await queryD1(
      env,
      "SELECT id FROM lodgers WHERE bed_id = ? AND status = '在住' AND id != ? LIMIT 1",
      [bedId, id],
    );
    if (other[0]) throw new Error("该床位已被其他在住住客占用");
    const bed = (
      await queryD1(
        env,
        "SELECT b.*, r.dorm_type FROM beds b JOIN rooms r ON r.id = b.room_id WHERE b.id = ? LIMIT 1",
        [bedId],
      )
    )[0];
    if (!bed) throw new Error("床位不存在");
    if (bed.status === "维修" || bed.status === "备用")
      throw new Error("该床位不可分配");
    if (!dormMatchesGender(bed.dorm_type, gender))
      throw new Error("该床位所在房间寮类型与性别不符");
    if (status === "在住") {
      const hkRows = await queryD1(
        env,
        "SELECT status FROM housekeeping WHERE bed_id = ? ORDER BY changed_at DESC LIMIT 1",
        [bedId],
      );
      const hk = hkRows[0]?.status || "净房";
      const requireInspect = await housekeepingRequiresInspect(env);
      if (requireInspect && hk !== "可用") {
        throw new Error("该床位尚未完成查房，不可分配");
      }
      if (!requireInspect && hk !== "净房" && hk !== "可用") {
        throw new Error("该床位房务状态不可分配");
      }
    }
  }

  let actualOut = lodger.actual_check_out || null;
  let finalBedId = bedId;
  if (status === "已退" && lodger.status === "在住") {
    const paid = (
      await queryD1(
        env,
        "SELECT COALESCE(SUM(CASE WHEN type IN ('押金','房费') THEN amount ELSE 0 END), 0) AS income, COALESCE(SUM(CASE WHEN type = '退款' THEN amount ELSE 0 END), 0) AS refund_total FROM payments WHERE lodger_id = ?",
        [id],
      )
    )[0];
    const balance = (paid?.income || 0) - (paid?.refund_total || 0);
    if (balance > 0)
      throw new Error(
        `该挂单尚有余额 ${balance.toFixed(2)} 元，请使用「退房」功能处理退款`,
      );
    actualOut = new Date().toISOString().slice(0, 10);
    finalBedId = null;
  } else if (status === "在住" && lodger.status === "已退") {
    actualOut = null;
  }

  const statements = [
    {
      sql: `UPDATE lodgers SET name=?, dharma_name=?, gender=?, phone=?, id_card=?, check_in_date=?, expected_check_out=?, actual_check_out=?, status=?, source=?, bed_id=?, notes=? WHERE id=?`,
      params: [
        person.name,
        person.dharma_name,
        gender,
        identity.phone,
        identity.idCard,
        checkIn,
        expectedOut,
        actualOut,
        status,
        body.source || null,
        finalBedId,
        body.notes || null,
        id,
      ],
    },
  ];

  if (lodger.bed_id && lodger.bed_id !== finalBedId) {
    statements.push({
      sql: "UPDATE beds SET status='可用' WHERE id=? AND NOT EXISTS (SELECT 1 FROM lodgers WHERE bed_id=? AND status='在住' AND id != ?)",
      params: [lodger.bed_id, lodger.bed_id, id],
    });
    statements.push({
      sql: "INSERT INTO housekeeping (bed_id, status, operator, notes) VALUES (?, ?, ?, ?)",
      params: [
        lodger.bed_id,
        status === "已退" ? "脏房" : "可用",
        session.username,
        status === "已退" ? "挂单退床" : "挂单换床释放旧床位",
      ],
    });
  }
  if (finalBedId && status === "在住")
    statements.push({
      sql: "UPDATE beds SET status='占用' WHERE id=?",
      params: [finalBedId],
    });
  if (status === "在住") {
    statements.push({
      sql: "DELETE FROM meals WHERE lodger_id = ? AND (date < ? OR date > ?)",
      params: [id, checkIn, expectedOut],
    });
    dateRange(checkIn, expectedOut).forEach((date) => {
      statements.push({
        sql: "INSERT OR IGNORE INTO meals (lodger_id, date, breakfast, lunch, dinner) VALUES (?, ?, ?, ?, ?)",
        params: [
          id,
          date,
          lodger.meal_default_breakfast || 0,
          lodger.meal_default_lunch || 0,
          lodger.meal_default_dinner || 0,
        ],
      });
    });
  } else {
    statements.push({
      sql: "DELETE FROM meals WHERE lodger_id = ? AND date > ?",
      params: [id, actualOut || checkIn],
    });
  }

  await batchD1(env, statements);
  await insertAudit(
    env,
    "更新挂单记录",
    "lodger",
    id,
    { name: person.name, bed_id: finalBedId, status },
    session,
  );
  const enrichOpts = {
    patchRow: buildLodgerPatchRow(id, lodger, {
      name: person.name,
      dharma_name: person.dharma_name,
      gender,
      phone: identity.phone,
      id_card: identity.idCard,
      check_in_date: checkIn,
      expected_check_out: expectedOut,
      actual_check_out: actualOut,
      status,
      source: body.source != null ? text(body.source) : lodger.source,
      bed_id: finalBedId,
      notes: body.notes != null ? text(body.notes) : lodger.notes,
    }),
    patchTable: "lodgers",
    patchComplete: true,
  };
  const bedIds = [];
  if (lodger.bed_id && lodger.bed_id !== finalBedId) bedIds.push(lodger.bed_id);
  if (finalBedId) bedIds.push(finalBedId);
  if (bedIds.length) {
    const bedPatches = [];
    if (lodger.bed_id && lodger.bed_id !== finalBedId) {
      bedPatches.push({ id: lodger.bed_id, status: "可用" });
    }
    if (finalBedId && status === "在住") {
      bedPatches.push({ id: finalBedId, status: "占用" });
    }
    enrichOpts.patchRows = { beds: bedPatches };
    enrichOpts.extraPatches = {
      housekeeping: await fetchLatestHousekeepingPatches(env, bedIds),
    };
  }
  return recordEnrichWrite(
    env,
    await recordFinishWrite(
      env,
      {},
      ["lodging"],
      ["lodgers_active", "lodgers"],
    ),
    enrichOpts,
  );
}

export async function handleAdminRecord(env, session, body, timing) {
  _recordTiming = timing || null;
  markHandlerStart();
  try {
    await requirePermission(env, session, "settings.write");
    const resource = body.resource;
    const action = body.action;
    if (resource === "room" && (action === "create" || action === "update"))
      return upsertRoom(env, session, body);
    if (resource === "room" && action === "delete")
      return deleteRoom(env, session, body);
    if (resource === "bed" && (action === "create" || action === "update"))
      return upsertBed(env, session, body);
    if (resource === "bed" && action === "delete")
      return deleteBed(env, session, body);
    if (resource === "guest" && (action === "create" || action === "update"))
      return upsertGuest(env, session, body);
    if (resource === "guest" && action === "delete")
      return deleteGuest(env, session, body);
    if (resource === "event" && (action === "create" || action === "update"))
      return upsertEvent(env, session, body);
    if (resource === "event" && action === "delete")
      return deleteEvent(env, session, body);
    if (resource === "lodger" && action === "update")
      return updateLodgerRecord(env, session, body);
    throw new Error("未知管理操作");
  } finally {
    flushHandlerMs();
    _recordTiming = null;
  }
}
