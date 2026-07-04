/* 在线读 shim：本地 query / 云端 rc* | Read shim for local SQL vs online rc */

function readUseRc() {
  return (
    typeof useOnlineDataPath === "function" &&
    useOnlineDataPath() &&
    typeof rcReadReady === "function" &&
    rcReadReady()
  );
}

/** 在线 rc 尚未就绪：禁止 query()，返回空值 | Online before rc cache warm */
function readOnlineCachePending() {
  return (
    typeof useOnlineDataPath === "function" &&
    useOnlineDataPath() &&
    !readUseRc()
  );
}

/** 本地/灾备专用 query；在线路径永不调用 sql.js | Local-only query fallback */
function readLocalQuery(defaultValue, fn) {
  if (typeof useOnlineDataPath === "function" && useOnlineDataPath()) {
    return defaultValue;
  }
  return fn();
}

function readLodger(id) {
  if (readUseRc()) return rcLodgerById(id);
  if (readOnlineCachePending()) return null;
  return readLocalQuery(null, function () {
    return query("SELECT * FROM lodgers WHERE id=?", [id])[0] || null;
  });
}

function readLodgerEnriched(id) {
  if (readUseRc()) return rcEnrichLodgerRow(rcLodgerById(id));
  if (readOnlineCachePending()) return null;
  return readLocalQuery(null, function () {
    return (
      query(
        "SELECT l.*, e.name as event_name, r.name as room_name, b.bed_number, r.location, r.dorm_type FROM lodgers l LEFT JOIN events e ON e.id=l.event_id LEFT JOIN beds b ON b.id=l.bed_id LEFT JOIN rooms r ON r.id=b.room_id WHERE l.id=?",
        [id],
      )[0] || null
    );
  });
}

function readGuest(id) {
  if (readUseRc()) return rcGuestById(id);
  if (readOnlineCachePending()) return null;
  return readLocalQuery(null, function () {
    return query("SELECT * FROM guests WHERE id=?", [id])[0] || null;
  });
}

function readBedJoined(bedId) {
  if (readUseRc()) return rcBedJoined(bedId);
  if (readOnlineCachePending()) return null;
  return readLocalQuery(null, function () {
    return (
      query(
        "SELECT b.*, r.name as room_name, r.dorm_type, r.location FROM beds b JOIN rooms r ON r.id=b.room_id WHERE b.id=?",
        [bedId],
      )[0] || null
    );
  });
}

function readReservation(id) {
  if (readUseRc()) return rcReservationById(id);
  if (readOnlineCachePending()) return null;
  return readLocalQuery(null, function () {
    return query("SELECT * FROM reservations WHERE id=?", [id])[0] || null;
  });
}

function readPaymentsForLodger(lodgerId) {
  if (readUseRc()) return rcPaymentsForLodger(lodgerId);
  if (readOnlineCachePending()) return [];
  return readLocalQuery([], function () {
    return query("SELECT * FROM payments WHERE lodger_id=?", [lodgerId]);
  });
}

function readMealsForLodger(lodgerId) {
  if (readUseRc()) return rcMealsForLodger(lodgerId);
  if (readOnlineCachePending()) return [];
  return readLocalQuery([], function () {
    return query("SELECT * FROM meals WHERE lodger_id=?", [lodgerId]);
  });
}

function readPaidTotal(lodgerId) {
  if (readUseRc()) return rcPaidTotalForLodger(lodgerId);
  if (readOnlineCachePending()) return 0;
  return readLocalQuery(0, function () {
    return (
      query(
        "SELECT COALESCE(SUM(amount),0) as total FROM payments WHERE lodger_id=?",
        [lodgerId],
      )[0]?.total || 0
    );
  });
}

function readUnassignedLodgers() {
  if (readUseRc()) return rcUnassignedLodgers();
  if (readOnlineCachePending()) return [];
  return readLocalQuery([], function () {
    return query(`
    SELECT l.*, e.name as event_name FROM lodgers l
    LEFT JOIN events e ON e.id=l.event_id
    WHERE l.status='在住' AND (l.bed_id IS NULL OR l.bed_id=0)
    ORDER BY l.check_in_date DESC, l.id DESC
  `);
  });
}

function readUnassignedReservations() {
  if (readUseRc()) return rcUnassignedReservations();
  if (readOnlineCachePending()) return [];
  return readLocalQuery([], function () {
    return query(`
    SELECT r.*, e.name as event_name FROM reservations r
    LEFT JOIN events e ON e.id=r.event_id
    WHERE r.status IN ('预约','已确认') AND (r.bed_id IS NULL OR r.bed_id=0)
    ORDER BY r.expected_check_in ASC, r.id ASC
  `);
  });
}

