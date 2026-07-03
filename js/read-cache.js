/* 读模块 API 缓存 | Read-module JSON cache (online-only read path) */

var _rcStore = {};
var _rcInflight = {};

function rcUseApiRead() {
  return typeof isRemoteDB === "function" && isRemoteDB();
}

function rcTables(moduleKey) {
  return (_rcStore[moduleKey] && _rcStore[moduleKey].tables) || {};
}

function rcRows(moduleKey, table) {
  var rows = rcTables(moduleKey)[table];
  return Array.isArray(rows) ? rows : [];
}

function rcInvalidate(moduleKey) {
  if (moduleKey) delete _rcStore[moduleKey];
  else _rcStore = {};
}

function rcStorePayload(moduleKey, payload) {
  if (moduleKey && payload) _rcStore[moduleKey] = payload;
}

function rcInvalidateMany(keys) {
  (keys || []).forEach(function (k) {
    rcInvalidate(k);
  });
}

async function rcFetch(moduleKey, force) {
  if (!rcUseApiRead()) return null;
  if (!moduleKey) return null;
  if (!force && _rcStore[moduleKey]) return _rcStore[moduleKey];
  if (_rcInflight[moduleKey]) return _rcInflight[moduleKey];
  _rcInflight[moduleKey] = apiReadModule(moduleKey, null)
    .then(function (payload) {
      _rcStore[moduleKey] = payload || {};
      if (
        payload &&
        payload.board_version != null &&
        typeof setLocalBoardVersion === "function"
      ) {
        setLocalBoardVersion(payload.board_version);
      }
      return payload;
    })
    .finally(function () {
      delete _rcInflight[moduleKey];
    });
  return _rcInflight[moduleKey];
}

async function rcFetchMany(moduleKeys, force) {
  var keys = moduleKeys || [];
  for (var i = 0; i < keys.length; i++) {
    await rcFetch(keys[i], force);
  }
}

/** 写后刷新：invalidate + refetch | Post-write module refresh */
async function rcRefreshAfterWrite(moduleKeys, writeResult) {
  if (typeof touchBoardVersionFromWrite === "function") {
    touchBoardVersionFromWrite(writeResult);
  }
  rcInvalidateMany(moduleKeys);
  await rcFetchMany(moduleKeys, true);
}

/* ── board 模块派生 | Board module derivations ── */

function rcBoardRooms() {
  return rcRows("board", "rooms").slice().sort(function (a, b) {
    var fa = a.floor || 0;
    var fb = b.floor || 0;
    if (fa !== fb) return fa - fb;
    return (a.id || 0) - (b.id || 0);
  });
}

function rcBoardBeds() {
  return rcRows("board", "beds");
}

function rcBoardLodgers() {
  return rcRows("board", "lodgers");
}

function rcBoardHousekeeping() {
  return rcRows("board", "housekeeping");
}

function rcLodgerOnBed(bedId) {
  if (!bedId) return null;
  return (
    rcBoardLodgers().find(function (l) {
      return l.bed_id == bedId && l.status === "在住";
    }) || null
  );
}

function rcLatestHkStatus(bedId) {
  if (!bedId) return "净房";
  var rows = rcBoardHousekeeping().filter(function (h) {
    return h.bed_id == bedId;
  });
  rows.sort(function (a, b) {
    return String(b.changed_at || "").localeCompare(String(a.changed_at || ""));
  });
  return (rows[0] && rows[0].status) || "净房";
}

function rcBedsForRoom(roomId, options) {
  options = options || {};
  var excludeId = parseInt(options.excludeBedId, 10) || -1;
  return rcBoardBeds()
    .filter(function (b) {
      if (String(b.room_id) !== String(roomId)) return false;
      if (b.id == excludeId) return false;
      if (options.skipSpare && b.status === "备用") return false;
      if (options.skipMaint && b.status === "维修") return false;
      return true;
    })
    .sort(function (a, b) {
      return (a.id || 0) - (b.id || 0);
    });
}

