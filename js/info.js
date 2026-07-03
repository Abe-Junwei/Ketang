/* ============================================================
   信息管理 | Information Management
   房间 / 床位 / 住客档案 / 挂单记录 增删改查
   ============================================================ */

let infoCurrentTab = "rooms";
var _infoFilterTimer = null;
var _infoLastToolbarHash = {};
const infoFilters = {
  rooms: { q: "", location: "", dorm: "" },
  beds: { q: "", roomId: "", status: "" },
  guests: { q: "", gender: "" },
  lodgers: { q: "", status: "", source: "" },
  events: { q: "", eventType: "" },
};

const INFO_DORM_OPTIONS = ["男寮", "女寮", "不限"];
const INFO_BED_STATUS_OPTIONS = ["可用", "维修", "备用"];
const INFO_GENDER_OPTIONS = ["男", "女"];
const INFO_LODGER_STATUS_OPTIONS = ["在住", "已退"];
const INFO_SOURCE_OPTIONS = ["现场", "电话", "微信", "法会预约"];

function renderInfo(tab, options) {
  options = options || {};
  if (tab && tab !== infoCurrentTab) {
    _infoLastToolbarHash = {};
  }
  infoCurrentTab = tab || infoCurrentTab;
  const tabs = document.getElementById("info-tabs");
  if (tabs) {
    tabs.querySelectorAll(".info-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === infoCurrentTab);
    });
  }
  if (typeof updateTopbarForInfoTab === "function") {
    updateTopbarForInfoTab(infoCurrentTab);
  }
  if (!options.forceFetch && infoRcTabDataReady(infoCurrentTab)) {
    infoRenderCurrentTabLists();
    return;
  }
  infoLoadAndRenderCurrentTab(options);
}

function infoRcTabDataReady(tab) {
  if (!infoUseApiData() || typeof rcModuleCached !== "function") return false;
  if (tab === "events") return rcModuleCached("events");
  var mod = INFO_READ_MODULES[tab];
  if (!mod) return false;
  if (!rcModuleCached(mod)) return false;
  if (tab === "beds" || tab === "lodgers") {
    return rcModuleCached("lodgers");
  }
  return true;
}

function infoRenderCurrentTabLists() {
  if (infoCurrentTab === "events") renderEventList();
  else if (infoCurrentTab === "rooms") renderRoomList();
  else if (infoCurrentTab === "beds") renderBedList();
  else if (infoCurrentTab === "guests") renderGuestList();
  else if (infoCurrentTab === "lodgers") renderLodgerList();
}

async function infoLoadAndRenderCurrentTab(options) {
  options = options || {};
  if (infoCurrentTab === "events") {
    if (typeof rcUseApiRead === "function" && rcUseApiRead()) {
      if (!options.skipLoading) {
        infoSetToolbar("");
        infoSetHtml('<div class="empty-tip">加载中…</div>');
      }
      try {
        await rcEnsureViewModules("info_events", !!options.forceFetch);
      } catch (e) {
        infoSetHtml(
          '<div class="empty-tip">加载失败：' +
            infoEscape(e.message || "未知错误") +
            "</div>",
        );
        return;
      }
    }
    renderEventList();
    return;
  }
  if (infoUseApiData()) {
    if (!options.skipLoading) {
      infoSetToolbar("");
      infoSetHtml('<div class="empty-tip">加载中…</div>');
    }
    try {
      await infoEnsureTabData(infoCurrentTab, !!options.forceFetch);
    } catch (e) {
      infoSetHtml(
        '<div class="empty-tip">加载失败：' +
          infoEscape(e.message || "未知错误") +
          "</div>",
      );
      return;
    }
  }
  infoRenderCurrentTabLists();
}

function infoToolbarEl() {
  return document.getElementById("info-toolbar");
}

function infoSetToolbar(html) {
  const el = infoToolbarEl();
  if (!el) return;
  el.hidden = !html;
  el.innerHTML = html || "";
}

function infoPageShell(toolbarHtml, bodyHtml) {
  infoSetToolbar(toolbarHtml);
  infoSetHtml(bodyHtml);
}

function infoGetFilters(tab) {
  if (!infoFilters[tab]) infoFilters[tab] = {};
  return infoFilters[tab];
}

function infoOnFilter(tab, key, value) {
  infoGetFilters(tab)[key] = value;
  clearTimeout(_infoFilterTimer);
  _infoFilterTimer = setTimeout(function () {
    _infoLastToolbarHash[tab] = "";
    if (infoRcTabDataReady(tab)) infoRenderCurrentTabLists();
    else renderInfo(tab);
  }, 200);
}

function infoToast(msg) {
  showToast(msg);
}

function infoTextIncludes(haystack, needle) {
  if (!needle) return true;
  return String(haystack || "")
    .toLowerCase()
    .includes(String(needle).toLowerCase());
}

function infoSearchBox(tab, placeholder) {
  const f = infoGetFilters(tab);
  return `
    <div class="info-search">
      <span class="info-search-icon" aria-hidden="true">${icon("search")}</span>
      <input type="search" class="info-search-input" placeholder="${infoEscape(placeholder)}"
        value="${infoEscape(f.q || "")}"
        oninput="infoOnFilter('${tab}','q',this.value)">
    </div>
  `;
}

function infoFilterSelect(tab, key, label, options, allLabel) {
  const f = infoGetFilters(tab);
  let html = `<select class="info-filter-select" aria-label="${infoEscape(label)}"
    onchange="infoOnFilter('${tab}','${key}',this.value)">`;
  html += `<option value="">${infoEscape(allLabel || "全部")}</option>`;
  options.forEach((opt) => {
    const value = Array.isArray(opt) ? opt[0] : opt;
    const text = Array.isArray(opt) ? opt[1] : opt;
    const selected = String(f[key] || "") === String(value) ? " selected" : "";
    html += `<option value="${infoEscape(value)}"${selected}>${infoEscape(text)}</option>`;
  });
  html += "</select>";
  return html;
}

function infoToolbarHtml(filtersHtml, actionHtml) {
  return `
    <div class="info-toolbar-filters">${filtersHtml}</div>
    <div class="info-toolbar-actions">${actionHtml}</div>
  `;
}

function infoActionLinks(editOnclick, deleteOnclick) {
  return `<div class="info-row-actions">
    <button type="button" class="info-row-action" onclick="${editOnclick}">${icon("edit")}编辑</button>
    <button type="button" class="info-row-action info-row-action-danger" onclick="${deleteOnclick}">${icon("delete")}删除</button>
  </div>`;
}

function infoEmptyTable(msg) {
  return `<div class="empty-tip">${infoEscape(msg)}</div>`;
}

function infoContent() {
  return document.getElementById("info-content");
}

function infoSetHtml(html) {
  infoContent().innerHTML = html;
}

function infoToolbarHash(tab, toolbarHtml) {
  return tab + "|" + (toolbarHtml || "");
}

