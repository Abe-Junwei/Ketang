/* Phase 9 排房在线读模型 | Rooming read path (event detail + board rc) */

var _roomingEventDetail = {};
var _roomingEventInflight = {};

function roomingReadReady() {
  return typeof rcReadReady === "function" && rcReadReady();
}

function roomingUseLocalRead() {
  return typeof isLocalForceDb === "function" && isLocalForceDb();
}

function rcInvalidateEventRooming(eventId) {
  if (eventId != null) delete _roomingEventDetail[String(eventId)];
  else _roomingEventDetail = {};
}

/** 拉营期排房读模型 + 关联 board/lodgers | Fetch event rooming read model */
async function rcEnsureEventRooming(eventId, force) {
  if (!rcUseApiRead()) return null;
  var id = parseInt(eventId, 10);
  if (!id) return null;
  var key = String(id);
  if (!force && _roomingEventDetail[key]) return _roomingEventDetail[key];
  if (_roomingEventInflight[key]) return _roomingEventInflight[key];
  _roomingEventInflight[key] = (async function () {
    await rcEnsureBoard(force);
    await rcFetchMany(["events", "lodgers", "reservations"], force);
    var payload = await apiReadEventDetail(id);
    _roomingEventDetail[key] = payload || {};
    if (typeof applyModuleTables === "function" && payload && payload.tables) {
      applyModuleTables(payload.tables, { upsertOnly: true });
    }
    return payload;
  })().finally(function () {
    delete _roomingEventInflight[key];
  });
  return _roomingEventInflight[key];
}

async function roomingEnsureEvent(eventId, force) {
  if (roomingUseLocalRead()) return;
  await rcEnsureEventRooming(eventId, force);
}

function rcRoomingEventTables(eventId) {
  var p = _roomingEventDetail[String(eventId)];
  return (p && p.tables) || {};
}

function roomingGetEvent(eventId) {
  if (roomingReadReady()) {
    var rows = rcRoomingEventTables(eventId).events || [];
    return (
      rows.find(function (e) {
        return e.id == eventId;
      }) ||
      rcEventById(eventId) ||
      null
    );
  }
  return query("SELECT * FROM events WHERE id = ?", [eventId])[0];
}

function roomingGetPlan(eventId) {
  if (roomingReadReady()) {
    var plans = rcRoomingEventTables(eventId).rooming_plans || [];
    return (
      plans.find(function (p) {
        return p.event_id == eventId;
      }) || null
    );
  }
  return query("SELECT * FROM rooming_plans WHERE event_id = ? LIMIT 1", [
    eventId,
  ])[0];
}

function roomingGetPublishedPlan(eventId) {
  var plan = roomingGetPlan(eventId);
  if (!plan || !plan.published_at) return null;
  return plan;
}

function roomingBedMeta(bedId) {
  if (!bedId) return null;
  var bed = rcBoardBeds().find(function (b) {
    return b.id == bedId;
  });
  if (!bed) return null;
  var room = rcBoardRooms().find(function (r) {
    return r.id == bed.room_id;
  });
  return {
    bed_id: bed.id,
    bed_number: bed.bed_number,
    bed_status: bed.status,
    bed_suitable_elder: bed.suitable_elder,
    room_id: room ? room.id : null,
    room_name: room ? room.name : null,
    room_location: room ? room.location : null,
    dorm_type: room ? room.dorm_type : null,
    room_type: room ? room.room_type : null,
    room_suitable_elder: room ? room.suitable_elder : null,
    location: room ? room.location : null,
  };
}

function roomingEnrichAssignmentRow(row) {
  if (!row || !row.bed_id) return Object.assign({}, row);
  if (roomingReadReady()) {
    return Object.assign({}, row, roomingBedMeta(row.bed_id) || {});
  }
  var meta = query(
    "SELECT b.id AS bed_id, b.bed_number, b.status AS bed_status, b.suitable_elder AS bed_suitable_elder, " +
      "r.name AS room_name, r.location AS room_location, r.dorm_type, r.room_type, r.suitable_elder AS room_suitable_elder " +
      "FROM beds b JOIN rooms r ON r.id = b.room_id WHERE b.id = ?",
    [row.bed_id],
  )[0];
  return Object.assign({}, row, meta || {});
}

function roomingEnrichQueueRow(row) {
  if (!row) return row;
  if (!row.suggested_bed_id) return Object.assign({}, row);
  if (roomingReadReady()) {
    var meta = roomingBedMeta(row.suggested_bed_id);
    return Object.assign({}, row, meta || {});
  }
  return row;
}