function rcRoomBedStats(roomId, excludeBedId) {
  var excludeId = parseInt(excludeBedId, 10) || -1;
  var total = 0;
  var avail = 0;
  rcBoardBeds().forEach(function (b) {
    if (String(b.room_id) !== String(roomId)) return;
    if (b.status === "备用") return;
    total++;
    if (b.id == excludeId) return;
    if (b.status === "维修") return;
    if (rcLodgerOnBed(b.id)) return;
    var hk = rcLatestHkStatus(b.id);
    if (hk !== "净房" && hk !== "可用") return;
    avail++;
  });
  return { total_beds: total, avail: avail };
}

function rcBoardRoomsWithStats(excludeBedId, options) {
  options = options || {};
  var gender = options.gender || "";
  return rcBoardRooms()
    .map(function (r) {
      var stats = rcRoomBedStats(r.id, excludeBedId);
      return Object.assign({}, r, stats);
    })
    .filter(function (r) {
      if (options.spareRoomFilter !== false && typeof isSpareRoom === "function" && isSpareRoom(r))
        return false;
      if (gender === "男" && r.dorm_type === "女寮") return false;
      if (gender === "女" && r.dorm_type === "男寮") return false;
      return (r.total_beds || 0) > 0;
    });
}

function rcBedRowEnriched(b, idx) {
  var lodger = rcLodgerOnBed(b.id);
  var hk = rcLatestHkStatus(b.id);
  return Object.assign({}, b, {
    lodger_id: lodger ? lodger.id : null,
    name: lodger ? lodger.name : null,
    dharma_name: lodger ? lodger.dharma_name : null,
    gender: lodger ? lodger.gender : null,
    hk_status: hk,
    _bedIdx: idx,
  });
}

function rcBedsForRoomEnriched(roomId) {
  return rcBedsForRoom(roomId, { skipSpare: true }).map(function (b, idx) {
    return rcBedRowEnriched(b, idx);
  });
}

/** 看板 KPI | Board KPI from read-cache */
function rcGetBoardBedStats() {
  var total = 0;
  var occupied = 0;
  var dirty = 0;
  rcBoardRooms().forEach(function (r) {
    if (typeof isSpareRoom === "function" && isSpareRoom(r)) return;
    rcBedsForRoom(r.id, { skipSpare: true }).forEach(function (b) {
      total++;
      if (rcLodgerOnBed(b.id)) occupied++;
      else if (rcLatestHkStatus(b.id) === "脏房") dirty++;
    });
  });
  var empty = Math.max(0, total - occupied);
  var cleanEmpty = Math.max(0, empty - dirty);
  var lodgerCount = rcBoardLodgers().filter(function (l) {
    return l.status === "在住";
  }).length;
  var today = typeof todayStr === "function" ? todayStr() : "";
  var resvToday = 0;
  rcRows("reservations", "reservations").forEach(function (rv) {
    if (
      rv.expected_check_in === today &&
      (rv.status === "预约" || rv.status === "已确认")
    ) {
      resvToday++;
    }
  });
  var occPct = total ? Math.round((occupied / total) * 100) : 0;
  return {
    total: total,
    occupied: occupied,
    empty: empty,
    dirty: dirty,
    cleanEmpty: cleanEmpty,
    lodgerCount: lodgerCount,
    resvToday: resvToday,
    occPct: occPct,
  };
}

/** 今日到离流 | Today flow counts from read-cache */
function rcGetBoardFlowStats(today) {
  var day = today || (typeof todayStr === "function" ? todayStr() : "");
  var lodgers = rcBoardLodgers();
  var expArrive = 0;
  rcRows("reservations", "reservations").forEach(function (rv) {
    if (
      rv.expected_check_in === day &&
      (rv.status === "预约" || rv.status === "已确认")
    ) {
      expArrive++;
    }
  });
  lodgers.forEach(function (l) {
    if (l.check_in_date === day && l.status === "在住") expArrive++;
  });
  var expDepart = 0;
  var actArrive = 0;
  var actDepart = 0;
  lodgers.forEach(function (l) {
    if (l.expected_check_out === day && l.status === "在住") expDepart++;
    if (l.check_in_date === day && l.status === "在住") actArrive++;
    if (l.actual_check_out === day) actDepart++;
  });
  return {
    expArrive: expArrive,
    expDepart: expDepart,
    actArrive: actArrive,
    actDepart: actDepart,
  };
}