/** 仅替换 tbody，避免整页 innerHTML 重建 | Patch table body only */
function infoTryPatchTableBody(rowsHtml) {
  var tbody = infoContent().querySelector(".table-wrap table tbody");
  if (!tbody || rowsHtml == null) return false;
  tbody.innerHTML = rowsHtml;
  return true;
}

function infoFinishListRender(tab, toolbar, tableHtml, rowsHtml, emptyHtml) {
  var hash = infoToolbarHash(tab, toolbar);
  if (
    rowsHtml &&
    _infoLastToolbarHash[tab] === hash &&
    infoTryPatchTableBody(rowsHtml)
  ) {
    return;
  }
  _infoLastToolbarHash[tab] = hash;
  infoPageShell(toolbar, rowsHtml ? tableHtml : emptyHtml);
}

const INFO_READ_MODULES = {
  rooms: "settings_beds",
  beds: "settings_beds",
  guests: "settings_guests",
  lodgers: "lodgers",
  events: "events",
};

function infoUseApiData() {
  return typeof isRemoteDB === "function" && isRemoteDB();
}

function infoModuleTables(moduleKey) {
  if (typeof rcTables === "function") {
    return rcTables(moduleKey);
  }
  return {};
}

function infoInvalidateModules(moduleKeys) {
  if (typeof rcInvalidateMany === "function") {
    rcInvalidateMany(moduleKeys);
  }
}

function infoInvalidateForTab(tab) {
  var mod = INFO_READ_MODULES[tab];
  if (mod) infoInvalidateModules([mod]);
  if (tab === "rooms" || tab === "beds") {
    infoInvalidateModules(["settings_beds", "lodgers"]);
  }
}

async function infoEnsureModuleData(moduleKey, force) {
  if (!infoUseApiData()) return null;
  if (typeof rcFetch === "function") return rcFetch(moduleKey, force);
  return null;
}

async function infoEnsureTabData(tab, force) {
  if (!infoUseApiData()) return;
  var mod = INFO_READ_MODULES[tab];
  if (!mod) return;
  await infoEnsureModuleData(mod, force);
  if (tab === "beds" || tab === "guests" || tab === "lodgers") {
    await infoEnsureModuleData("lodgers", force);
  }
  if (tab === "lodgers") {
    await infoEnsureModuleData("settings_beds", force);
  }
}

var _infoLodgerOnBedMap = null;
var _infoLodgerMapVersion = -1;

function infoLodgerOnBedMap() {
  var version =
    typeof getLocalBoardVersion === "function" ? getLocalBoardVersion() : 0;
  if (_infoLodgerOnBedMap && _infoLodgerMapVersion === version) {
    return _infoLodgerOnBedMap;
  }
  var map = {};
  (infoModuleTables("lodgers").lodgers || []).forEach(function (l) {
    if (l.bed_id && l.status === "在住") {
      map[l.bed_id] = (map[l.bed_id] || 0) + 1;
    }
  });
  _infoLodgerOnBedMap = map;
  _infoLodgerMapVersion = version;
  return map;
}

function infoActiveLodgerCount(bedId) {
  return infoLodgerOnBedMap()[bedId] || 0;
}

function infoRoomRows() {
  if (!infoUseApiData()) {
    return query(`
      SELECT r.*, (SELECT COUNT(*) FROM beds WHERE room_id = r.id AND status != '备用') AS bed_count
      FROM rooms r ORDER BY r.name
    `);
  }
  var rooms = infoModuleTables("settings_beds").rooms || [];
  var beds = infoModuleTables("settings_beds").beds || [];
  return rooms
    .slice()
    .sort(function (a, b) {
      return String(a.name).localeCompare(String(b.name));
    })
    .map(function (r) {
      return Object.assign({}, r, {
        bed_count: beds.filter(function (b) {
          return b.room_id === r.id && b.status !== "备用";
        }).length,
      });
    });
}

function infoBedRowsJoined() {
  if (!infoUseApiData()) {
    return query(`
      SELECT b.*, r.name AS room_name, r.dorm_type,
             (SELECT COUNT(*) FROM lodgers WHERE bed_id = b.id AND status = '在住') AS occupant_count
      FROM beds b JOIN rooms r ON r.id = b.room_id
      ORDER BY r.name, b.bed_number
    `);
  }
  var beds = infoModuleTables("settings_beds").beds || [];
  var rooms = infoModuleTables("settings_beds").rooms || [];
  var roomById = {};
  rooms.forEach(function (r) {
    roomById[r.id] = r;
  });
  return beds
    .slice()
    .sort(function (a, b) {
      var ra = roomById[a.room_id];
      var rb = roomById[b.room_id];
      var cmp = String(ra && ra.name).localeCompare(String(rb && rb.name));
      if (cmp !== 0) return cmp;
      return String(a.bed_number).localeCompare(String(b.bed_number));
    })
    .map(function (b) {
      var room = roomById[b.room_id] || {};
      var occupantCount = infoActiveLodgerCount(b.id);
      return Object.assign({}, b, {
        room_name: room.name || "",
        dorm_type: room.dorm_type || "",
        occupant_count: occupantCount,
      });
    });
}

function infoRoomOptions() {
  if (!infoUseApiData()) {
    return query("SELECT id, name FROM rooms ORDER BY name");
  }
  return (infoModuleTables("settings_beds").rooms || [])
    .slice()
    .sort(function (a, b) {
      return String(a.name).localeCompare(String(b.name));
    });
}

function infoGuestRows() {
  if (!infoUseApiData()) {
    return query(`
      SELECT g.*,
             (SELECT COUNT(*) FROM lodgers WHERE guest_id = g.id) AS lodger_count
      FROM guests g ORDER BY g.updated_at DESC, g.id DESC
    `);
  }
  var guests = infoModuleTables("settings_guests").guests || [];
  var lodgers = infoModuleTables("lodgers").lodgers || [];
  return guests
    .slice()
    .sort(function (a, b) {
      var ta = String(a.updated_at || "");
      var tb = String(b.updated_at || "");
      if (ta !== tb) return tb.localeCompare(ta);
      return (b.id || 0) - (a.id || 0);
    })
    .map(function (g) {
      return Object.assign({}, g, {
        lodger_count: lodgers.filter(function (l) {
          return l.guest_id === g.id;
        }).length,
      });
    });
}

function infoLodgerRowsJoined() {
  if (!infoUseApiData()) {
    return query(`
      SELECT l.*, r.name AS room_name, b.bed_number
      FROM lodgers l
      LEFT JOIN beds b ON b.id = l.bed_id
      LEFT JOIN rooms r ON r.id = b.room_id
      ORDER BY l.check_in_date DESC, l.id DESC
    `);
  }
  var lodgers = infoModuleTables("lodgers").lodgers || [];
  var beds = infoModuleTables("lodgers").beds || [];
  var rooms = infoModuleTables("lodgers").rooms || [];
  var bedById = {};
  var roomById = {};
  beds.forEach(function (b) {
    bedById[b.id] = b;
  });
  rooms.forEach(function (r) {
    roomById[r.id] = r;
  });
  return lodgers
    .slice()
    .sort(function (a, b) {
      var da = String(a.check_in_date || "");
      var db = String(b.check_in_date || "");
      if (da !== db) return db.localeCompare(da);
      return (b.id || 0) - (a.id || 0);
    })
    .map(function (l) {
      var bed = l.bed_id ? bedById[l.bed_id] : null;
      var room = bed && bed.room_id ? roomById[bed.room_id] : null;
      return Object.assign({}, l, {
        room_name: room ? room.name : "",
        bed_number: bed ? bed.bed_number : "",
      });
    });
}

