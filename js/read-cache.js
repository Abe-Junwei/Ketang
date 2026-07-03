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

/** 增量 patch 写入 rc 缓存 | Apply delta patches to rc store */
function rcApplyDeltaPatches(patches, deletions) {
  if (patches && typeof patches === "object") {
    Object.keys(patches).forEach(function (table) {
      var rows = patches[table];
      if (!Array.isArray(rows)) return;
      Object.keys(_rcStore).forEach(function (moduleKey) {
        var mod = _rcStore[moduleKey];
        if (!mod) return;
        if (!mod.tables) mod.tables = {};
        if (!Array.isArray(mod.tables[table])) mod.tables[table] = [];
        var arr = mod.tables[table];
        rows.forEach(function (row) {
          if (!row) return;
          var rowKey = table === "app_meta" ? row.key : row.id;
          if (rowKey == null) return;
          var idx = arr.findIndex(function (r) {
            return table === "app_meta" ? r.key === row.key : r.id == row.id;
          });
          if (idx >= 0) arr[idx] = row;
          else arr.push(row);
        });
      });
    });
  }
  (deletions || []).forEach(function (item) {
    if (!item || !item.table_name || item.row_id == null) return;
    var table = item.table_name;
    var rowId = item.row_id;
    Object.keys(_rcStore).forEach(function (moduleKey) {
      var mod = _rcStore[moduleKey];
      if (!mod || !mod.tables || !Array.isArray(mod.tables[table])) return;
      mod.tables[table] = mod.tables[table].filter(function (r) {
        return r.id != rowId;
      });
    });
  });
}

/** delta 全模块 payload 写入 rc | Apply delta module payloads to rc store */
function rcApplyDeltaModules(modules) {
  if (!modules || typeof modules !== "object") return;
  Object.keys(modules).forEach(function (moduleKey) {
    var mod = modules[moduleKey];
    if (mod) rcStorePayload(moduleKey, mod);
  });
}

function rcInvalidateMany(keys) {
  (keys || []).forEach(function (k) {
    rcInvalidate(k);
  });
}

/** 模块是否已在内存缓存 | Module payload cached in _rcStore */
function rcModuleCached(moduleKey) {
  return !!(moduleKey && _rcStore[moduleKey]);
}

/** 写 API 响应直接 patch 缓存（Directus read-after-write 对齐）| Apply write response patches */
function rcApplyWriteResult(writeResult) {
  if (!writeResult || typeof rcApplyDeltaPatches !== "function") return;
  rcApplyDeltaPatches(writeResult.patches, writeResult.deletions);
}

/**
 * 统一写后刷新：patch rc → 刷新当前视图 → 后台 delta/module 对账 → 再刷新当前视图
 * Unified post-write refresh: patch rc, render, reconcile, then render again.
 */
function rcRefreshAfterWrite(writeResult, options) {
  options = options || {};
  if (typeof ketangPerfMark === "function")
    ketangPerfMark("write-refresh:start");
  function finishPerf() {
    if (typeof ketangPerfMark === "function") {
      ketangPerfMark("write-refresh:end");
      ketangPerfMeasure(
        "write-refresh",
        "write-refresh:start",
        "write-refresh:end",
      );
    }
  }
  function refreshOnce() {
    if (typeof options.viewRefresh === "function") {
      options.viewRefresh();
    } else if (typeof refreshViewForScope === "function") {
      refreshViewForScope(
        options.scope != null
          ? options.scope
          : typeof getActiveViewId === "function"
            ? getActiveViewId()
            : null,
        options,
      );
    }
  }
  rcApplyWriteResult(writeResult);
  if (!options.skipViewRefresh) {
    refreshOnce();
  }
  if (typeof isRemoteDB !== "function" || !isRemoteDB()) {
    finishPerf();
    return;
  }
  if (typeof refreshAfterWrite !== "function") {
    finishPerf();
    return;
  }
  var syncTask = refreshAfterWrite(
    writeResult,
    Object.assign(
      {
        deferSyncRender: true,
        quietSync: true,
        skipViewRefresh: true,
        skipModuleSync: true,
      },
      options,
      { skipViewRefresh: true },
    ),
  );
  if (
    !options.skipViewRefresh &&
    syncTask &&
    typeof syncTask.then === "function"
  ) {
    syncTask
      .then(function () {
        refreshOnce();
        finishPerf();
      })
      .catch(function () {
        finishPerf();
      });
  } else {
    finishPerf();
  }
  return syncTask;
}