function readRoomById(roomId) {
  if (readUseRc()) return rcRoomById(roomId);
  if (readOnlineCachePending()) return null;
  return readLocalQuery(null, function () {
    return query("SELECT * FROM rooms WHERE id=?", [roomId])[0] || null;
  });
}

function readActiveLodgerCount() {
  if (readUseRc()) {
    return rcBoardLodgers().filter(function (l) {
      return l.status === "在住";
    }).length;
  }
  if (readOnlineCachePending()) return 0;
  return readLocalQuery(0, function () {
    return (
      query("SELECT COUNT(*) as c FROM lodgers WHERE status='在住'")[0]?.c || 0
    );
  });
}

function readPaymentSummary(lodgerId) {
  if (readUseRc()) return rcPaymentSummary(lodgerId);
  if (readOnlineCachePending()) {
    return { income: 0, refund: 0, refund_total: 0, balance: 0 };
  }
  return readLocalQuery(
    { income: 0, refund: 0, refund_total: 0, balance: 0 },
    function () {
      var row =
        query(
          "SELECT COALESCE(SUM(CASE WHEN type IN ('押金','房费') THEN amount ELSE 0 END), 0) as income, COALESCE(SUM(CASE WHEN type = '退款' THEN amount ELSE 0 END), 0) as refund FROM payments WHERE lodger_id = ?",
          [lodgerId],
        )[0] || {};
      return {
        income: row.income || 0,
        refund: row.refund || 0,
        refund_total: row.refund || 0,
        balance: (row.income || 0) - (row.refund || 0),
      };
    },
  );
}

function readLodgerForVoucher(id) {
  var l = readLodgerEnriched(id);
  if (!l) return null;
  if (readUseRc()) {
    var pays = rcPaymentsForLodger(id);
    var deposit = 0;
    var roomFee = 0;
    pays.forEach(function (p) {
      if (p.type === "押金") deposit += parseFloat(p.amount) || 0;
      if (p.type === "房费") roomFee += parseFloat(p.amount) || 0;
    });
    return Object.assign({}, l, { deposit: deposit, room_fee: roomFee });
  }
  if (readOnlineCachePending()) return null;
  return readLocalQuery(null, function () {
    return (
      query(
        "SELECT l.*, r.name as room_name, b.bed_number, (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE lodger_id = l.id AND type = '押金') as deposit, (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE lodger_id = l.id AND type = '房费') as room_fee FROM lodgers l LEFT JOIN beds b ON b.id = l.bed_id LEFT JOIN rooms r ON r.id = b.room_id WHERE l.id = ?",
        [id],
      )[0] || null
    );
  });
}

/** 用斋：在寺挂单（入住日 ≤ date）| In-house lodgers up to date */
function readLodgersInHouseUpToDate(date) {
  if (readUseRc()) {
    return rcAllLodgersMerged().filter(function (l) {
      return l.status === "在住" && l.check_in_date <= date;
    });
  }
  if (readOnlineCachePending()) return [];
  return readLocalQuery([], function () {
    return query(
      "SELECT * FROM lodgers WHERE status = '在住' AND check_in_date <= ? ORDER BY role, name",
      [date],
    );
  });
}

/** 用斋：当日预计到达预约 | Reservations checking in on date */
function readReservationsCheckInOn(date) {
  if (readUseRc()) {
    return rcRows("reservations", "reservations").filter(function (r) {
      return (
        r.expected_check_in === date &&
        (r.status === "预约" || r.status === "已确认")
      );
    });
  }
  if (readOnlineCachePending()) return [];
  return readLocalQuery([], function () {
    return query(
      "SELECT * FROM reservations WHERE expected_check_in = ? AND status IN ('预约', '已确认') ORDER BY role, name",
      [date],
    );
  });
}

/** 用斋：在寺挂单含房间信息 | In-house lodgers with room join */
function readLodgersInHouseUpToDateEnriched(date) {
  if (readUseRc()) {
    return rcAllLodgersMerged()
      .filter(function (l) {
        return l.status === "在住" && l.check_in_date <= date;
      })
      .map(rcEnrichLodgerRow)
      .map(function (l) {
        if (l.bed_id && !l.room_id) {
          var bed = rcBoardBeds().find(function (b) {
            return b.id == l.bed_id;
          });
          if (bed) l.room_id = bed.room_id;
        }
        return l;
      });
  }
  if (readOnlineCachePending()) return [];
  return readLocalQuery([], function () {
    return query(
      "SELECT l.*, r.name as room_name, r.id as room_id FROM lodgers l LEFT JOIN beds b ON b.id = l.bed_id LEFT JOIN rooms r ON r.id = b.room_id WHERE l.status = '在住' AND l.check_in_date <= ?",
      [date],
    );
  });
}

