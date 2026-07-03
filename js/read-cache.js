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
    typeof rcUseApiRead === "function" &&
    rcUseApiRead() &&
    rcBoardRooms().length > 0
  );
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
  board: ["board"],
  lodging: ["board"],
  lodgers: ["lodgers", "board"],
  stay: ["board", "reservations", "events"],
  history: ["lodgers", "events", "meals"],
  forecast: ["board", "reservations", "lodgers", "events"],
  housekeeping: ["board"],
  reports: ["meals", "lodgers", "events"],
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