function infoFindRoom(id) {
  return infoRoomRows().find(function (r) {
    return r.id == id;
  });
}

function infoFindBed(id) {
  return (infoModuleTables("settings_beds").beds || []).find(function (b) {
    return b.id == id;
  });
}

function infoFindGuest(id) {
  return (infoModuleTables("settings_guests").guests || []).find(function (g) {
    return g.id == id;
  });
}

function infoFindLodger(id) {
  return (infoModuleTables("lodgers").lodgers || []).find(function (l) {
    return l.id == id;
  });
}

function infoLodgerContextRooms() {
  return (
    infoModuleTables("lodgers").rooms ||
    infoModuleTables("settings_beds").rooms ||
    []
  );
}

function infoLodgerContextBeds() {
  return (
    infoModuleTables("lodgers").beds ||
    infoModuleTables("settings_beds").beds ||
    []
  );
}

function infoLodgerPaymentBalance(lodgerId) {
  var payments = infoModuleTables("lodgers").payments || [];
  var income = 0;
  var refund = 0;
  payments.forEach(function (p) {
    if (p.lodger_id != lodgerId) return;
    if (p.type === "押金" || p.type === "房费") income += p.amount || 0;
    if (p.type === "退款") refund += p.amount || 0;
  });
  return income - refund;
}

function infoBedWithRoom(bedId) {
  var bed = infoLodgerContextBeds().find(function (b) {
    return b.id == bedId;
  });
  if (!bed) return null;
  var room = infoLodgerContextRooms().find(function (r) {
    return r.id == bed.room_id;
  });
  return Object.assign({}, bed, { dorm_type: room ? room.dorm_type : "" });
}

function infoBedsForRoom(roomId) {
  if (!infoUseApiData()) {
    return query(
      "SELECT id, bed_number, status FROM beds WHERE room_id = ? ORDER BY bed_number",
      [roomId],
    );
  }
  return infoLodgerContextBeds()
    .filter(function (b) {
      return String(b.room_id) === String(roomId);
    })
    .sort(function (a, b) {
      return String(a.bed_number).localeCompare(String(b.bed_number));
    });
}

/** 写后：服务端 patches + 缓存直绘 + 后台对账 | Post-write: server patches + instant render */
var INFO_WRITE_SYNC = {
  upsertModuleSync: false,
  skipModuleSync: true,
};

function infoApplyWritePatches(writeResult, syncOptions) {
  if (
    writeResult &&
    typeof rcApplyWriteResult === "function" &&
    (writeResult.patches || writeResult.deletions)
  ) {
    rcApplyWriteResult(writeResult);
    return;
  }
  var opt = syncOptions && syncOptions.optimistic;
  if (!opt || typeof rcApplyDeltaPatches !== "function") return;
  try {
    rcApplyDeltaPatches(opt.patches || {}, opt.deletions || []);
  } catch (e) {
    console.warn("info optimistic patch failed:", e.message || e);
  }
}

function infoRefreshAfterWrite(writeResult, tab, syncOptions) {
  tab = tab || infoCurrentTab;
  syncOptions = syncOptions || {};
  if (!infoUseApiData()) {
    infoInvalidateForTab(tab);
    renderInfo(tab);
    return;
  }
  if (typeof rcRefreshAfterWrite === "function") {
    rcRefreshAfterWrite(
      writeResult,
      Object.assign(
        {
          infoOnly: true,
          infoTab: tab,
          skipViewRefresh: true,
        },
        INFO_WRITE_SYNC,
        syncOptions,
        {
          skipViewRefresh: false,
          viewRefresh: function () {
            renderInfo(tab);
          },
        },
      ),
    );
    return;
  }
  infoApplyWritePatches(writeResult, syncOptions);
  if (typeof touchBoardVersionFromWrite === "function") {
    touchBoardVersionFromWrite(writeResult);
  }
  renderInfo(tab);
}

/** 乐观更新用临时 ID | Temp id for optimistic create rows */
function infoTempId() {
  return -Math.abs((Date.now() % 2147483647) || 1);
}

/** 立即 patch 缓存并重绘列表 | Optimistic cache patch + instant list render */
function infoApplyOptimistic(optimistic, tab) {
  if (!infoUseApiData() || !optimistic) return;
  infoApplyWritePatches(null, { optimistic: optimistic });
  _infoLodgerOnBedMap = null;
  tab = tab || infoCurrentTab;
  delete _infoLastToolbarHash[tab];
  infoRenderCurrentTabLists();
}

/** API 失败后回滚 | Revert optimistic UI after failed write */
async function infoRevertTab(tab) {
  if (!infoUseApiData()) return;
  infoInvalidateForTab(tab);
  _infoLodgerOnBedMap = null;
  await infoLoadAndRenderCurrentTab({ forceFetch: true, skipLoading: true });
}

function infoConfirm(msg) {
  return confirm(msg);
}

function infoSelectHtml(id, options, selected, attrs) {
  let html = `<select id="${id}" ${attrs || ""}>`;
  options.forEach((opt) => {
    const value = Array.isArray(opt) ? opt[0] : opt;
    const label = Array.isArray(opt) ? opt[1] : opt;
    html += `<option value="${infoEscape(value)}" ${value === selected ? "selected" : ""}>${infoEscape(label)}</option>`;
  });
  html += "</select>";
  return html;
}

function infoField(label, inputHtml, errorId) {
  return `
    <div class="field">
      <label>${infoEscape(label)}</label>
      ${inputHtml}
      <div class="field-error" id="${infoEscape(errorId)}"></div>
    </div>
  `;
}

function infoShowFieldError(id, msg) {
  const el = document.getElementById(id + "-error");
  if (el) el.textContent = msg || "";
  const input = document.getElementById(id);
  if (input) input.classList.add("invalid");
}

function infoClearErrors(prefix) {
  document
    .querySelectorAll(`[id^="${prefix}"][id$="-error"]`)
    .forEach((el) => (el.textContent = ""));
  document.querySelectorAll(`[id^="${prefix}"]`).forEach((el) => {
    if (
      el.tagName === "INPUT" ||
      el.tagName === "SELECT" ||
      el.tagName === "TEXTAREA"
    ) {
      el.classList.remove("invalid");
    }
  });
}

function infoGetValue(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : "";
}

function infoGetInt(id) {
  const v = parseInt(infoGetValue(id), 10);
  return isNaN(v) ? 0 : v;
}

/* ── 房间管理 | Room Management ── */