/** 男女寮床位占用 | Dorm-type bed counts from read-cache */
function rcGetDormBedStats() {
  var maleBeds = 0;
  var femaleBeds = 0;
  var maleOcc = 0;
  var femaleOcc = 0;
  var roomsById = {};
  rcBoardRooms().forEach(function (r) {
    roomsById[r.id] = r;
  });
  rcBoardBeds().forEach(function (b) {
    if (b.status === "维修" || b.status === "备用") return;
    var room = roomsById[b.room_id];
    if (!room || (typeof isSpareRoom === "function" && isSpareRoom(room))) return;
    if (room.dorm_type === "男寮") maleBeds++;
    else if (room.dorm_type === "女寮") femaleBeds++;
    if (rcLodgerOnBed(b.id)) {
      if (room.dorm_type === "男寮") maleOcc++;
      else if (room.dorm_type === "女寮") femaleOcc++;
    }
  });
  return {
    maleBeds: maleBeds,
    femaleBeds: femaleBeds,
    maleOcc: maleOcc,
    femaleOcc: femaleOcc,
  };
}

/** 在住列表（含房床字段）| Active lodgers with room/bed labels */
function rcActiveLodgersEnriched() {
  var roomsById = {};
  rcBoardRooms().forEach(function (r) {
    roomsById[r.id] = r;
  });
  var bedsById = {};
  rcBoardBeds().forEach(function (b) {
    bedsById[b.id] = b;
  });
  return rcBoardLodgers()
    .filter(function (l) {
      return l.status === "在住";
    })
    .map(function (l) {
      var bed = bedsById[l.bed_id];
      var room = bed ? roomsById[bed.room_id] : null;
      return Object.assign({}, l, {
        room_name: room ? room.name : null,
        location: room ? room.location : null,
        bed_number: bed ? bed.bed_number : null,
        dorm_type: room ? room.dorm_type : null,
      });
    })
    .sort(function (a, b) {
      var da = a.check_in_date || "";
      var db = b.check_in_date || "";
      if (da !== db) return db.localeCompare(da);
      return (b.id || 0) - (a.id || 0);
    });
}

function boardReadCacheReady() {
  return (
    typeof rcReadReady === "function" &&
    rcReadReady() &&
    rcBoardRooms().length > 0
  );
}

/** 营期列表（报表/下拉）| Active events for selects */
function rcEventsForSelect() {
  return rcRows("events", "events")
    .filter(function (e) {
      return e.status !== "已取消";
    })
    .sort(function (a, b) {
      var sa = a.start_date || "";
      var sb = b.start_date || "";
      if (sa !== sb) return sb.localeCompare(sa);
      return (b.id || 0) - (a.id || 0);
    });
}

/** 退房提醒分组 | Checkout reminder rows by tab key */
function rcCheckoutReminders(key, date) {
  var today = typeof todayStr === "function" ? todayStr() : "";
  var rows = rcActiveLodgersEnriched().filter(function (l) {
    if (!l.expected_check_out) return false;
    if (key === "overdue") return l.expected_check_out < today;
    return l.expected_check_out === date;
  });
  if (key === "overdue") {
    rows.sort(function (a, b) {
      return (a.expected_check_out || "").localeCompare(
        b.expected_check_out || "",
      );
    });
  } else {
    rows.sort(function (a, b) {
      return (a.room_name || "").localeCompare(b.room_name || "", "zh-CN");
    });
  }
  return rows;
}

