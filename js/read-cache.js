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