function roomingAssignmentsForEvent(eventId, planId) {
  if (roomingReadReady()) {
    var pid = planId || (roomingGetPlan(eventId) && roomingGetPlan(eventId).id);
    if (!pid) return [];
    return (rcRoomingEventTables(eventId).rooming_assignments || [])
      .filter(function (ra) {
        return ra.plan_id == pid;
      })
      .map(roomingEnrichAssignmentRow)
      .sort(function (a, b) {
        var sa = a.sort_order || 0;
        var sb = b.sort_order || 0;
        if (sa !== sb) return sa - sb;
        return (a.id || 0) - (b.id || 0);
      });
  }
  return query(
    "SELECT ra.*, r.name AS room_name, r.location AS room_location, r.dorm_type, b.bed_number " +
      "FROM rooming_assignments ra " +
      "LEFT JOIN beds b ON b.id = ra.bed_id " +
      "LEFT JOIN rooms r ON r.id = b.room_id " +
      "WHERE ra.plan_id = ? ORDER BY ra.sort_order, ra.id",
    [planId],
  );
}

function roomingCheckinQueueForEvent(eventId) {
  if (roomingReadReady()) {
    return (rcRoomingEventTables(eventId).rooming_checkin_queue || [])
      .filter(function (q) {
        return q.event_id == eventId;
      })
      .map(roomingEnrichQueueRow)
      .sort(function (a, b) {
        var sa = a.sort_order || 0;
        var sb = b.sort_order || 0;
        if (sa !== sb) return sa - sb;
        return (a.id || 0) - (b.id || 0);
      });
  }
  return query(
    "SELECT q.*, r.name AS room_name, r.location AS room_location, r.dorm_type, b.bed_number " +
      "FROM rooming_checkin_queue q " +
      "LEFT JOIN beds b ON b.id = q.suggested_bed_id " +
      "LEFT JOIN rooms r ON r.id = b.room_id " +
      "WHERE q.event_id = ? ORDER BY q.sort_order, q.id",
    [eventId],
  );
}

function roomingAdjustmentsForEvent(eventId) {
  if (roomingReadReady()) {
    return (rcRoomingEventTables(eventId).rooming_adjustments || [])
      .filter(function (a) {
        return a.event_id == eventId;
      })
      .map(function (row) {
        var fromMeta = roomingBedMeta(row.from_bed_id);
        var toMeta = roomingBedMeta(row.to_bed_id);
        return Object.assign({}, row, {
          from_bed_number: fromMeta ? fromMeta.bed_number : null,
          from_room_name: fromMeta ? fromMeta.room_name : null,
          from_room_location: fromMeta ? fromMeta.room_location : null,
          to_bed_number: toMeta ? toMeta.bed_number : null,
          to_room_name: toMeta ? toMeta.room_name : null,
          to_room_location: toMeta ? toMeta.room_location : null,
        });
      })
      .sort(function (a, b) {
        return String(b.created_at || "").localeCompare(
          String(a.created_at || ""),
        );
      });
  }
  return query(
    "SELECT a.*, " +
      "fb.bed_number AS from_bed_number, fr.name AS from_room_name, fr.location AS from_room_location, " +
      "tb.bed_number AS to_bed_number, tr.name AS to_room_name, tr.location AS to_room_location " +
      "FROM rooming_adjustments a " +
      "LEFT JOIN beds fb ON fb.id = a.from_bed_id " +
      "LEFT JOIN rooms fr ON fr.id = fb.room_id " +
      "LEFT JOIN beds tb ON tb.id = a.to_bed_id " +
      "LEFT JOIN rooms tr ON tr.id = tb.room_id " +
      "WHERE a.event_id = ? ORDER BY a.created_at DESC, a.id DESC",
    [eventId],
  );
}