async function rcFetch(moduleKey, force) {
  if (!rcUseApiRead()) return null;
  if (!moduleKey) return null;
  if (!force && _rcStore[moduleKey]) return _rcStore[moduleKey];
  if (_rcInflight[moduleKey]) return _rcInflight[moduleKey];
  if (typeof ketangPerfMark === "function")
    ketangPerfMark("read:" + moduleKey + ":start");
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
      if (typeof ketangPerfMark === "function") {
        ketangPerfMark("read:" + moduleKey + ":end");
        ketangPerfMeasure(
          "read:" + moduleKey,
          "read:" + moduleKey + ":start",
          "read:" + moduleKey + ":end",
        );
      }
      delete _rcInflight[moduleKey];
    });
  return _rcInflight[moduleKey];
}

async function rcFetchMany(moduleKeys, force) {
  var keys = moduleKeys || [];
  await Promise.all(
    keys.map(function (key) {
      return rcFetch(key, force);
    }),
  );
}

/* ── board 模块派生 | Board module derivations ── */

function rcBoardRooms() {
  return rcRows("board", "rooms")
    .slice()
    .sort(function (a, b) {
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
    return h.bed_id == bedId && !h._optimistic;
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
      if (
        options.spareRoomFilter !== false &&
        typeof isSpareRoom === "function" &&
        isSpareRoom(r)
      )
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
    if (!room || (typeof isSpareRoom === "function" && isSpareRoom(room)))
      return;
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
    typeof rcUseApiRead === "function" &&
    rcUseApiRead() &&
    rcRows("board", "rooms").length > 0
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
  /** lodgers_recent 仅 API 按需拉取，不参与合并 | recent module is on-demand only */
  [
    rcBoardLodgers(),
    rcRows("lodgers", "lodgers"),
    rcRows("lodgers_active", "lodgers"),
  ].forEach(function (arr) {
    arr.forEach(function (l) {
      byId[l.id] = l;
    });
  });
  return Object.values(byId);
}

function rcLodgerById(id) {
  if (!id) return null;
  var sources = [
    rcBoardLodgers(),
    rcRows("lodgers_active", "lodgers"),
    rcRows("lodgers", "lodgers"),
  ];
  for (var i = 0; i < sources.length; i++) {
    var found = sources[i].find(function (l) {
      return l.id == id;
    });
    if (found) return found;
  }
  return null;
}

/** 在住索引（优先 lodgers_lookup，bootstrap 后即可查重）| In-house rows for duplicate checks */
function rcLookupLodgersInHouse() {
  var lookup = rcRows("lodgers_lookup", "lodgers");
  if (lookup.length) {
    return lookup.filter(function (l) {
      return l.status === "在住";
    });
  }
  return rcRows("lodgers", "lodgers").filter(function (l) {
    return l.status === "在住";
  });
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
  lodgers: ["lodgers", "lodgers_active", "board"],
  events: ["events", "lodgers", "reservations", "board"],
};

function rcModulesForInfoTab(tab) {
  var keys = RC_INFO_TAB_MODULES[tab];
  return keys ? keys.slice() : [];
}

function rcInvalidateForInfoTab(tab) {
  rcInvalidateMany(rcModulesForInfoTab(tab));
}

function rcGuestById(id) {
  if (!id) return null;
  var mods = ["lodgers", "settings_guests", "reservations", "meals"];
  for (var i = 0; i < mods.length; i++) {
    var row = rcRows(mods[i], "guests").find(function (g) {
      return g.id == id;
    });
    if (row) return row;
  }
  return null;
}

function rcReservationById(id) {
  if (!id) return null;
  return (
    rcRows("reservations", "reservations").find(function (r) {
      return r.id == id;
    }) || null
  );
}

function rcBedById(id) {
  if (!id) return null;
  var mods = ["board", "lodgers_active", "settings_beds", "lodgers"];
  for (var i = 0; i < mods.length; i++) {
    var row = rcRows(mods[i], "beds").find(function (b) {
      return b.id == id;
    });
    if (row) return row;
  }
  return null;
}

function rcRoomById(id) {
  if (!id) return null;
  var mods = ["board", "settings_beds", "settings_rooms", "lodgers"];
  for (var i = 0; i < mods.length; i++) {
    var row = rcRows(mods[i], "rooms").find(function (r) {
      return r.id == id;
    });
    if (row) return row;
  }
  return null;
}

function rcBedJoined(bedId) {
  var bed = rcBedById(bedId);
  if (!bed) return null;
  var room = rcRoomById(bed.room_id);
  return Object.assign({}, bed, {
    room_name: room ? room.name : null,
    dorm_type: room ? room.dorm_type : null,
    location: room ? room.location : null,
  });
}

function rcPaymentsForLodger(lodgerId) {
  return rcRows("lodgers", "payments").filter(function (p) {
    return p.lodger_id == lodgerId;
  });
}

function rcPaidTotalForLodger(lodgerId) {
  return rcPaymentsForLodger(lodgerId).reduce(function (sum, p) {
    return sum + (parseFloat(p.amount) || 0);
  }, 0);
}

function rcPaymentSummary(lodgerId) {
  var income = 0;
  var refund = 0;
  rcPaymentsForLodger(lodgerId).forEach(function (p) {
    var amt = parseFloat(p.amount) || 0;
    if (p.type === "押金" || p.type === "房费") income += amt;
    if (p.type === "退款") refund += amt;
  });
  return {
    income: income,
    refund: refund,
    refund_total: refund,
    balance: income - refund,
  };
}

/** 历史台账 CSV 款项分列 | Ledger CSV payment columns */
function rcLodgerPaymentTotals(lodgerId) {
  var deposit = 0;
  var room_fee = 0;
  var refund = 0;
  rcPaymentsForLodger(lodgerId).forEach(function (p) {
    var amt = parseFloat(p.amount) || 0;
    if (p.type === "押金") deposit += amt;
    else if (p.type === "房费") room_fee += amt;
    else if (p.type === "退款") refund += amt;
  });
  return { deposit: deposit, room_fee: room_fee, refund: refund };
}

/** 按名称匹配营期 | Find event by exact/fuzzy name */
function rcFindEventByName(name) {
  if (!name) return null;
  var trimmed = String(name).trim();
  if (!trimmed) return null;
  var rows = rcRows("events", "events");
  var exact = rows.find(function (e) {
    return e.name === trimmed;
  });
  if (exact) return exact;
  var lower = trimmed.toLowerCase();
  var fuzzy = rows.find(function (e) {
    return e.name && String(e.name).toLowerCase().indexOf(lower) !== -1;
  });
  return fuzzy || null;
}

/** 营期预分房方案 | Rooming plan row for event */
function rcRoomingPlanByEventId(eventId) {
  if (!eventId) return null;
  var detailPlans = rcRoomingEventTables(eventId).rooming_plans || [];
  if (detailPlans.length) {
    return (
      detailPlans.find(function (p) {
        return p.event_id == eventId;
      }) || detailPlans[0]
    );
  }
  return (
    rcRows("events", "rooming_plans").find(function (p) {
      return p.event_id == eventId;
    }) || null
  );
}

function rcMealsForLodger(lodgerId) {
  return rcRows("meals", "meals").filter(function (m) {
    return m.lodger_id == lodgerId;
  });
}

function rcUnassignedLodgers() {
  return rcAllLodgersMerged()
    .filter(function (l) {
      return l.status === "在住" && !l.bed_id;
    })
    .map(rcEnrichLodgerRow)
    .sort(function (a, b) {
      var da = a.check_in_date || "";
      var db = b.check_in_date || "";
      if (da !== db) return db.localeCompare(da);
      return (b.id || 0) - (a.id || 0);
    });
}

function rcUnassignedReservations() {
  return rcRows("reservations", "reservations")
    .filter(function (r) {
      return (r.status === "预约" || r.status === "已确认") && !r.bed_id;
    })
    .map(rcEnrichReservationRow)
    .sort(function (a, b) {
      var da = a.expected_check_in || "";
      var db = b.expected_check_in || "";
      if (da !== db) return da.localeCompare(db);
      return (a.id || 0) - (b.id || 0);
    });
}

/** 营期排房详情键 | Event detail cache key in unified rc store */
function rcEventDetailKey(eventId) {
  return "event:" + String(eventId);
}

function rcEventDetailTables(eventId) {
  var mod = _rcStore[rcEventDetailKey(eventId)];
  return (mod && mod.tables) || {};
}

async function rcFetchEventDetail(eventId, force) {
  if (!rcUseApiRead()) return null;
  var id = parseInt(eventId, 10);
  if (!id) return null;
  var key = rcEventDetailKey(id);
  if (!force && _rcStore[key]) return _rcStore[key];
  var inflightKey = "_inflight:" + key;
  if (_rcInflight[inflightKey]) return _rcInflight[inflightKey];
  _rcInflight[inflightKey] = apiReadEventDetail(id)
    .then(function (payload) {
      rcStorePayload(key, payload || {});
      return payload;
    })
    .finally(function () {
      delete _rcInflight[inflightKey];
    });
  return _rcInflight[inflightKey];
}

function rcInvalidateEventDetail(eventId) {
  if (eventId != null) rcInvalidate(rcEventDetailKey(eventId));
  else {
    Object.keys(_rcStore).forEach(function (k) {
      if (k.indexOf("event:") === 0) delete _rcStore[k];
    });
  }
}

function rcHistorySearch(filters) {
  filters = filters || {};
  var rows = rcAllLodgersMerged().map(function (l) {
    return rcEnrichLodgerRow(l);
  });
  if (filters.start) {
    rows = rows.filter(function (l) {
      return l.check_in_date && l.check_in_date >= filters.start;
    });
  }
  if (filters.end) {
    rows = rows.filter(function (l) {
      return l.check_in_date && l.check_in_date <= filters.end;
    });
  }
  if (filters.room) {
    var q = filters.room.toLowerCase();
    rows = rows.filter(function (l) {
      return (
        (l.room_name && l.room_name.toLowerCase().indexOf(q) !== -1) ||
        (l.bed_number && String(l.bed_number).toLowerCase().indexOf(q) !== -1)
      );
    });
  }
  if (filters.role) {
    var roleVals = lodgerRoleMatchValues(filters.role);
    rows = rows.filter(function (l) {
      return roleVals.indexOf(l.role) !== -1;
    });
  }
  if (filters.kw) {
    var kw = filters.kw.toLowerCase();
    rows = rows.filter(function (l) {
      return (
        (l.name && l.name.toLowerCase().indexOf(kw) !== -1) ||
        (l.dharma_name && l.dharma_name.toLowerCase().indexOf(kw) !== -1) ||
        (l.phone && l.phone.indexOf(filters.kw) !== -1)
      );
    });
  }
  rows.sort(function (a, b) {
    var da = a.check_in_date || "";
    var db = b.check_in_date || "";
    if (da !== db) return db.localeCompare(da);
    return (b.id || 0) - (a.id || 0);
  });
  return rows;
}

/** 历史台账服务端查询 | Server-side history query (Phase G-3) */
async function rcFetchHistoryRows(filters) {
  if (!rcUseApiRead() || typeof apiReadHistoryPage !== "function") {
    return rcHistorySearch(filters || {});
  }
  var payload = await apiReadHistoryPage(filters || {});
  return (payload.tables && payload.tables.lodgers) || [];
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
        r.event_id == eventId && (r.status === "预约" || r.status === "已确认")
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

function rcReportPaidDate(payment) {
  if (!payment || !payment.paid_at) return "";
  return String(payment.paid_at).slice(0, 10);
}

function rcReportLodgerActive(lodger) {
  return lodger && (lodger.status === "在住" || lodger.status === "已退");
}

function rcReportPaymentsForDate(date) {
  return rcRows("lodgers", "payments").filter(function (p) {
    if (rcReportPaidDate(p) !== date) return false;
    if (p.lodger_id == null || p.lodger_id === "") return true;
    var l = rcLodgerById(p.lodger_id);
    return !l || rcReportLodgerActive(l);
  });
}

function rcReportPaymentsForMonth(monthPrefix) {
  return rcRows("lodgers", "payments").filter(function (p) {
    if (!String(p.paid_at || "").startsWith(monthPrefix)) return false;
    if (p.lodger_id == null || p.lodger_id === "") return true;
    var l = rcLodgerById(p.lodger_id);
    return !l || rcReportLodgerActive(l);
  });
}

function rcReportGroupPayments(rows) {
  var byType = {};
  var byMethod = {};
  rows.forEach(function (p) {
    var type = p.type || "";
    var amt = parseFloat(p.amount) || 0;
    if (!byType[type]) byType[type] = { type: type, total: 0, cnt: 0 };
    byType[type].total += amt;
    byType[type].cnt++;
    var method = (p.method && String(p.method).trim()) || "未填写";
    if (!byMethod[method])
      byMethod[method] = { method: method, total: 0, cnt: 0 };
    byMethod[method].total += amt;
    byMethod[method].cnt++;
  });
  return {
    payments: Object.values(byType),
    payMethods: Object.values(byMethod).sort(function (a, b) {
      return (b.total || 0) - (a.total || 0);
    }),
  };
}

/** 日报聚合 | Daily report payload from rc store */
function rcDailyReportData(date) {
  var lodgers = rcAllLodgersMerged().filter(rcReportLodgerActive);
  var payGrouped = rcReportGroupPayments(rcReportPaymentsForDate(date));
  return {
    checkins: lodgers.filter(function (l) {
      return l.check_in_date === date;
    }).length,
    checkouts: lodgers.filter(function (l) {
      return l.actual_check_out === date;
    }).length,
    inHouse: lodgers.filter(function (l) {
      return (
        l.status === "在住" &&
        l.check_in_date <= date &&
        (!l.expected_check_out || l.expected_check_out > date)
      );
    }).length,
    expectedCheckout: lodgers.filter(function (l) {
      return l.status === "在住" && l.expected_check_out === date;
    }).length,
    payments: payGrouped.payments,
    payMethods: payGrouped.payMethods,
    checkinList: lodgers
      .filter(function (l) {
        return l.check_in_date === date;
      })
      .map(rcEnrichLodgerRow)
      .sort(function (a, b) {
        return (b.id || 0) - (a.id || 0);
      }),
    checkoutList: lodgers
      .filter(function (l) {
        return l.actual_check_out === date;
      })
      .map(rcEnrichLodgerRow)
      .sort(function (a, b) {
        return (b.id || 0) - (a.id || 0);
      }),
  };
}

/** 月报聚合 | Monthly report payload from rc store */
function rcMonthlyReportData(month) {
  var prefix = month + "-";
  var lodgers = rcAllLodgersMerged().filter(rcReportLodgerActive);
  var payGrouped = rcReportGroupPayments(rcReportPaymentsForMonth(prefix));
  var byDayMap = {};
  lodgers.forEach(function (l) {
    if (!l.check_in_date || !l.check_in_date.startsWith(prefix)) return;
    byDayMap[l.check_in_date] = (byDayMap[l.check_in_date] || 0) + 1;
  });
  return {
    checkins: lodgers.filter(function (l) {
      return l.check_in_date && l.check_in_date.startsWith(prefix);
    }).length,
    checkouts: lodgers.filter(function (l) {
      return l.actual_check_out && l.actual_check_out.startsWith(prefix);
    }).length,
    payments: payGrouped.payments,
    payMethods: payGrouped.payMethods,
    byDay: Object.keys(byDayMap)
      .sort()
      .map(function (day) {
        return { day: day, cnt: byDayMap[day] };
      }),
  };
}

/** 营期报表成员 | Event report member rows from rc store */
function rcEventReportMembers(eventId) {
  var members = [];
  function pushLodger(l) {
    members.push({
      name: l.name,
      dharma_name: l.dharma_name,
      gender: l.gender,
      role: l.role,
      class_name: l.class_name,
      kind: "在住",
      status: l.status,
      date_in: l.check_in_date,
      date_out: l.expected_check_out,
    });
  }
  function pushResv(r) {
    members.push({
      name: r.name,
      dharma_name: r.dharma_name,
      gender: r.gender,
      role: r.role,
      class_name: r.class_name,
      kind: "预约",
      status: r.status,
      date_in: r.expected_check_in,
      date_out: r.expected_check_out,
    });
  }
  if (eventId) {
    rcAllLodgersMerged()
      .filter(function (l) {
        return l.event_id == eventId && l.status === "在住";
      })
      .forEach(pushLodger);
    rcRows("reservations", "reservations")
      .filter(function (r) {
        return (
          r.event_id == eventId &&
          (r.status === "预约" || r.status === "已确认")
        );
      })
      .forEach(pushResv);
  } else {
    rcAllLodgersMerged()
      .filter(function (l) {
        return l.event_id != null && l.status === "在住";
      })
      .forEach(pushLodger);
    rcRows("reservations", "reservations")
      .filter(function (r) {
        return (
          r.event_id != null && (r.status === "预约" || r.status === "已确认")
        );
      })
      .forEach(pushResv);
  }
  return members;
}

/** 日报 CSV 行 | Daily report export rows from rc store */
function rcDailyReportExportRows(date) {
  return rcAllLodgersMerged()
    .filter(rcReportLodgerActive)
    .filter(function (l) {
      return l.check_in_date === date || l.actual_check_out === date;
    })
    .map(rcEnrichLodgerRow)
    .sort(function (a, b) {
      var da = a.check_in_date || "";
      var db = b.check_in_date || "";
      if (da !== db) return db.localeCompare(da);
      return (b.id || 0) - (a.id || 0);
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
      l.actual_check_out === day && (l.status === "在住" || l.status === "已退")
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

/** 报表/历史：拉 rc 模块；在线默认不灌 sql.js | Hydrate sql.js only when needed */
async function rcHydrateLegacyQueries(moduleKeys, force) {
  if (!rcUseApiRead()) return;
  await rcFetchMany(moduleKeys, force);
  if (typeof rcReadReady === "function" && rcReadReady()) return;
  if (
    typeof shouldSkipSqlDeltaHydrate === "function" &&
    shouldSkipSqlDeltaHydrate()
  ) {
    return;
  }
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
  history: ["events", "meals"],
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
  "lodgers_lookup",
  "reservations",
  "events",
  "meals",
];

/** 登录首屏最小模块 | Login bootstrap modules (board only) */
var RC_BOOTSTRAP_MODULES = ["board"];

/** 登录后后台拉取 | Deferred after first-view-ready (no history bulk) */
var RC_DEFERRED_MODULES = [
  "lodgers",
  "lodgers_lookup",
  "reservations",
  "events",
  "meals",
];

/** 登录/全站刷新：并行拉模块；在线不灌 sql.js | App bootstrap */
async function rcEnsureAppData(force, options) {
  if (!rcUseApiRead()) return;
  options = options || {};
  if (force) rcInvalidate();
  var keys = RC_APP_MODULES;
  var perfLabel = "rc:app";
  if (options.bootstrapOnly) {
    keys = RC_BOOTSTRAP_MODULES;
    perfLabel = "rc:bootstrap";
  } else if (options.deferredOnly) {
    keys = RC_DEFERRED_MODULES;
    perfLabel = "rc:deferred";
  }
  if (typeof ketangPerfMark === "function") ketangPerfMark(perfLabel + ":start");
  await Promise.all(
    keys.map(function (key) {
      return rcFetch(key, force);
    }),
  );
  if (typeof ketangPerfMark === "function") {
    ketangPerfMark(perfLabel + ":end");
    ketangPerfMeasure(perfLabel, perfLabel + ":start", perfLabel + ":end");
  }
  if (options.bootstrapOnly) {
    RC_BOOTSTRAP_MODULES.forEach(function (key) {
      var payload = _rcStore[key];
      if (
        payload &&
        payload.board_version != null &&
        typeof setLocalBoardVersion === "function"
      ) {
        setLocalBoardVersion(payload.board_version);
      }
    });
    if (typeof remoteReadModelReady !== "undefined") {
      remoteReadModelReady = true;
    }
    if (typeof lastRemoteSyncAt !== "undefined") {
      lastRemoteSyncAt = Date.now();
    }
    return;
  }
  var hydrateSql =
    options.hydrateSql ||
    (typeof isLocalForceDb === "function" && isLocalForceDb());
  if (hydrateSql && typeof applyModuleTables === "function") {
    if (typeof ensureLocalSqlite === "function") await ensureLocalSqlite();
    var allTables = {};
    RC_APP_MODULES.forEach(function (key) {
      var tables = rcTables(key);
      Object.keys(tables).forEach(function (table) {
        if (!Array.isArray(tables[table])) return;
        if (!allTables[table]) allTables[table] = [];
        allTables[table] = allTables[table].concat(tables[table]);
      });
    });
    if (Object.keys(allTables).length) {
      applyModuleTables(allTables, { upsertOnly: true });
    }
  }
  RC_APP_MODULES.forEach(function (key) {
    var payload = _rcStore[key];
    if (
      payload &&
      payload.board_version != null &&
      typeof setLocalBoardVersion === "function"
    ) {
      setLocalBoardVersion(payload.board_version);
    }
  });
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