function readMealFlagsRow(lodgerId, date) {
  if (readUseRc()) {
    var row = rcRows("meals", "meals").find(function (m) {
      return m.lodger_id == lodgerId && m.date === date;
    });
    return row
      ? { breakfast: row.breakfast, lunch: row.lunch, dinner: row.dinner }
      : null;
  }
  if (readOnlineCachePending()) return null;
  return readLocalQuery(null, function () {
    return (
      query(
        "SELECT breakfast, lunch, dinner FROM meals WHERE lodger_id=? AND date=?",
        [lodgerId, date],
      )[0] || null
    );
  });
}

function readFirstMealDefaultsRow(lodgerId) {
  if (readUseRc()) {
    var rows = rcMealsForLodger(lodgerId);
    if (!rows.length) return null;
    rows.sort(function (a, b) {
      return String(a.date).localeCompare(String(b.date));
    });
    return rows[0];
  }
  if (readOnlineCachePending()) return null;
  return readLocalQuery(null, function () {
    return (
      query(
        "SELECT breakfast, lunch, dinner FROM meals WHERE lodger_id=? ORDER BY date LIMIT 1",
        [lodgerId],
      )[0] || null
    );
  });
}

function readEventById(id) {
  if (readUseRc() && typeof rcEventById === "function") {
    return rcEventById(id);
  }
  if (readOnlineCachePending()) return null;
  return readLocalQuery(null, function () {
    return query("SELECT * FROM events WHERE id = ?", [id])[0] || null;
  });
}

function readEventListWithStats() {
  if (
    typeof rcEventListWithStats === "function" &&
    typeof rcModuleCached === "function" &&
    rcModuleCached("events")
  ) {
    return rcEventListWithStats();
  }
  if (readUseRc() && typeof rcEventListWithStats === "function") {
    return rcEventListWithStats();
  }
  if (readOnlineCachePending()) return [];
  return readLocalQuery([], function () {
    return query(`
    SELECT e.*,
      (SELECT COUNT(*) FROM lodgers l WHERE l.event_id = e.id AND l.status = '在住') as checked_in,
      (SELECT COUNT(*) FROM reservations r WHERE r.event_id = e.id AND r.status IN ('预约','已确认')) as reserved,
      (SELECT COUNT(*) FROM lodgers l2 WHERE l2.event_id = e.id) as total_lodgers
    FROM events e
    ORDER BY e.start_date DESC, e.id DESC
  `);
  });
}

function readEventMemberLodgers(eventId) {
  if (readUseRc()) {
    return rcAllLodgersMerged()
      .filter(function (l) {
        return l.event_id == eventId && l.status === "在住";
      })
      .map(function (l) {
        var row =
          typeof rcEnrichLodgerRow === "function" ? rcEnrichLodgerRow(l) : l;
        return Object.assign({}, row, { kind: "lodger" });
      });
  }
  if (readOnlineCachePending()) return [];
  return readLocalQuery([], function () {
    return query(
      "SELECT l.id, l.name, l.dharma_name, l.gender, l.check_in_date, l.expected_check_out, l.role, l.class_name, l.participant_identity, l.age_group, l.status, r.name as room_name, b.bed_number, 'lodger' as kind FROM lodgers l LEFT JOIN beds b ON b.id = l.bed_id LEFT JOIN rooms r ON r.id = b.room_id WHERE l.event_id = ? AND l.status = '在住' ORDER BY l.status, l.name",
      [eventId],
    );
  });
}

function readEventMemberReservations(eventId) {
  if (readUseRc()) {
    return rcRows("reservations", "reservations")
      .filter(function (r) {
        return (
          r.event_id == eventId &&
          (r.status === "预约" || r.status === "已确认")
        );
      })
      .map(function (r) {
        return Object.assign({}, r, { kind: "reservation" });
      });
  }
  if (readOnlineCachePending()) return [];
  return readLocalQuery([], function () {
    return query(
      "SELECT r.id, r.name, r.dharma_name, r.gender, r.expected_check_in, r.expected_check_out, r.role, r.class_name, r.participant_identity, r.age_group, r.status, r.room_preference, 'reservation' as kind FROM reservations r WHERE r.event_id = ? AND r.status IN ('预约', '已确认') ORDER BY r.expected_check_in, r.name",
      [eventId],
    );
  });
}