function renderRoomList() {
  const f = infoGetFilters("rooms");
  const rooms = infoRoomRows();
  const locations = [
    ...new Set(
      rooms.map((r) => r.location).filter((loc) => loc && String(loc).trim()),
    ),
  ].sort();
  const filtered = rooms.filter((r) => {
    if (f.location && r.location !== f.location) return false;
    if (f.dorm && r.dorm_type !== f.dorm) return false;
    if (
      f.q &&
      !infoTextIncludes(
        [r.name, r.location, r.notes, r.dorm_type].join(" "),
        f.q,
      )
    ) {
      return false;
    }
    return true;
  });

  const toolbar = infoToolbarHtml(
    `${infoSearchBox("rooms", "搜索房间名、位置…")}
     ${infoFilterSelect(
       "rooms",
       "location",
       "位置筛选",
       locations.map((loc) => [loc, loc]),
       "位置筛选",
     )}
     ${infoFilterSelect(
       "rooms",
       "dorm",
       "类型筛选",
       INFO_DORM_OPTIONS.map((d) => [d, d]),
       "类型筛选",
     )}`,
    `<button type="button" class="btn btn-primary" onclick="openRoomModal()">+ 新增房间</button>`,
  );

  if (!filtered.length) {
    _infoLastToolbarHash.rooms = infoToolbarHash("rooms", toolbar);
    infoPageShell(
      toolbar,
      infoEmptyTable(
        rooms.length ? "没有符合条件的房间。" : "暂无房间，请先新增。",
      ),
    );
    return;
  }

  let rowsHtml = "";
  filtered.forEach((r) => {
    rowsHtml += `<tr>
      <td>${infoEscape(r.name)}</td>
      <td>${infoEscape(r.location)}</td>
      <td>${r.floor}</td>
      <td>${infoEscape(r.dorm_type)}</td>
      <td>${infoEscape(r.notes)}</td>
      <td>${r.bed_count}</td>
      <td>${infoActionLinks(`openRoomModal(${r.id})`, `deleteRoom(${r.id})`)}</td>
    </tr>`;
  });
  const tableHtml = `<div class="table-wrap"><table>
    <thead><tr>
      <th>房间名</th><th>位置</th><th>楼层</th><th>寮房类型</th><th>备注</th><th>床位</th><th>操作</th>
    </tr></thead><tbody>${rowsHtml}</tbody></table></div>`;
  infoFinishListRender("rooms", toolbar, tableHtml, rowsHtml, "");
}

function openRoomModal(id) {
  const isEdit = !!id;
  let r = { name: "", location: "", floor: 1, dorm_type: "不限", notes: "" };
  if (isEdit) {
    const row = infoFindRoom(id);
    if (!row) return infoToast("房间不存在");
    r = row;
  }
  document.getElementById("modal-title").textContent = isEdit
    ? "编辑房间"
    : "新增房间";
  setModalBody(`
    <form id="room-form" class="form-grid" onsubmit="event.preventDefault(); submitRoom(${id || "null"});">
      ${infoField("房间名 *", `<input type="text" id="info-room-name" value="${infoEscape(r.name)}">`, "info-room-name")}
      ${infoField("位置", `<input type="text" id="info-room-location" value="${infoEscape(r.location)}">`, "info-room-location")}
      ${infoField("楼层", `<input type="number" id="info-room-floor" value="${r.floor}">`, "info-room-floor")}
      ${infoField("寮房类型", infoSelectHtml("info-room-dorm", INFO_DORM_OPTIONS, r.dorm_type), "info-room-dorm")}
      ${roomTagFieldsHtml(r)}
      ${infoField("备注", `<textarea id="info-room-notes" rows="2">${infoEscape(r.notes)}</textarea>`, "info-room-notes")}
    </form>
    <div class="btn-bar" style="margin-top: var(--space-4);">
      <button class="btn btn-primary" onclick="submitRoom(${id || "null"})">保存</button>
      <button class="btn btn-default" onclick="closeModal()">取消</button>
    </div>
  `);
  document.getElementById("modal").classList.add("active");
}

async function submitRoom(id) {
  infoClearErrors("info-room-");
  const name = infoGetValue("info-room-name");
  const location = infoGetValue("info-room-location");
  const floor = infoGetInt("info-room-floor");
  const dorm = infoGetValue("info-room-dorm");
  const notes = infoGetValue("info-room-notes");
  let roomTags;
  try {
    roomTags = readRoomTagFieldsFromForm();
  } catch (err) {
    alert(err.message || String(err));
    return;
  }

  if (!name) {
    infoShowFieldError("info-room-name", "房间名为必填");
    return scrollToFirstError(["info-room-name"]);
  }
  if (!INFO_DORM_OPTIONS.includes(dorm)) {
    infoShowFieldError("info-room-dorm", "请选择有效的寮房类型");
    return;
  }
  const dup = infoRoomRows().find(function (r) {
    return r.name === name && r.id != (id || 0);
  });
  if (dup) {
    infoShowFieldError("info-room-name", "房间名已存在");
    return;
  }

  try {
    var payload = {
      room_id: id,
      name: name,
      location: location,
      floor: floor || 1,
      dorm_type: dorm,
      notes: notes,
      ...roomTags,
    };
    if (infoUseApiData()) {
      closeModal();
      infoApplyOptimistic(
        {
          patches: {
            rooms: [
              Object.assign({}, payload, {
                id: id || infoTempId(),
              }),
            ],
          },
          deletions: [],
        },
        "rooms",
      );
    }
    var writeResult = await apiAdminRecord(
      "room",
      id ? "update" : "create",
      payload,
    );
    if (!infoUseApiData()) closeModal();
    infoToast(id ? "房间已更新" : "房间已新增");
    infoRefreshAfterWrite(writeResult, "rooms");
  } catch (e) {
    console.error(e);
    if (infoUseApiData()) await infoRevertTab("rooms");
    infoToast("保存失败：" + e.message);
  }
}

async function deleteRoom(id) {
  const r = infoFindRoom(id);
  if (!r) return infoToast("房间不存在");
  const bedCount = (infoModuleTables("settings_beds").beds || []).filter(
    function (b) {
      return b.room_id == id;
    },
  ).length;
  if (bedCount > 0) {
    return infoToast(
      `该房间下还有 ${bedCount} 张床位，请先删除床位后再删除房间`,
    );
  }
  if (!infoConfirm(`确定删除房间「${r.name}」吗？此操作不可恢复。`)) return;
  try {
    if (infoUseApiData()) {
      infoApplyOptimistic(
        {
          patches: {},
          deletions: [{ table_name: "rooms", row_id: id }],
        },
        "rooms",
      );
    }
    var writeResult = await apiAdminRecord("room", "delete", { room_id: id });
    infoToast("房间已删除");
    infoRefreshAfterWrite(writeResult, "rooms");
  } catch (e) {
    console.error(e);
    if (infoUseApiData()) await infoRevertTab("rooms");
    infoToast("删除失败：" + e.message);
  }
}

/* ── 床位管理 | Bed Management ── */