/** 运营动态摘要 | Ops notice derived stats */
function rcOpsNoticeData(today) {
  var day = today || (typeof todayStr === "function" ? todayStr() : "");
  var flow = rcGetBoardFlowStats(day);
  var changeRoomIds = {};
  rcActiveLodgersEnriched().forEach(function (l) {
    if (l.expected_check_out !== day || !l.bed_id) return;
    var bed = rcBoardBeds().find(function (b) {
      return b.id == l.bed_id;
    });
    if (bed) changeRoomIds[bed.room_id] = true;
  });
  rcRows("reservations", "reservations").forEach(function (res) {
    if (
      res.expected_check_in !== day ||
      (res.status !== "预约" && res.status !== "已确认")
    )
      return;
    rcBoardRooms().forEach(function (room) {
      if (typeof isSpareRoom === "function" && isSpareRoom(room)) return;
      if (res.gender === "男" && room.dorm_type !== "男寮") return;
      if (res.gender === "女" && room.dorm_type !== "女寮") return;
      changeRoomIds[room.id] = true;
    });
  });
  var endDate = typeof dateStr === "function" ? dateStr(7) : day;
  var lodgersAll = rcBoardLodgers().concat(rcRows("lodgers", "lodgers"));
  var resvs = rcRows("reservations", "reservations");
  var eventAlerts = rcRows("events", "events")
    .filter(function (e) {
      if (e.status !== "筹备中" && e.status !== "招生中") return false;
      if (!e.start_date || e.start_date < day || e.start_date > endDate)
        return false;
      if (!e.expected_count || e.expected_count <= 0) return false;
      var checkedIn = 0;
      var reserved = 0;
      lodgersAll.forEach(function (l) {
        if (l.event_id == e.id && l.status === "在住") checkedIn++;
      });
      resvs.forEach(function (r) {
        if (
          r.event_id == e.id &&
          (r.status === "预约" || r.status === "已确认")
        )
          reserved++;
      });
      return checkedIn + reserved < e.expected_count;
    })
    .map(function (e) {
      var checkedIn = 0;
      var reserved = 0;
      lodgersAll.forEach(function (l) {
        if (l.event_id == e.id && l.status === "在住") checkedIn++;
      });
      resvs.forEach(function (r) {
        if (
          r.event_id == e.id &&
          (r.status === "预约" || r.status === "已确认")
        )
          reserved++;
      });
      return Object.assign({}, e, {
        checked_in: checkedIn,
        reserved: reserved,
      });
    })
    .sort(function (a, b) {
      return (a.start_date || "").localeCompare(b.start_date || "");
    });
  var dirtyBeds = [];
  var roomsById = {};
  rcBoardRooms().forEach(function (r) {
    roomsById[r.id] = r;
  });
  rcBoardBeds().forEach(function (b) {
    if (b.status === "备用") return;
    var room = roomsById[b.room_id];
    if (!room || (typeof isSpareRoom === "function" && isSpareRoom(room)))
      return;
    if (rcLatestHkStatus(b.id) === "脏房") {
      dirtyBeds.push({
        room_name: room.name,
        bed_number: b.bed_number,
      });
    }
  });
  return {
    arrivals: flow.expArrive,
    departures: flow.expDepart,
    changeRooms: Object.keys(changeRoomIds).length,
    eventAlerts: eventAlerts,
    dirtyBeds: dirtyBeds.slice(0, 3),
  };
}

/** 在线读模型已就绪 | Online read model ready for rc* paths */
function rcReadReady() {
  return (
    typeof rcUseApiRead === "function" &&
    rcUseApiRead() &&
    typeof remoteReadModelReady !== "undefined" &&
    remoteReadModelReady
  );
}

function rcEventsById() {
  var map = {};
  rcRows("events", "events").forEach(function (e) {
    map[e.id] = e;
  });
  return map;
}

function rcAllLodgersMerged() {
  var byId = {};
  rcBoardLodgers().forEach(function (l) {
    byId[l.id] = l;
  });
  rcRows("lodgers", "lodgers").forEach(function (l) {
    byId[l.id] = l;
  });
  return Object.values(byId);
}