function readEventMemberReservationsForExport(eventId) {
  if (readUseRc()) {
    return rcRows("reservations", "reservations")
      .filter(function (r) {
        return r.event_id == eventId;
      })
      .map(function (r) {
        return Object.assign({}, r, { kind: "reservation" });
      });
  }
  if (readOnlineCachePending()) return [];
  return readLocalQuery([], function () {
    return query(
      "SELECT r.name, r.dharma_name, r.gender, r.phone, r.expected_check_in, r.expected_check_out, r.role, r.class_name, r.participant_identity, r.age_group, r.special_needs, r.status, '' as room_name, '' as bed_number, 'reservation' as kind FROM reservations r WHERE r.event_id = ? ORDER BY r.status, r.name",
      [eventId],
    );
  });
}

function readEventMemberGenders(eventId) {
  if (readUseRc() && typeof rcEventMembers === "function") {
    var pack = rcEventMembers(eventId);
    if (!pack) return [];
    var members = [];
    pack.lodgers.forEach(function (l) {
      members.push({ gender: l.gender });
    });
    pack.reservations.forEach(function (r) {
      members.push({ gender: r.gender });
    });
    return members;
  }
  if (readOnlineCachePending()) return [];
  return readLocalQuery([], function () {
    return query(
      "SELECT gender FROM lodgers WHERE event_id = ? AND status = '在住' UNION ALL SELECT gender FROM reservations WHERE event_id = ? AND status IN ('预约', '已确认')",
      [eventId, eventId],
    );
  });
}

function readEventRelatedCount(eventId) {
  if (readUseRc()) {
    var lodgers = rcAllLodgersMerged().filter(function (l) {
      return l.event_id == eventId;
    }).length;
    var resvs = rcRows("reservations", "reservations").filter(function (r) {
      return r.event_id == eventId;
    }).length;
    return lodgers + resvs;
  }
  if (readOnlineCachePending()) return 0;
  return readLocalQuery(0, function () {
    return (
      (query("SELECT COUNT(*) as c FROM lodgers WHERE event_id = ?", [
        eventId,
      ])[0]?.c || 0) +
      (query("SELECT COUNT(*) as c FROM reservations WHERE event_id = ?", [
        eventId,
      ])[0]?.c || 0)
    );
  });
}

function readEventByName(name) {
  if (readUseRc()) {
    var rows = rcRows("events", "events").filter(function (e) {
      return e.name === name;
    });
    if (rows.length) return rows[0];
    rows = rcRows("events", "events").filter(function (e) {
      return e.name && e.name.indexOf(name) >= 0;
    });
    return rows.length ? rows[0] : null;
  }
  if (readOnlineCachePending()) return null;
  return readLocalQuery(null, function () {
    var rows = query("SELECT * FROM events WHERE name = ? LIMIT 1", [name]);
    if (rows.length) return rows[0];
    return (
      query("SELECT * FROM events WHERE name LIKE ? LIMIT 1", [
        "%" + name + "%",
      ])[0] || null
    );
  });
}

function readFindEventByName(name) {
  if (!name) return null;
  if (readUseRc() && typeof rcFindEventByName === "function") {
    return rcFindEventByName(name);
  }
  return readEventByName(String(name).trim());
}

function readEventsForSelect() {
  if (readUseRc() && typeof rcEventsForSelect === "function") {
    return rcEventsForSelect();
  }
  if (readOnlineCachePending()) return [];
  return readLocalQuery([], function () {
    return query(
      "SELECT id, name, event_type, status FROM events WHERE status != '已取消' ORDER BY start_date DESC, id DESC",
    );
  });
}

function readAvailRoomsGroupedForEvent(evt) {
  if (readUseRc()) {
    if (typeof roomingAvailRoomsGrouped === "function") {
      return roomingAvailRoomsGrouped(evt);
    }
    return [];
  }
  if (readOnlineCachePending()) return [];
  const requireInspect =
    typeof housekeepingRequiresInspect === "function" &&
    housekeepingRequiresInspect();
  const hkStatuses = requireInspect ? "('可用')" : "('净房','可用')";
  const includeSpare = !!evt.include_spare_beds;
  const spareSql = spareRoomExcludeClause("r", includeSpare);
  return readLocalQuery([], function () {
    return query(
      "SELECT r.id, r.name, r.location, r.dorm_type, COUNT(b.id) as avail_beds FROM rooms r JOIN beds b ON b.room_id = r.id LEFT JOIN lodgers l ON l.bed_id = b.id AND l.status='在住' WHERE b.status != '维修' AND b.status != '备用' AND l.id IS NULL AND " +
        spareSql +
        " AND COALESCE((SELECT status FROM housekeeping WHERE bed_id = b.id ORDER BY changed_at DESC LIMIT 1), '净房') IN " +
        hkStatuses +
        " GROUP BY r.id HAVING avail_beds > 0 ORDER BY CASE r.dorm_type WHEN '男寮' THEN 1 WHEN '女寮' THEN 2 ELSE 3 END, r.location, r.name",
    );
  });
}