function renderBedList() {
  const f = infoGetFilters("beds");
  const beds = infoBedRowsJoined();
  const rooms = infoRoomOptions();
  const filtered = beds.filter((b) => {
    const statusLabel = b.occupant_count > 0 ? "占用" : b.status;
    if (f.roomId && String(b.room_id) !== String(f.roomId)) return false;
    if (f.status && statusLabel !== f.status) return false;
    if (
      f.q &&
      !infoTextIncludes(
        [b.room_name, b.bed_number, b.notes, b.bed_type, statusLabel].join(" "),
        f.q,
      )
    ) {
      return false;
    }
    return true;
  });

  const statusOptions = ["可用", "占用", "维修", "备用"];
  const toolbar = infoToolbarHtml(
    `${infoSearchBox("beds", "搜索房间、床位号…")}
     ${infoFilterSelect(
       "beds",
       "roomId",
       "房间筛选",
       rooms.map((r) => [r.id, r.name]),
       "房间筛选",
     )}
     ${infoFilterSelect(
       "beds",
       "status",
       "状态筛选",
       statusOptions.map((s) => [s, s]),
       "状态筛选",
     )}`,
    `<button type="button" class="btn btn-primary" onclick="openBedModal()">+ 新增床位</button>`,
  );

  if (!filtered.length) {
    _infoLastToolbarHash.beds = infoToolbarHash("beds", toolbar);
    infoPageShell(
      toolbar,
      infoEmptyTable(
        beds.length ? "没有符合条件的床位。" : "暂无床位，请先新增。",
      ),
    );
    return;
  }

  let rowsHtml = "";
  filtered.forEach((b) => {
    const statusLabel = b.occupant_count > 0 ? "占用" : b.status;
    rowsHtml += `<tr>
      <td>${infoEscape(b.room_name)}</td>
      <td>${infoEscape(b.bed_number)}</td>
      <td>${infoEscape(b.bed_type || "单床")}</td>
      <td>${infoEscape(b.dorm_type)}</td>
      <td>${infoEscape(statusLabel)}</td>
      <td>${infoEscape(b.notes)}</td>
      <td>${infoActionLinks(`openBedModal(${b.id})`, `deleteBed(${b.id})`)}</td>
    </tr>`;
  });
  const tableHtml = `<div class="table-wrap"><table>
    <thead><tr>
      <th>房间</th><th>床位号</th><th>床位类型</th><th>寮房类型</th><th>状态</th><th>备注</th><th>操作</th>
    </tr></thead><tbody>${rowsHtml}</tbody></table></div>`;
  infoFinishListRender("beds", toolbar, tableHtml, rowsHtml, "");
}

function openBedModal(id) {
  const isEdit = !!id;
  let b = { room_id: "", bed_number: "", status: "可用", notes: "" };
  let occupied = false;
  if (isEdit) {
    const row = infoBedRowsJoined().find(function (b) {
      return b.id == id;
    });
    if (!row) return infoToast("床位不存在");
    b = row;
    occupied = row.occupant_count > 0;
  }
  const rooms = infoRoomOptions();
  const roomOptions = rooms.map((r) => [r.id, r.name]);
  const statusOptions = occupied ? ["占用"] : INFO_BED_STATUS_OPTIONS;
  const statusValue = occupied ? "占用" : b.status;

  document.getElementById("modal-title").textContent = isEdit
    ? "编辑床位"
    : "新增床位";
  setModalBody(`
    <form id="bed-form" class="form-grid" onsubmit="event.preventDefault(); submitBed(${id || "null"});">
      ${infoField("所属房间 *", infoSelectHtml("info-bed-room", roomOptions, b.room_id, "required"), "info-bed-room")}
      ${infoField("床位号 *", `<input type="text" id="info-bed-number" value="${infoEscape(b.bed_number)}">`, "info-bed-number")}
      ${infoField("状态", infoSelectHtml("info-bed-status", statusOptions, statusValue, occupied ? "disabled" : ""), "info-bed-status")}
      ${bedTagFieldsHtml(b)}
      ${infoField("备注", `<textarea id="info-bed-notes" rows="2">${infoEscape(b.notes)}</textarea>`, "info-bed-notes")}
    </form>
    <div class="btn-bar" style="margin-top: var(--space-4);">
      <button class="btn btn-primary" onclick="submitBed(${id || "null"})">保存</button>
      <button class="btn btn-default" onclick="closeModal()">取消</button>
    </div>
  `);
  document.getElementById("modal").classList.add("active");
}

async function submitBed(id) {
  infoClearErrors("info-bed-");
  const roomId = infoGetInt("info-bed-room");
  const number = infoGetValue("info-bed-number");
  const status = infoGetValue("info-bed-status");
  const notes = infoGetValue("info-bed-notes");
  let bedTags;
  try {
    bedTags = readBedTagFieldsFromForm();
  } catch (err) {
    alert(err.message || String(err));
    return;
  }

  if (!roomId) {
    infoShowFieldError("info-bed-room", "请选择所属房间");
    return;
  }
  if (!number) {
    infoShowFieldError("info-bed-number", "床位号为必填");
    return scrollToFirstError(["info-bed-number"]);
  }
  if (!INFO_BED_STATUS_OPTIONS.includes(status)) {
    infoShowFieldError("info-bed-status", "请选择有效的床位状态");
    return;
  }
  const dup = (infoModuleTables("settings_beds").beds || []).find(function (b) {
    return b.room_id == roomId && b.bed_number === number && b.id != (id || 0);
  });
  if (dup) {
    infoShowFieldError("info-bed-number", "该房间下已存在相同床位号");
    return;
  }
  const occupantCount = id ? infoActiveLodgerCount(id) : 0;
  if (occupantCount > 0 && (status === "维修" || status === "备用")) {
    infoShowFieldError(
      "info-bed-status",
      "该床位当前有住客，不能设为维修或备用",
    );
    return;
  }

  try {
    var payload = {
      bed_id: id,
      room_id: roomId,
      bed_number: number,
      status: status,
      notes: notes,
      ...bedTags,
    };
    if (infoUseApiData()) {
      closeModal();
      infoApplyOptimistic(
        {
          patches: {
            beds: [
              Object.assign({}, payload, {
                id: id || infoTempId(),
              }),
            ],
          },
          deletions: [],
        },
        "beds",
      );
    }
    var writeResult = await apiAdminRecord(
      "bed",
      id ? "update" : "create",
      payload,
    );
    if (!infoUseApiData()) closeModal();
    infoToast(id ? "床位已更新" : "床位已新增");
    infoRefreshAfterWrite(writeResult, "beds");
  } catch (e) {
    console.error(e);
    if (infoUseApiData()) await infoRevertTab("beds");
    infoToast("保存失败：" + e.message);
  }
}