function rcLodgerById(id) {
  if (!id) return null;
  return (
    rcBoardLodgers().find(function (l) {
      return l.id == id;
    }) ||
    rcRows("lodgers", "lodgers").find(function (l) {
      return l.id == id;
    }) ||
    null
  );
}

function rcEnrichLodgerRow(l) {
  if (!l) return l;
  var events = rcEventsById();
  var bed = rcBoardBeds().find(function (b) {
    return b.id == l.bed_id;
  });
  var room = bed
    ? rcBoardRooms().find(function (r) {
        return r.id == bed.room_id;
      })
    : null;
  return Object.assign({}, l, {
    event_name: l.event_id ? events[l.event_id]?.name || null : null,
    room_name: room ? room.name : null,
    bed_number: bed ? bed.bed_number : null,
    location: room ? room.location : null,
    dorm_type: room ? room.dorm_type : null,
  });
}

function rcEnrichReservationRow(r) {
  if (!r) return r;
  var events = rcEventsById();
  return Object.assign({}, r, {
    event_name: r.event_id ? events[r.event_id]?.name || null : null,
  });
}

/** 信息管理 Tab → 需刷新的读模块 | Info tab → read modules to sync */
var RC_INFO_TAB_MODULES = {
  rooms: ["settings_rooms", "settings_beds", "board"],
  beds: ["settings_beds", "lodgers", "board"],
  guests: ["settings_guests"],
  lodgers: ["lodgers", "lodgers_records", "board"],
  events: ["events", "lodgers", "reservations", "board"],
};

function rcModulesForInfoTab(tab) {
  var keys = RC_INFO_TAB_MODULES[tab];
  return keys ? keys.slice() : [];
}

function rcInvalidateForInfoTab(tab) {
  rcInvalidateMany(rcModulesForInfoTab(tab));
}

function rcEventById(id) {
  if (!id) return null;
  return (
    rcRows("events", "events").find(function (e) {
      return e.id == id;
    }) || null
  );
}

/** 营期成员（在住 + 预约）| Event members for member panel */
function rcEventMembers(eventId) {
  if (!eventId) return null;
  var evt = rcEventById(eventId);
  if (!evt) return null;
  var lodgers = rcAllLodgersMerged()
    .filter(function (l) {
      return l.event_id == eventId && l.status === "在住";
    })
    .map(rcEnrichLodgerRow)
    .map(function (l) {
      return Object.assign({}, l, { kind: "lodger" });
    })
    .sort(function (a, b) {
      return (a.name || "").localeCompare(b.name || "", "zh-CN");
    });
  var reservations = rcRows("reservations", "reservations")
    .filter(function (r) {
      return (
        r.event_id == eventId &&
        (r.status === "预约" || r.status === "已确认")
      );
    })
    .map(function (r) {
      return Object.assign({}, r, { kind: "reservation" });
    })
    .sort(function (a, b) {
      var da = a.expected_check_in || "";
      var db = b.expected_check_in || "";
      if (da !== db) return da.localeCompare(db);
      return (a.name || "").localeCompare(b.name || "", "zh-CN");
    });
  return {
    evt: evt,
    lodgers: lodgers,
    reservations: reservations,
    members: lodgers.concat(reservations),
  };
}

/** 不限寮空床房间（流量预测调剂提示）| Flex dorm empty rooms */
function rcFlexEmptyRooms() {
  var byRoom = {};
  rcBoardRooms().forEach(function (r) {
    if (r.dorm_type !== "不限") return;
    if (typeof isSpareRoom === "function" && isSpareRoom(r)) return;
    byRoom[r.id] = { name: r.name, location: r.location, beds: 0 };
  });
  rcBoardBeds().forEach(function (b) {
    if (b.status === "维修" || b.status === "备用") return;
    var room = rcBoardRooms().find(function (r) {
      return r.id == b.room_id;
    });
    if (!room || room.dorm_type !== "不限") return;
    if (typeof isSpareRoom === "function" && isSpareRoom(room)) return;
    if (rcLodgerOnBed(b.id)) return;
    if (!byRoom[room.id]) {
      byRoom[room.id] = {
        name: room.name,
        location: room.location,
        beds: 0,
      };
    }
    byRoom[room.id].beds++;
  });
  return Object.values(byRoom)
    .filter(function (r) {
      return r.beds > 0;
    })
    .sort(function (a, b) {
      if (b.beds !== a.beds) return b.beds - a.beds;
      return (a.name || "").localeCompare(b.name || "", "zh-CN");
    });
}