function roomingListEventMembersForPlan(eventId) {
  if (roomingReadReady() && typeof rcEventMembers === "function") {
    var pack = rcEventMembers(eventId);
    if (!pack) return [];
    var members = [];
    pack.lodgers.forEach(function (row) {
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
    pack.reservations.forEach(function (row) {
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
    var evt = pack.evt;
    if (!evt) return members;
    var registeredMale = members.filter(function (m) {
      return m.member_gender === "男";
    }).length;
    var registeredFemale = members.filter(function (m) {
      return m.member_gender === "女";
    }).length;
    if (typeof buildLocalForecastMembers === "function") {
      return members.concat(
        buildLocalForecastMembers(
          evt,
          members.length,
          registeredMale,
          registeredFemale,
        ),
      );
    }
    return members;
  }
  return listLocalEventMembersForPlan(eventId);
}

function roomingListDraftReservedBedIds(eventId, planId, event) {
  if (roomingReadReady()) {
    var range = {
      start: event.arrival_date || event.start_date,
      end: event.departure_date || event.end_date,
    };
    var eventsById = rcEventsById();
    var ids = {};
    rcRows("events", "rooming_assignments").forEach(function (ra) {
      if (!ra.bed_id) return;
      var plan = rcRows("events", "rooming_plans").find(function (p) {
        return p.id == ra.plan_id;
      });
      if (!plan || plan.event_id == eventId) return;
      if (planId && plan.id == planId) return;
      var other = eventsById[plan.event_id];
      if (!other) return;
      var otherStart = other.arrival_date || other.start_date;
      var otherEnd = other.departure_date || other.end_date;
      if (
        typeof roomingDatesOverlap === "function" &&
        roomingDatesOverlap(range.start, range.end, otherStart, otherEnd)
      ) {
        ids[ra.bed_id] = true;
      }
    });
    return Object.keys(ids).map(function (id) {
      return parseInt(id, 10);
    });
  }
  return listLocalDraftReservedBedIds(eventId, planId, event);
}

function roomingListAssignableBeds(event, excludeBedIds) {
  if (roomingReadReady()) {
    var exclude = {};
    (excludeBedIds || []).forEach(function (id) {
      if (id) exclude[id] = true;
    });
    var requireInspect =
      typeof housekeepingRequiresInspect === "function" &&
      housekeepingRequiresInspect();
    var includeSpare = !!event.include_spare_beds;
    var rows = [];
    rcBoardBeds().forEach(function (b) {
      if (b.status === "维修" || b.status === "备用") return;
      if (exclude[b.id]) return;
      var room = rcBoardRooms().find(function (r) {
        return r.id == b.room_id;
      });
      if (!room) return;
      if (
        typeof isSpareRoom === "function" &&
        isSpareRoom(room) &&
        !includeSpare
      )
        return;
      if (rcLodgerOnBed(b.id)) return;
      var hk = rcLatestHkStatus(b.id);
      var hkOk = requireInspect
        ? hk === "可用"
        : hk === "净房" || hk === "可用";
      if (!hkOk) return;
      rows.push({
        bed_id: b.id,
        bed_number: b.bed_number,
        room_id: room.id,
        room_name: room.name,
        location: room.location,
        dorm_type: room.dorm_type,
      });
    });
    rows.sort(function (a, b) {
      var da =
        a.dorm_type === "男寮" ? 1 : a.dorm_type === "女寮" ? 2 : 3;
      var db =
        b.dorm_type === "男寮" ? 1 : b.dorm_type === "女寮" ? 2 : 3;
      if (da !== db) return da - db;
      var la = (a.location || "") + (a.room_name || "");
      var lb = (b.location || "") + (b.room_name || "");
      if (la !== lb) return la.localeCompare(lb, "zh-CN");
      return (a.bed_number || 0) - (b.bed_number || 0);
    });
    return rows;
  }
  return listLocalAssignableBeds(event, excludeBedIds);
}

function roomingAvailRoomsGrouped(event) {
  var byRoom = {};
  roomingListAssignableBeds(event, []).forEach(function (bed) {
    if (!byRoom[bed.room_id]) {
      byRoom[bed.room_id] = {
        id: bed.room_id,
        name: bed.room_name,
        location: bed.location,
        dorm_type: bed.dorm_type,
        avail_beds: 0,
      };
    }
    byRoom[bed.room_id].avail_beds++;
  });
  return Object.values(byRoom).sort(function (a, b) {
    var da = a.dorm_type === "男寮" ? 1 : a.dorm_type === "女寮" ? 2 : 3;
    var db = b.dorm_type === "男寮" ? 1 : b.dorm_type === "女寮" ? 2 : 3;
    if (da !== db) return da - db;
    return (a.location || "").localeCompare(b.location || "", "zh-CN");
  });
}

function roomingQueueAssignAlreadyDone(item) {
  if (!item || !item.member_ref_id) return false;
  if (item.member_kind === "lodger") {
    if (roomingReadReady()) {
      var lodger = rcLodgerById(item.member_ref_id);
      return !!(
        lodger &&
        lodger.status === "在住" &&
        lodger.bed_id == item.suggested_bed_id
      );
    }
    var lrow = query(
      "SELECT bed_id FROM lodgers WHERE id=? AND status='在住'",
      [item.member_ref_id],
    )[0];
    return !!(lrow && lrow.bed_id == item.suggested_bed_id);
  }
  if (item.member_kind === "reservation") {
    if (roomingReadReady()) {
      var resv = rcRows("reservations", "reservations").find(function (r) {
        return r.id == item.member_ref_id;
      });
      return !!(resv && resv.status === "已入住");
    }
    var rrow = query("SELECT status FROM reservations WHERE id=?", [
      item.member_ref_id,
    ])[0];
    return !!(rrow && rrow.status === "已入住");
  }
  return false;
}

function roomingLodgerEventRow(lodgerId) {
  if (roomingReadReady()) {
    return rcLodgerById(lodgerId);
  }
  return query("SELECT event_id, name FROM lodgers WHERE id=?", [lodgerId])[0];
}

/** 排房写后刷新 event 读模型 | Post rooming write refresh */
async function roomingRefreshAfterWrite(eventId, writeResult, options) {
  if (typeof rcInvalidateEventRooming === "function") {
    rcInvalidateEventRooming(eventId);
  }
  if (typeof rcInvalidate === "function") {
    rcInvalidate("events");
  }
  if (eventId && roomingReadReady()) {
    try {
      await rcEnsureEventRooming(eventId, true);
    } catch (e) {
      console.warn("rooming refetch failed:", e.message || e);
    }
  }
  if (typeof refreshAfterWrite !== "function") return;
  var opts = Object.assign(
    {
      infoOnly: true,
      infoTab: "events",
      quietSync: true,
      skipModuleSync: true,
    },
    options || {},
  );
  return refreshAfterWrite(writeResult, opts);
}