async function deleteBed(id) {
  const b = infoBedRowsJoined().find(function (row) {
    return row.id == id;
  });
  if (!b) return infoToast("床位不存在");
  if (b.occupant_count > 0) {
    return infoToast("该床位当前有在住住客，无法删除");
  }
  if (
    !infoConfirm(
      `确定删除 ${infoEscape(b.room_name)} 的 ${infoEscape(b.bed_number)} 吗？此操作不可恢复。`,
    )
  )
    return;
  try {
    if (infoUseApiData()) {
      infoApplyOptimistic(
        {
          patches: {},
          deletions: [{ table_name: "beds", row_id: id }],
        },
        "beds",
      );
    }
    var writeResult = await apiAdminRecord("bed", "delete", { bed_id: id });
    infoToast("床位已删除");
    infoRefreshAfterWrite(writeResult, "beds");
  } catch (e) {
    console.error(e);
    if (infoUseApiData()) await infoRevertTab("beds");
    infoToast("删除失败：" + e.message);
  }
}

/* ── 住客主档案 | Guest Master Profile ── */

function renderGuestList() {
  const f = infoGetFilters("guests");
  const guests = infoGuestRows();
  const filtered = guests.filter((g) => {
    if (f.gender && g.gender !== f.gender) return false;
    if (
      f.q &&
      !infoTextIncludes(
        [g.name, g.dharma_name, g.phone, g.id_card, g.emergency_contact].join(
          " ",
        ),
        f.q,
      )
    ) {
      return false;
    }
    return true;
  });

  const toolbar = infoToolbarHtml(
    `${infoSearchBox("guests", "搜索姓名、手机号…")}
     ${infoFilterSelect(
       "guests",
       "gender",
       "性别筛选",
       INFO_GENDER_OPTIONS.map((g) => [g, g]),
       "性别筛选",
     )}`,
    `<button type="button" class="btn btn-primary" onclick="openGuestModal()">+ 新增住客档案</button>`,
  );

  if (!filtered.length) {
    _infoLastToolbarHash.guests = infoToolbarHash("guests", toolbar);
    infoPageShell(
      toolbar,
      infoEmptyTable(
        guests.length ? "没有符合条件的住客档案。" : "暂无住客档案。",
      ),
    );
    return;
  }

  let rowsHtml = "";
  filtered.forEach((g) => {
    rowsHtml += `<tr>
      <td>${infoEscape(personDisplayName(g))}</td>
      <td>${infoEscape(g.gender)}</td>
      <td>${infoEscape(g.phone)}</td>
      <td>${infoEscape(g.id_card)}</td>
      <td>${infoEscape(g.emergency_contact)}${g.emergency_phone ? "<br>" + infoEscape(g.emergency_phone) : ""}</td>
      <td>${g.visit_count || 0}</td>
      <td>${infoEscape(g.last_visit_date)}</td>
      <td>${infoActionLinks(`openGuestModal(${g.id})`, `deleteGuest(${g.id})`)}</td>
    </tr>`;
  });
  const tableHtml = `<div class="table-wrap"><table>
    <thead><tr>
      <th>姓名 / 法名</th><th>性别</th><th>手机号</th><th>身份证</th>
      <th>紧急联系人</th><th>到访次数</th><th>最近到访</th><th>操作</th>
    </tr></thead><tbody>${rowsHtml}</tbody></table></div>`;
  infoFinishListRender("guests", toolbar, tableHtml, rowsHtml, "");
}

function openGuestModal(id) {
  const isEdit = !!id;
  let g = {
    name: "",
    dharma_name: "",
    gender: "男",
    phone: "",
    id_card: "",
    emergency_contact: "",
    emergency_phone: "",
    notes: "",
  };
  if (isEdit) {
    const row = infoFindGuest(id);
    if (!row) return infoToast("住客档案不存在");
    g = row;
  }
  document.getElementById("modal-title").textContent = isEdit
    ? "编辑住客档案"
    : "新增住客档案";
  setModalBody(`
    <form id="guest-form" class="form-grid" onsubmit="event.preventDefault(); submitGuest(${id || "null"});">
      ${infoField("姓名 / 法名 *", `<input type="text" id="info-guest-name" value="${infoEscape(personNameInputValue(g))}" placeholder="姓名或法名">`, "info-guest-name")}
      ${infoField("性别", infoSelectHtml("info-guest-gender", INFO_GENDER_OPTIONS, g.gender), "info-guest-gender")}
      ${infoField("手机号", `<input type="tel" id="info-guest-phone" maxlength="11" value="${infoEscape(g.phone)}">`, "info-guest-phone")}
      ${infoField("身份证", `<input type="text" id="info-guest-idcard" maxlength="18" value="${infoEscape(g.id_card)}">`, "info-guest-idcard")}
      ${infoField("紧急联系人", `<input type="text" id="info-guest-emergency" value="${infoEscape(g.emergency_contact)}">`, "info-guest-emergency")}
      ${infoField("紧急联系电话", `<input type="tel" id="info-guest-emergency-phone" maxlength="11" value="${infoEscape(g.emergency_phone)}">`, "info-guest-emergency-phone")}
      ${infoField("备注", `<textarea id="info-guest-notes" rows="2">${infoEscape(g.notes)}</textarea>`, "info-guest-notes")}
    </form>
    <div class="btn-bar" style="margin-top: var(--space-4);">
      <button class="btn btn-primary" onclick="submitGuest(${id || "null"})">保存</button>
      <button class="btn btn-default" onclick="closeModal()">取消</button>
    </div>
  `);
  document.getElementById("modal").classList.add("active");
}

async function submitGuest(id) {
  infoClearErrors("info-guest-");
  const person = parsePersonNameInput(infoGetValue("info-guest-name"));
  const name = person.name;
  const gender = infoGetValue("info-guest-gender");
  const phone = infoGetValue("info-guest-phone");
  const idCard = infoGetValue("info-guest-idcard");
  const emergency = infoGetValue("info-guest-emergency");
  const emergencyPhone = infoGetValue("info-guest-emergency-phone");
  const notes = infoGetValue("info-guest-notes");

  if (!name) {
    infoShowFieldError("info-guest-name", "姓名 / 法名为必填");
    return scrollToFirstError(["info-guest-name"]);
  }
  const contact = validateGuestContact({
    phone: phone,
    idCard: idCard,
    emergencyName: emergency,
    emergencyPhone: emergencyPhone,
  });
  if (!contact.ok) {
    if (contact.field === "idcard") {
      infoShowFieldError("info-guest-idcard", contact.msg);
    } else if (contact.field === "phone") {
      infoShowFieldError("info-guest-phone", contact.msg);
    } else if (contact.field === "emergency_phone") {
      infoShowFieldError("info-guest-emergency-phone", contact.msg);
    } else {
      alert(contact.msg);
    }
    return;
  }
  const dupPhone =
    contact.phone &&
    infoGuestRows().find(function (g) {
      return g.phone === contact.phone && g.id != (id || 0);
    });
  if (dupPhone) {
    infoShowFieldError("info-guest-phone", "该手机号已存在");
    return;
  }
  const dupIdCard =
    contact.idCard &&
    infoGuestRows().find(function (g) {
      return g.id_card === contact.idCard && g.id != (id || 0);
    });
  if (dupIdCard) {
    infoShowFieldError("info-guest-idcard", "该身份证已存在");
    return;
  }

  try {
    var payload = {
      guest_id: id,
      name: name,
      gender: gender,
      phone: contact.phone,
      id_card: contact.idCard,
      emergency_contact: contact.emergencyName,
      emergency_phone: contact.emergencyPhone,
      notes: notes,
    };
    if (infoUseApiData()) {
      closeModal();
      infoApplyOptimistic(
        {
          patches: {
            guests: [
              Object.assign({}, payload, {
                id: id || infoTempId(),
              }),
            ],
          },
          deletions: [],
        },
        "guests",
      );
    }
    var writeResult = await apiAdminRecord(
      "guest",
      id ? "update" : "create",
      payload,
    );
    if (!infoUseApiData()) closeModal();
    infoToast(id ? "住客档案已更新" : "住客档案已新增");
    infoRefreshAfterWrite(writeResult, "guests");
  } catch (e) {
    console.error(e);
    if (infoUseApiData()) await infoRevertTab("guests");
    infoToast("保存失败：" + e.message);
  }
}