/** 营期列表含统计 | Event list with enrollment stats */
function rcEventListWithStats() {
  var lodgers = rcAllLodgersMerged();
  var resvs = rcRows("reservations", "reservations");
  return rcRows("events", "events")
    .map(function (e) {
      var checked_in = 0;
      var reserved = 0;
      var total_lodgers = 0;
      lodgers.forEach(function (l) {
        if (l.event_id != e.id) return;
        total_lodgers++;
        if (l.status === "在住") checked_in++;
      });
      resvs.forEach(function (r) {
        if (
          r.event_id == e.id &&
          (r.status === "预约" || r.status === "已确认")
        )
          reserved++;
      });
      return Object.assign({}, e, {
        checked_in: checked_in,
        reserved: reserved,
        total_lodgers: total_lodgers,
      });
    })
    .sort(function (a, b) {
      var sa = a.start_date || "";
      var sb = b.start_date || "";
      if (sa !== sb) return sb.localeCompare(sa);
      return (b.id || 0) - (a.id || 0);
    });
}

/** 每日预报数据 | Today forecast payload for renderTodayForecast */
function rcForecastTodayData(date) {
  var day = date || (typeof todayStr === "function" ? todayStr() : "");
  var arrivalsResv = rcRows("reservations", "reservations")
    .filter(function (r) {
      return (
        r.expected_check_in === day &&
        (r.status === "预约" || r.status === "已确认")
      );
    })
    .map(rcEnrichReservationRow)
    .sort(function (a, b) {
      return (a.event_name || "").localeCompare(b.event_name || "", "zh-CN");
    });
  var arrivalsLodger = rcAllLodgersMerged()
    .filter(function (l) {
      return l.check_in_date === day && l.status === "在住";
    })
    .map(rcEnrichLodgerRow);
  var departures = rcAllLodgersMerged()
    .filter(function (l) {
      return l.expected_check_out === day && l.status === "在住";
    })
    .map(rcEnrichLodgerRow);
  var lodgers = rcAllLodgersMerged();
  var actualCheckins = lodgers.filter(function (l) {
    return l.check_in_date === day && l.status === "在住";
  }).length;
  var actualCheckouts = lodgers.filter(function (l) {
    return (
      l.actual_check_out === day &&
      (l.status === "在住" || l.status === "已退")
    );
  }).length;
  var inHouse = lodgers.filter(function (l) {
    return (
      l.status === "在住" &&
      l.check_in_date <= day &&
      (!l.expected_check_out || l.expected_check_out > day)
    );
  }).length;
  var byEvent = {};
  arrivalsResv.concat(arrivalsLodger).forEach(function (a) {
    var key = a.event_name || "散客";
    if (!byEvent[key])
      byEvent[key] = { arrive: 0, depart: 0, male: 0, female: 0 };
    byEvent[key].arrive++;
    if (a.gender === "男") byEvent[key].male++;
    if (a.gender === "女") byEvent[key].female++;
  });
  departures.forEach(function (d) {
    var key = d.event_name || "散客";
    if (!byEvent[key])
      byEvent[key] = { arrive: 0, depart: 0, male: 0, female: 0 };
    byEvent[key].depart++;
  });
  var arrivalRoomKeys = {};
  var arrivalRooms = [];
  arrivalsResv.forEach(function (res) {
    rcBoardRooms().forEach(function (room) {
      if (typeof isSpareRoom === "function" && isSpareRoom(room)) return;
      var matchPref =
        res.room_preference &&
        room.name &&
        String(res.room_preference).indexOf(room.name) !== -1;
      var matchGender =
        (res.gender === "男" && room.dorm_type === "男寮") ||
        (res.gender === "女" && room.dorm_type === "女寮") ||
        room.dorm_type === "不限";
      if (!matchPref && !matchGender) return;
      var rk = room.id;
      if (!arrivalRoomKeys[rk]) {
        arrivalRoomKeys[rk] = true;
        arrivalRooms.push({
          room_name: room.name,
          location: room.location,
          dorm_type: room.dorm_type,
        });
      }
    });
  });
  arrivalRooms.sort(function (a, b) {
    return (a.location || "").localeCompare(b.location || "", "zh-CN");
  });
  var departureRooms = [];
  var depRoomKeys = {};
  departures.forEach(function (l) {
    if (!l.room_name || depRoomKeys[l.room_name]) return;
    depRoomKeys[l.room_name] = true;
    departureRooms.push({
      room_name: l.room_name,
      location: l.location,
      dorm_type: l.dorm_type,
    });
  });
  return {
    date: day,
    arrivalsResv: arrivalsResv,
    arrivalsLodger: arrivalsLodger,
    departures: departures,
    actualCheckins: actualCheckins,
    actualCheckouts: actualCheckouts,
    inHouse: inHouse,
    byEvent: byEvent,
    arrivalRooms: arrivalRooms,
    departureRooms: departureRooms,
  };
}

