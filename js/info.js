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

function renderInfo(tab) {
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
  if (infoCurrentTab === "rooms") renderRoomList();
  else if (infoCurrentTab === "beds") renderBedList();
  else if (infoCurrentTab === "guests") renderGuestList();
  else if (infoCurrentTab === "lodgers") renderLodgerList();
  else if (infoCurrentTab === "events") renderEventList();
  if (typeof updateTopbarForInfoTab === "function") {
    updateTopbarForInfoTab(infoCurrentTab);
  }
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
    renderInfo(tab);
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

/** 信息管理写后：乐观本地 + 立即渲染 + 后台 upsert 同步 | Optimistic info refresh */
function infoRefreshAfterWrite(writeResult, tab, optimisticFn) {
  tab = tab || infoCurrentTab;
  if (typeof touchBoardVersionFromWrite === "function") {
    touchBoardVersionFromWrite(writeResult);
  }
  if (!isRemoteDB()) {
    renderInfo(tab);
    return Promise.resolve();
  }
  if (typeof applyRemoteLocalPatch === "function" && typeof optimisticFn === "function") {
    applyRemoteLocalPatch(optimisticFn);
  }
  renderInfo(tab);
  return refreshAfterWrite(writeResult, {
    infoOnly: true,
    infoTab: tab,
    upsertModuleSync: true,
    deferSyncRender: true,
    quietSync: true,
  });
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
  const rooms = query(`
    SELECT r.*, (SELECT COUNT(*) FROM beds WHERE room_id = r.id AND status != '备用') AS bed_count
    FROM rooms r
    ORDER BY r.name
  `);
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
    const row = query("SELECT * FROM rooms WHERE id = ?", [id])[0];
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
  const dup = query("SELECT id FROM rooms WHERE name = ? AND id IS NOT ?", [
    name,
    id || 0,
  ])[0];
  if (dup) {
    infoShowFieldError("info-room-name", "房间名已存在");
    return;
  }

  try {
    var writeResult = null;
    if (useRemoteWriteApi()) {
      writeResult = await apiAdminRecord("room", id ? "update" : "create", {
        room_id: id,
        name: name,
        location: location,
        floor: floor || 1,
        dorm_type: dorm,
        notes: notes,
        ...roomTags,
      });
    } else {
      await withTransaction(async () => {
        if (id) {
          run(
            "UPDATE rooms SET name=?, location=?, floor=?, dorm_type=?, notes=?, room_type=?, suitable_elder=?, suitable_child=?, near_zen_hall=?, flexible_use=? WHERE id=?",
            [
              name,
              location,
              floor || 1,
              dorm,
              notes,
              roomTags.room_type,
              roomTags.suitable_elder,
              roomTags.suitable_child,
              roomTags.near_zen_hall,
              roomTags.flexible_use,
              id,
            ],
          );
          logAudit("更新房间", "room", id, { name });
        } else {
          const result = run(
            "INSERT INTO rooms (name, location, floor, dorm_type, notes, room_type, suitable_elder, suitable_child, near_zen_hall, flexible_use) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
              name,
              location,
              floor || 1,
              dorm,
              notes,
              roomTags.room_type,
              roomTags.suitable_elder,
              roomTags.suitable_child,
              roomTags.near_zen_hall,
              roomTags.flexible_use,
            ],
          );
          const newId = result.lastInsertId;
          logAudit("新增房间", "room", newId, { name });
        }
      });
      await saveDB();
    }
    closeModal();
    infoToast(id ? "房间已更新" : "房间已新增");
    await infoRefreshAfterWrite(writeResult, "rooms", function () {
      var rid = (writeResult && writeResult.room_id) || id;
      if (!rid) return;
      run(
        "INSERT OR REPLACE INTO rooms (id, name, location, floor, dorm_type, notes, room_type, suitable_elder, suitable_child, near_zen_hall, flexible_use, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
        [
          rid,
          name,
          location,
          floor || 1,
          dorm,
          notes,
          roomTags.room_type,
          roomTags.suitable_elder,
          roomTags.suitable_child,
          roomTags.near_zen_hall,
          roomTags.flexible_use,
        ],
      );
    });
  } catch (e) {
    console.error(e);
    infoToast("保存失败：" + e.message);
  }
}