async function deleteGuest(id) {
  const g = infoFindGuest(id);
  if (!g) return infoToast("住客档案不存在");
  const refCount = g.lodger_count || 0;
  if (refCount > 0) {
    return infoToast(`该档案已被 ${refCount} 条挂单记录引用，无法删除`);
  }
  if (
    !infoConfirm(
      `确定删除住客档案「${personDisplayName(g)}」吗？此操作不可恢复。`,
    )
  )
    return;
  try {
    if (infoUseApiData()) {
      infoApplyOptimistic(
        {
          patches: {},
          deletions: [{ table_name: "guests", row_id: id }],
        },
        "guests",
      );
    }
    var writeResult = await apiAdminRecord("guest", "delete", { guest_id: id });
    infoToast("住客档案已删除");
    infoRefreshAfterWrite(writeResult, "guests");
  } catch (e) {
    console.error(e);
    if (infoUseApiData()) await infoRevertTab("guests");
    infoToast("删除失败：" + e.message);
  }
}

/* ── 挂单记录 | Lodger Records ── */

function renderLodgerList() {
  const f = infoGetFilters("lodgers");
  const lodgers = infoLodgerRowsJoined();
  const filtered = lodgers.filter((l) => {
    if (f.status && l.status !== f.status) return false;
    if (f.source && (l.source || "现场") !== f.source) return false;
    if (
      f.q &&
      !infoTextIncludes(
        [
          l.name,
          l.dharma_name,
          l.phone,
          l.room_name,
          l.bed_number,
          l.notes,
        ].join(" "),
        f.q,
      )
    ) {
      return false;
    }
    return true;
  });

  const toolbar = infoToolbarHtml(
    `${infoSearchBox("lodgers", "搜索姓名、房号…")}
     ${infoFilterSelect(
       "lodgers",
       "status",
       "状态筛选",
       INFO_LODGER_STATUS_OPTIONS.map((s) => [s, s]),
       "状态筛选",
     )}
     ${infoFilterSelect(
       "lodgers",
       "source",
       "来源筛选",
       INFO_SOURCE_OPTIONS.map((s) => [s, s]),
       "来源筛选",
     )}`,
    `<button type="button" class="btn btn-primary" onclick="showView('checkin')">+ 新增挂单（去住宿办理）</button>`,
  );

  if (!filtered.length) {
    _infoLastToolbarHash.lodgers = infoToolbarHash("lodgers", toolbar);
    infoPageShell(
      toolbar,
      infoEmptyTable(
        lodgers.length ? "没有符合条件的挂单记录。" : "暂无挂单记录。",
      ),
    );
    return;
  }

  let rowsHtml = "";
  filtered.forEach((l) => {
    const roomBed =
      (l.room_name ? infoEscape(l.room_name) : "-") +
      (l.bed_number ? " / " + infoEscape(l.bed_number) : "");
    rowsHtml += `<tr>
      <td>${infoEscape(personDisplayName(l))}</td>
      <td>${infoEscape(l.gender)}</td>
      <td>${infoEscape(l.phone)}</td>
      <td>${roomBed}</td>
      <td>${infoEscape(l.check_in_date)}</td>
      <td>${infoEscape(l.expected_check_out)}</td>
      <td>${infoEscape(l.status)}</td>
      <td>${infoEscape(l.source)}</td>
      <td>${infoEscape(l.notes)}</td>
      <td>${infoActionLinks(`openLodgerModal(${l.id})`, `deleteInfoLodger(${l.id})`)}</td>
    </tr>`;
  });
  const tableHtml = `<div class="table-wrap"><table>
    <thead><tr>
      <th>姓名 / 法名</th><th>性别</th><th>手机号</th><th>房间/床位</th>
      <th>入住日</th><th>预离日</th><th>状态</th><th>来源</th><th>备注</th><th>操作</th>
    </tr></thead><tbody>${rowsHtml}</tbody></table></div>`;
  infoFinishListRender("lodgers", toolbar, tableHtml, rowsHtml, "");
}

function openLodgerModal(id) {
  const l = infoFindLodger(id);
  if (!l) return infoToast("挂单记录不存在");

  const rooms = infoLodgerContextRooms()
    .slice()
    .sort(function (a, b) {
      return String(a.name).localeCompare(String(b.name));
    });
  const currentBed = l.bed_id
    ? infoLodgerContextBeds().find(function (b) {
        return b.id == l.bed_id;
      })
    : null;
  const currentRoomId = currentBed ? currentBed.room_id : "";

  const roomOptions = [["", "请选择房间"], ...rooms.map((r) => [r.id, r.name])];
  const sourceOptions = INFO_SOURCE_OPTIONS;
  const statusOptions = INFO_LODGER_STATUS_OPTIONS;

  const beds = currentRoomId ? infoBedsForRoom(currentRoomId) : [];
  const bedOptions = [
    ["", "请选择床位"],
    ...beds.map((b) => [b.id, b.bed_number]),
  ];

  document.getElementById("modal-title").textContent = "编辑挂单记录";
  setModalBody(`
    <form id="lodger-form" class="form-grid" onsubmit="event.preventDefault(); submitLodger(${id});">
      ${infoField("姓名 / 法名 *", `<input type="text" id="info-lodger-name" value="${infoEscape(personNameInputValue(l))}" placeholder="姓名或法名">`, "info-lodger-name")}
      ${infoField("性别", infoSelectHtml("info-lodger-gender", INFO_GENDER_OPTIONS, l.gender), "info-lodger-gender")}
      ${infoField("手机号", `<input type="tel" id="info-lodger-phone" maxlength="11" value="${infoEscape(l.phone)}">`, "info-lodger-phone")}
      ${infoField("身份证", `<input type="text" id="info-lodger-idcard" maxlength="18" value="${infoEscape(l.id_card)}">`, "info-lodger-idcard")}
      ${infoField("入住日期", `<input type="date" id="info-lodger-checkin" value="${infoEscape(l.check_in_date)}">`, "info-lodger-checkin")}
      ${infoField("预离日期", `<input type="date" id="info-lodger-checkout" value="${infoEscape(l.expected_check_out)}">`, "info-lodger-checkout")}
      ${infoField("状态", infoSelectHtml("info-lodger-status", statusOptions, l.status), "info-lodger-status")}
      ${infoField("来源", infoSelectHtml("info-lodger-source", sourceOptions, l.source || "现场"), "info-lodger-source")}
      ${infoField("房间", infoSelectHtml("info-lodger-room", roomOptions, currentRoomId, `onchange="infoReloadBedOptions('info-lodger-room','info-lodger-bed',${l.bed_id || "null"})"`), "info-lodger-room")}
      ${infoField("床位", infoSelectHtml("info-lodger-bed", bedOptions, l.bed_id || ""), "info-lodger-bed")}
      ${infoField("备注", `<textarea id="info-lodger-notes" rows="2">${infoEscape(l.notes)}</textarea>`, "info-lodger-notes")}
    </form>
    <div class="btn-bar" style="margin-top: var(--space-4);">
      <button class="btn btn-primary" onclick="submitLodger(${id})">保存</button>
      <button class="btn btn-default" onclick="closeModal()">取消</button>
    </div>
  `);
  document.getElementById("modal").classList.add("active");
}