function rcForecastRoleBucket(role) {
  if (typeof FORECAST_ROLE_GROUPS === "undefined") return "special";
  var g = FORECAST_ROLE_GROUPS[role];
  if (g === "师") return "shi";
  if (g === "师资") return "teacher";
  if (g === "学员") return "student";
  if (g === "义工") return "volunteer";
  return "special";
}

function rcAccumulateRole(stats, role, count) {
  var bucket = rcForecastRoleBucket(role);
  stats[bucket] = (stats[bucket] || 0) + count;
}

/** 周流动预测数据 | Weekly flow forecast payload */
function rcForecastFlowWeeks(startDate, weeks) {
  var start = startDate || (typeof todayStr === "function" ? todayStr() : "");
  var n = parseInt(weeks, 10) || 8;
  var weekData = [];
  var current = new Date(start + "T12:00:00");
  if (isNaN(current.getTime())) current = new Date();
  current.setDate(current.getDate() - current.getDay() + 1);
  var lodgers = rcAllLodgersMerged();
  var resvs = rcRows("reservations", "reservations");
  for (var i = 0; i < n; i++) {
    var monday =
      typeof formatDateStr === "function"
        ? formatDateStr(current)
        : current.toISOString().slice(0, 10);
    var sundayDate = new Date(current);
    sundayDate.setDate(sundayDate.getDate() + 6);
    var sunday =
      typeof formatDateStr === "function"
        ? formatDateStr(sundayDate)
        : sundayDate.toISOString().slice(0, 10);
    var stats = {
      male: 0,
      female: 0,
      shi: 0,
      teacher: 0,
      student: 0,
      volunteer: 0,
      special: 0,
      arrive: 0,
      depart: 0,
    };
    lodgers.forEach(function (l) {
      if (
        l.status !== "在住" ||
        l.check_in_date > sunday ||
        (l.expected_check_out && l.expected_check_out <= sunday)
      )
        return;
      if (l.gender === "男") stats.male++;
      if (l.gender === "女") stats.female++;
      rcAccumulateRole(stats, l.role, 1);
    });
    resvs.forEach(function (r) {
      if (
        r.expected_check_in >= monday &&
        r.expected_check_in <= sunday &&
        (r.status === "预约" || r.status === "已确认")
      )
        stats.arrive++;
    });
    lodgers.forEach(function (l) {
      if (
        l.status === "在住" &&
        l.expected_check_out >= monday &&
        l.expected_check_out <= sunday
      )
        stats.depart++;
    });
    lodgers.forEach(function (l) {
      if (
        l.status === "在住" &&
        l.check_in_date >= monday &&
        l.check_in_date <= sunday
      )
        stats.arrive++;
    });
    weekData.push({ label: monday + " ~ " + sunday, stats: stats });
    current.setDate(current.getDate() + 7);
  }
  var dorm = rcGetDormBedStats();
  var flexBeds = 0;
  rcBoardBeds().forEach(function (b) {
    if (b.status === "维修" || b.status === "备用") return;
    var room = rcBoardRooms().find(function (r) {
      return r.id == b.room_id;
    });
    if (!room || room.dorm_type !== "不限") return;
    if (typeof isSpareRoom === "function" && isSpareRoom(room)) return;
    flexBeds++;
  });
  return {
    weekData: weekData,
    totalMaleBeds: dorm.maleBeds,
    totalFemaleBeds: dorm.femaleBeds,
    totalFlexBeds: flexBeds,
  };
}