async function deleteRoom(id) {
  const r = query("SELECT name FROM rooms WHERE id = ?", [id])[0];
  if (!r) return infoToast("房间不存在");
  const bedCount =
    query("SELECT COUNT(*) as c FROM beds WHERE room_id = ?", [id])[0]?.c || 0;
  if (bedCount > 0) {
    return infoToast(
      `该房间下还有 ${bedCount} 张床位，请先删除床位后再删除房间`,
    );
  }
  if (!infoConfirm(`确定删除房间「${r.name}」吗？此操作不可恢复。`)) return;
  try {
    var writeResult = null;
    if (useRemoteWriteApi()) {
      writeResult = await apiAdminRecord("room", "delete", { room_id: id });
    } else {
      await withTransaction(async () => {
        run("DELETE FROM rooms WHERE id = ?", [id]);
        logAudit("删除房间", "room", id, { name: r.name });
      });
      await saveDB();
    }
    infoToast("房间已删除");
    await infoRefreshAfterWrite(writeResult, "rooms", function () {
      run("DELETE FROM rooms WHERE id = ?", [id]);
    });
  } catch (e) {
    console.error(e);
    infoToast("删除失败：" + e.message);
  }
}

/* ── 床位管理 | Bed Management ── */

function renderBedList() {
  const f = infoGetFilters("beds");
  const beds = query(`
    SELECT b.*, r.name AS room_name, r.dorm_type,
           (SELECT COUNT(*) FROM lodgers WHERE bed_id = b.id AND status = '在住') AS occupant_count
    FROM beds b
    JOIN rooms r ON r.id = b.room_id
    ORDER BY r.name, b.bed_number
  `);
  const rooms = query("SELECT id, name FROM rooms ORDER BY name");
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
    const row = query(
      "SELECT b.*, (SELECT COUNT(*) FROM lodgers WHERE bed_id = b.id AND status = '在住') AS occupant_count FROM beds b WHERE b.id = ?",
      [id],
    )[0];
    if (!row) return infoToast("床位不存在");
    b = row;
    occupied = row.occupant_count > 0;
  }
  const rooms = query("SELECT id, name FROM rooms ORDER BY name");
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
  const dup = query(
    "SELECT id FROM beds WHERE room_id = ? AND bed_number = ? AND id IS NOT ?",
    [roomId, number, id || 0],
  )[0];
  if (dup) {
    infoShowFieldError("info-bed-number", "该房间下已存在相同床位号");
    return;
  }
  const occupantCount = id
    ? query(
        "SELECT COUNT(*) as c FROM lodgers WHERE bed_id = ? AND status = '在住'",
        [id],
      )[0]?.c || 0
    : 0;
  if (occupantCount > 0 && (status === "维修" || status === "备用")) {
    infoShowFieldError(
      "info-bed-status",
      "该床位当前有住客，不能设为维修或备用",
    );
    return;
  }

  try {
    var writeResult = null;
    if (useRemoteWriteApi()) {
      writeResult = await apiAdminRecord("bed", id ? "update" : "create", {
        bed_id: id,
        room_id: roomId,
        bed_number: number,
        status: status,
        notes: notes,
        ...bedTags,
      });
    } else {
      await withTransaction(async () => {
        if (id) {
          const old = query("SELECT status FROM beds WHERE id = ?", [id])[0];
          run(
            "UPDATE beds SET room_id=?, bed_number=?, status=?, notes=?, bed_type=?, suitable_elder=?, is_flexible=? WHERE id=?",
            [
              roomId,
              number,
              status,
              notes,
              bedTags.bed_type,
              bedTags.suitable_elder,
              bedTags.is_flexible,
              id,
            ],
          );
          if (old && old.status !== status) {
            setHouseStatus(id, status, `信息管理修改床位状态：${status}`);
          }
          logAudit("更新床位", "bed", id, {
            room_id: roomId,
            bed_number: number,
            status,
          });
        } else {
          const result = run(
            "INSERT INTO beds (room_id, bed_number, status, notes, bed_type, suitable_elder, is_flexible) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
              roomId,
              number,
              status,
              notes,
              bedTags.bed_type,
              bedTags.suitable_elder,
              bedTags.is_flexible,
            ],
          );
          const newId = result.lastInsertId;
          setHouseStatus(newId, status, "新增床位");
          logAudit("新增床位", "bed", newId, {
            room_id: roomId,
            bed_number: number,
            status,
          });
        }
      });
      await saveDB();
    }
    closeModal();
    infoToast(id ? "床位已更新" : "床位已新增");
    await infoRefreshAfterWrite(writeResult, "beds", function () {
      var bid = (writeResult && writeResult.bed_id) || id;
      if (!bid) return;
      run(
        "INSERT OR REPLACE INTO beds (id, room_id, bed_number, status, notes, bed_type, suitable_elder, is_flexible, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
        [
          bid,
          roomId,
          number,
          status,
          notes,
          bedTags.bed_type,
          bedTags.suitable_elder,
          bedTags.is_flexible,
        ],
      );
    });
  } catch (e) {
    console.error(e);
    infoToast("保存失败：" + e.message);
  }
}