function infoReloadBedOptions(roomSelectId, bedSelectId, selectedBedId) {
  const roomId = document.getElementById(roomSelectId).value;
  const bedSelect = document.getElementById(bedSelectId);
  if (!roomId) {
    bedSelect.innerHTML = '<option value="">请选择床位</option>';
    return;
  }
  const beds = infoBedsForRoom(roomId);
  let html = '<option value="">请选择床位</option>';
  beds.forEach((b) => {
    html += `<option value="${b.id}" ${b.id == selectedBedId ? "selected" : ""}>${infoEscape(b.bed_number)}</option>`;
  });
  bedSelect.innerHTML = html;
}

async function submitLodger(id) {
  infoClearErrors("info-lodger-");
  const l = infoFindLodger(id);
  if (!l) return infoToast("挂单记录不存在");

  const person = parsePersonNameInput(infoGetValue("info-lodger-name"));
  const name = person.name;
  const gender = infoGetValue("info-lodger-gender");
  const phone = infoGetValue("info-lodger-phone");
  const idCard = infoGetValue("info-lodger-idcard");
  const checkIn = infoGetValue("info-lodger-checkin");
  const expectedOut = infoGetValue("info-lodger-checkout");
  const status = infoGetValue("info-lodger-status");
  const source = infoGetValue("info-lodger-source");
  const roomId = infoGetValue("info-lodger-room");
  const bedIdRaw = infoGetValue("info-lodger-bed");
  const bedId = bedIdRaw ? parseInt(bedIdRaw, 10) : null;
  const notes = infoGetValue("info-lodger-notes");

  if (!name) {
    infoShowFieldError("info-lodger-name", "姓名 / 法名为必填");
    return scrollToFirstError(["info-lodger-name"]);
  }
  const contact = validateEditLodgerContact(id, phone, idCard);
  if (!contact.ok) {
    if (contact.field === "idcard") {
      infoShowFieldError("info-lodger-idcard", contact.msg);
    } else if (contact.field === "phone") {
      infoShowFieldError("info-lodger-phone", contact.msg);
    } else {
      alert(contact.msg);
    }
    return;
  }
  if (!checkIn || !expectedOut) {
    if (!checkIn) infoShowFieldError("info-lodger-checkin", "请选择入住日期");
    if (!expectedOut)
      infoShowFieldError("info-lodger-checkout", "请选择预离日期");
    return;
  }
  if (expectedOut < checkIn) {
    infoShowFieldError("info-lodger-checkout", "预离日期不能早于入住日期");
    return;
  }

  const dup = checkDuplicate(contact.phone, contact.idCard, id);
  if (dup) {
    const infoDup =
      personDisplayName(dup) + (dup.phone ? " · " + dup.phone : "");
    if (
      !confirm(`检测到该手机号/身份证已有在住记录：${infoDup}\n是否继续保存？`)
    )
      return;
  }

  // 床位占用校验：新床位不能被其他在住住客占用
  if (bedId) {
    const other = (infoModuleTables("lodgers").lodgers || []).find(
      function (row) {
        return row.bed_id == bedId && row.status === "在住" && row.id != id;
      },
    );
    if (other) {
      infoShowFieldError("info-lodger-bed", "该床位已被其他在住住客占用");
      return;
    }
    const bed = infoBedWithRoom(bedId);
    if (bed && !dormMatchGender(bed.dorm_type, gender)) {
      infoShowFieldError("info-lodger-bed", "该床位所在房间寮类型与性别不符");
      return;
    }
  }

  let actualOut = l.actual_check_out;
  let finalBedId = bedId;
  if (status === "已退" && l.status === "在住") {
    const balance = infoLodgerPaymentBalance(id);
    if (balance > 0) {
      infoToast(
        "该挂单尚有余额 " +
          balance.toFixed(2) +
          " 元，请使用「退房」功能处理退款",
      );
      return;
    }
    actualOut = todayStr();
    finalBedId = null;
  } else if (status === "在住" && l.status === "已退") {
    actualOut = null;
  }

  try {
    var payload = {
      lodger_id: id,
      name: name,
      gender: gender,
      phone: contact.phone,
      id_card: contact.idCard,
      check_in_date: checkIn,
      expected_check_out: expectedOut,
      status: status,
      source: source,
      bed_id: finalBedId,
      notes: notes,
    };
    if (infoUseApiData()) {
      closeModal();
      infoApplyOptimistic(
        {
          patches: {
            lodgers: [
              Object.assign({}, l, payload, {
                id: id,
              }),
            ],
          },
          deletions: [],
        },
        "lodgers",
      );
    }
    var writeResult = await apiAdminRecord("lodger", "update", payload);
    if (!infoUseApiData()) closeModal();
    infoToast("挂单记录已更新");
    infoRefreshAfterWrite(writeResult, "lodgers");
  } catch (e) {
    console.error(e);
    if (infoUseApiData()) await infoRevertTab("lodgers");
    infoToast("保存失败：" + e.message);
  }
}

async function deleteInfoLodger(id) {
  const l = infoFindLodger(id);
  if (!l) return infoToast("挂单记录不存在");
  const info = personDisplayName(l) + (l.phone ? " · " + l.phone : "");
  if (!infoConfirm(`确定删除挂单记录？\n${info}\n删除后不可恢复。`)) return;
  try {
    if (infoUseApiData()) {
      infoApplyOptimistic(
        {
          patches: {},
          deletions: [{ table_name: "lodgers", row_id: id }],
        },
        "lodgers",
      );
    }
    var writeResult = await apiDeleteLodger({ lodger_id: id });
    infoToast("已删除");
    infoRefreshAfterWrite(writeResult, "lodgers");
  } catch (e) {
    console.error(e);
    if (infoUseApiData()) await infoRevertTab("lodgers");
    infoToast("删除失败：" + e.message);
  }
}