/** 报表/历史：灌 sql.js 只读缓存（复杂 SQL 过渡） | Hydrate sql.js for legacy query() */
async function rcHydrateLegacyQueries(moduleKeys, force) {
  if (!rcUseApiRead()) return;
  await rcFetchMany(moduleKeys, force);
  var tables = {};
  (moduleKeys || []).forEach(function (key) {
    var mod = rcTables(key);
    Object.keys(mod).forEach(function (table) {
      if (!Array.isArray(mod[table])) return;
      if (!tables[table]) tables[table] = [];
      tables[table] = tables[table].concat(mod[table]);
    });
  });
  if (Object.keys(tables).length && typeof applyModuleTables === "function") {
    applyModuleTables(tables, { upsertOnly: true });
  }
}

async function rcEnsureBoard(force) {
  await rcFetch("board", force);
}

async function rcEnsureLodgersModule(force) {
  await rcFetch("lodgers", force);
}

async function rcEnsureEvents(force) {
  await rcFetch("events", force);
}

async function rcEnsureReservations(force) {
  await rcFetch("reservations", force);
}

async function rcEnsureMeals(force) {
  await rcFetch("meals", force);
}

/** 视图 → 读模块 | View to read-module keys */
var RC_VIEW_MODULES = {
  board: ["board", "reservations", "events", "meals"],
  lodging: ["board"],
  lodgers: ["lodgers", "board"],
  stay: ["board", "reservations", "events"],
  history: ["lodgers", "events", "meals"],
  forecast: ["board", "reservations", "lodgers", "events"],
  housekeeping: ["board"],
  reports: ["meals", "lodgers", "events"],
  rooming: ["board", "events", "lodgers", "reservations"],
  info_events: ["events", "lodgers", "reservations"],
};

async function rcEnsureViewModules(viewName, force) {
  if (!rcUseApiRead()) return;
  var modules = RC_VIEW_MODULES[viewName];
  if (!modules || !modules.length) return;
  await rcHydrateLegacyQueries(modules, force);
}

var RC_APP_MODULES = [
  "board",
  "lodgers",
  "lodgers_records",
  "reservations",
  "events",
  "meals",
];

/** 登录/全站刷新：拉关键模块 + 灌只读 sql.js 供遗留 query | App bootstrap */
async function rcEnsureAppData(force) {
  if (!rcUseApiRead()) return;
  if (force) rcInvalidate();
  for (var i = 0; i < RC_APP_MODULES.length; i++) {
    var key = RC_APP_MODULES[i];
    await rcFetch(key, force);
    if (typeof applyModuleTables === "function") {
      applyModuleTables(rcTables(key), { upsertOnly: true });
    }
    var payload = _rcStore[key];
    if (
      payload &&
      payload.board_version != null &&
      typeof setLocalBoardVersion === "function"
    ) {
      setLocalBoardVersion(payload.board_version);
    }
  }
  if (typeof remoteReadModelReady !== "undefined") {
    remoteReadModelReady = true;
  }
  if (typeof lastRemoteSyncAt !== "undefined") {
    lastRemoteSyncAt = Date.now();
  }
  if (typeof setRemoteSyncStatus === "function") {
    setRemoteSyncStatus("ready");
  }
}