async function deleteBed(id) {
  const b = query(
    `
    SELECT b.*, r.name AS room_name,
           (SELECT COUNT(*) FROM lodgers WHERE bed_id = b.id AND status = '在住') AS occupant_count
    FROM beds b JOIN rooms r ON r.id = b.room_id
    WHERE b.id = ?
  `,
    [id],
  )[0];
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
    var writeResult = null;
    if (useRemoteWriteApi()) {
      writeResult = await apiAdminRecord("bed", "delete", { bed_id: id });
    } else {
      await withTransaction(async () => {
        run("DELETE FROM housekeeping WHERE bed_id = ?", [id]);
        run("DELETE FROM beds WHERE id = ?", [id]);
        logAudit("删除床位", "bed", id, {
          room_id: b.room_id,
          bed_number: b.bed_number,
        });
      });
      await saveDB();
    }
    infoToast("床位已删除");
    await infoRefreshAfterWrite(writeResult, "beds", function () {
      run("DELETE FROM housekeeping WHERE bed_id = ?", [id]);
      run("DELETE FROM beds WHERE id = ?", [id]);
    });
  } catch (e) {
    console.error(e);
    infoToast("删除失败：" + e.message);
  }
}

/* ── 住客主档案 | Guest Master Profile ── */

function renderGuestList() {
  const f = infoGetFilters("guests");
  const guests = query(`
    SELECT g.*,
           (SELECT COUNT(*) FROM lodgers WHERE guest_id = g.id) AS lodger_count
    FROM guests g
    ORDER BY g.updated_at DESC, g.id DESC
  `);
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
    const row = query("SELECT * FROM guests WHERE id = ?", [id])[0];
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
  const dupPhone = contact.phone
    ? query(
        'SELECT id FROM guests WHERE phone = ? AND phone <> "" AND id IS NOT ?',
        [contact.phone, id || 0],
      )[0]
    : null;
  if (dupPhone) {
    infoShowFieldError("info-guest-phone", "该手机号已存在");
    return;
  }
  const dupIdCard = contact.idCard
    ? query(
        'SELECT id FROM guests WHERE id_card = ? AND id_card <> "" AND id IS NOT ?',
        [contact.idCard, id || 0],
      )[0]
    : null;
  if (dupIdCard) {
    infoShowFieldError("info-guest-idcard", "该身份证已存在");
    return;
  }

  const now = new Date().toISOString();
  try {
    var writeResult = null;
    if (useRemoteWriteApi()) {
      writeResult = await apiAdminRecord("guest", id ? "update" : "create", {
        guest_id: id,
        name: name,
        gender: gender,
        phone: contact.phone,
        id_card: contact.idCard,
        emergency_contact: contact.emergencyName,
        emergency_phone: contact.emergencyPhone,
        notes: notes,
      });
    } else {
      await withTransaction(async () => {
        if (id) {
          run(
            `UPDATE guests SET name=?, dharma_name=?, gender=?, phone=?, id_card=?,
             emergency_contact=?, emergency_phone=?, notes=?, updated_at=?
             WHERE id=?`,
            [
              name,
              person.dharma_name,
              gender,
              contact.phone,
              contact.idCard,
              contact.emergencyName,
              contact.emergencyPhone,
              notes,
              now,
              id,
            ],
          );
          // 同步更新关联挂单快照字段，避免同一人在不同页面信息分裂
          run(
            `UPDATE lodgers SET name=?, dharma_name=?, gender=?, phone=?, id_card=?
             WHERE guest_id=?`,
            [
              name,
              person.dharma_name,
              gender,
              contact.phone,
              contact.idCard,
              id,
            ],
          );
          logAudit("更新住客档案", "guest", id, { name, phone: contact.phone });
        } else {
          const result = run(
            `INSERT INTO guests (name, dharma_name, gender, phone, id_card,
             emergency_contact, emergency_phone, notes, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              name,
              person.dharma_name,
              gender,
              contact.phone,
              contact.idCard,
              contact.emergencyName,
              contact.emergencyPhone,
              notes,
              now,
              now,
            ],
          );
          const newId = result.lastInsertId;
          logAudit("新增住客档案", "guest", newId, {
            name,
            phone: contact.phone,
          });
        }
      });
      await saveDB();
    }
    closeModal();
    infoToast(id ? "住客档案已更新" : "住客档案已新增");
    await infoRefreshAfterWrite(writeResult, "guests", function () {
      var gid = (writeResult && writeResult.guest_id) || id;
      if (!gid) return;
      var ts = new Date().toISOString().slice(0, 19).replace("T", " ");
      run(
        "INSERT OR REPLACE INTO guests (id, name, dharma_name, gender, phone, id_card, emergency_contact, emergency_phone, notes, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          gid,
          name,
          person.dharma_name,
          gender,
          contact.phone,
          contact.idCard,
          contact.emergencyName,
          contact.emergencyPhone,
          notes,
          ts,
        ],
      );
    });
  } catch (e) {
    console.error(e);
    infoToast("保存失败：" + e.message);
  }
}

async function deleteGuest(id) {
  const g = query("SELECT name, dharma_name FROM guests WHERE id = ?", [id])[0];
  if (!g) return infoToast("住客档案不存在");
  const refCount =
    query("SELECT COUNT(*) as c FROM lodgers WHERE guest_id = ?", [id])[0]?.c ||
    0;
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
    var writeResult = null;
    if (useRemoteWriteApi()) {
      writeResult = await apiAdminRecord("guest", "delete", { guest_id: id });
    } else {
      await withTransaction(async () => {
        run("DELETE FROM guests WHERE id = ?", [id]);
        logAudit("删除住客档案", "guest", id, { name: g.name });
      });
      await saveDB();
    }
    infoToast("住客档案已删除");
    await infoRefreshAfterWrite(writeResult, "guests", function () {
      run("DELETE FROM guests WHERE id = ?", [id]);
    });
  } catch (e) {
    console.error(e);
    infoToast("删除失败：" + e.message);
  }
}

/* ── 挂单记录 | Lodger Records ── */

function renderLodgerList() {
  const f = infoGetFilters("lodgers");
  const lodgers = query(`
    SELECT l.*, r.name AS room_name, b.bed_number
    FROM lodgers l
    LEFT JOIN beds b ON b.id = l.bed_id
    LEFT JOIN rooms r ON r.id = b.room_id
    ORDER BY l.check_in_date DESC, l.id DESC
  `);
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
  const l = query("SELECT * FROM lodgers WHERE id = ?", [id])[0];
  if (!l) return infoToast("挂单记录不存在");

  const rooms = query("SELECT id, name FROM rooms ORDER BY name");
  const currentRoomId = l.bed_id
    ? query("SELECT room_id FROM beds WHERE id = ?", [l.bed_id])[0]?.room_id ||
      ""
    : "";

  const roomOptions = [["", "请选择房间"], ...rooms.map((r) => [r.id, r.name])];
  const sourceOptions = INFO_SOURCE_OPTIONS;
  const statusOptions = INFO_LODGER_STATUS_OPTIONS;

  const beds = currentRoomId
    ? query(
        "SELECT id, bed_number, status FROM beds WHERE room_id = ? ORDER BY bed_number",
        [currentRoomId],
      )
    : [];
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
  const beds = query(
    "SELECT id, bed_number FROM beds WHERE room_id = ? ORDER BY bed_number",
    [roomId],
  );
  let html = '<option value="">请选择床位</option>';
  beds.forEach((b) => {
    html += `<option value="${b.id}" ${b.id == selectedBedId ? "selected" : ""}>${infoEscape(b.bed_number)}</option>`;
  });
  bedSelect.innerHTML = html;
}

async function submitLodger(id) {
  infoClearErrors("info-lodger-");
  const l = query("SELECT * FROM lodgers WHERE id = ?", [id])[0];
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
    const other = query(
      "SELECT id FROM lodgers WHERE bed_id = ? AND status = '在住' AND id <> ?",
      [bedId, id],
    )[0];
    if (other) {
      infoShowFieldError("info-lodger-bed", "该床位已被其他在住住客占用");
      return;
    }
    const bed = query(
      "SELECT b.*, r.dorm_type FROM beds b JOIN rooms r ON r.id = b.room_id WHERE b.id = ?",
      [bedId],
    )[0];
    if (bed && !dormMatchGender(bed.dorm_type, gender)) {
      infoShowFieldError("info-lodger-bed", "该床位所在房间寮类型与性别不符");
      return;
    }
  }

  let actualOut = l.actual_check_out;
  let finalBedId = bedId;
  if (status === "已退" && l.status === "在住") {
    // 直接改为已退时，若有余额必须走标准退房流程以确保退款记录完整
    const paid = query(
      "SELECT COALESCE(SUM(CASE WHEN type IN ('押金','房费') THEN amount ELSE 0 END), 0) as income, COALESCE(SUM(CASE WHEN type = '退款' THEN amount ELSE 0 END), 0) as refund_total FROM payments WHERE lodger_id = ?",
      [id],
    )[0];
    const balance = (paid.income || 0) - (paid.refund_total || 0);
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
    var writeResult = null;
    if (useRemoteWriteApi()) {
      writeResult = await apiAdminRecord("lodger", "update", {
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
      });
    } else {
      await withTransaction(async () => {
        run(
          `UPDATE lodgers SET name=?, dharma_name=?, gender=?, phone=?, id_card=?,
           check_in_date=?, expected_check_out=?, actual_check_out=?, status=?,
           source=?, bed_id=?, notes=? WHERE id=?`,
          [
            name,
            person.dharma_name,
            gender,
            contact.phone,
            contact.idCard,
            checkIn,
            expectedOut,
            actualOut,
            status,
            source,
            finalBedId,
            notes,
            id,
          ],
        );

        // 床位状态同步
        const oldBedId = l.bed_id;
        if (oldBedId && oldBedId !== finalBedId) {
          const stillOccupied =
            query(
              "SELECT COUNT(*) as c FROM lodgers WHERE bed_id = ? AND status = '在住' AND id <> ?",
              [oldBedId, id],
            )[0]?.c || 0;
          if (stillOccupied === 0) {
            run("UPDATE beds SET status='可用' WHERE id=?", [oldBedId]);
            setHouseStatus(
              oldBedId,
              status === "已退" ? "脏房" : "可用",
              status === "已退" ? "挂单退床" : "挂单换床释放旧床位",
            );
          }
        }
        if (finalBedId && status === "在住") {
          run("UPDATE beds SET status='占用' WHERE id=?", [finalBedId]);
        }

        // 同步用斋记录与住宿日期
        if (status === "在住") {
          run(
            "DELETE FROM meals WHERE lodger_id = ? AND (date < ? OR date > ?)",
            [id, checkIn, expectedOut],
          );
          const defaults = getLodgerMealDefaults(id);
          await generateMeals(
            id,
            checkIn,
            expectedOut,
            defaults.breakfast,
            defaults.lunch,
            defaults.dinner,
          );
        } else {
          const cutoff = actualOut || checkIn;
          run("DELETE FROM meals WHERE lodger_id = ? AND date > ?", [
            id,
            cutoff,
          ]);
        }

        logAudit("更新挂单记录", "lodger", id, { name, bed_id: bedId, status });
      });
      await saveDB();
    }
    closeModal();
    infoToast("挂单记录已更新");
    await infoRefreshAfterWrite(writeResult, "lodgers", function () {
      run(
        "UPDATE lodgers SET name=?, dharma_name=?, gender=?, phone=?, id_card=?, check_in_date=?, expected_check_out=?, actual_check_out=?, status=?, source=?, bed_id=?, notes=?, updated_at=datetime('now') WHERE id=?",
        [
          name,
          person.dharma_name,
          gender,
          contact.phone,
          contact.idCard,
          checkIn,
          expectedOut,
          actualOut,
          status,
          source,
          finalBedId,
          notes,
          id,
        ],
      );
    });
  } catch (e) {
    console.error(e);
    infoToast("保存失败：" + e.message);
  }
}

async function deleteInfoLodger(id) {
  const l = query("SELECT * FROM lodgers WHERE id = ?", [id])[0];
  if (!l) return infoToast("挂单记录不存在");
  const info = personDisplayName(l) + (l.phone ? " · " + l.phone : "");
  if (!infoConfirm(`确定删除挂单记录？\n${info}\n删除后不可恢复。`)) return;
  try {
    var writeResult = null;
    if (useRemoteWriteApi()) {
      writeResult = await apiDeleteLodger({ lodger_id: id });
    } else {
      await withTransaction(async () => {
        run("DELETE FROM meals WHERE lodger_id = ?", [id]);
        run("DELETE FROM payments WHERE lodger_id = ?", [id]);
        run("DELETE FROM lodgers WHERE id = ?", [id]);
        if (l.bed_id) {
          run("UPDATE beds SET status='可用' WHERE id=?", [l.bed_id]);
          setHouseStatus(l.bed_id, "脏房", "信息管理删除挂单释放床位");
        }
        logAudit("删除挂单", "lodger", id, {
          guest_id: l.guest_id,
          name: l.name,
          bed_id: l.bed_id,
        });
        logAudit("删除支付记录", "lodger", id, {
          guest_id: l.guest_id,
          name: l.name,
        });
      });
      await saveDB();
    }
    infoToast("已删除");
    await infoRefreshAfterWrite(writeResult, "lodgers", function () {
      run("DELETE FROM meals WHERE lodger_id = ?", [id]);
      run("DELETE FROM payments WHERE lodger_id = ?", [id]);
      run("DELETE FROM lodgers WHERE id = ?", [id]);
    });
  } catch (e) {
    console.error(e);
    infoToast("删除失败：" + e.message);
  }
}
