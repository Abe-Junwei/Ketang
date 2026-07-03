function getHouseStatus(bedId) {
  if (
    typeof boardReadCacheReady === "function" &&
    boardReadCacheReady() &&
    typeof rcLatestHkStatus === "function"
  ) {
    return rcLatestHkStatus(bedId);
  }
  const row = query(
    "SELECT * FROM housekeeping WHERE bed_id = ? ORDER BY changed_at DESC LIMIT 1",
    [bedId],
  )[0];
  return row ? row.status : "净房";
}

function setHouseStatus(bedId, status, notes, operator) {
  run(
    "INSERT INTO housekeeping (bed_id, status, operator, notes) VALUES (?, ?, ?, ?)",
    [bedId, status, operator || null, notes || null],
  );
}

function isBedAssignable(bedId) {
  if (typeof boardReadCacheReady === "function" && boardReadCacheReady()) {
    var bed = rcBoardBeds().find(function (b) {
      return b.id == bedId;
    });
    if (!bed || bed.status === "维修" || bed.status === "备用") return false;
    if (rcLodgerOnBed(bedId)) return false;
    var hk = rcLatestHkStatus(bedId);
    if (
      typeof housekeepingRequiresInspect === "function" &&
      housekeepingRequiresInspect()
    )
      return hk === "可用";
    return hk === "净房" || hk === "可用";
  }
  var bedRow = query("SELECT * FROM beds WHERE id = ?", [bedId])[0];
  if (!bedRow || bedRow.status === "维修" || bedRow.status === "备用") return false;
  const occ =
    query(
      "SELECT COUNT(*) as c FROM lodgers WHERE bed_id = ? AND status = '在住'",
      [bedId],
    )[0]?.c || 0;
  if (occ > 0) return false;
  var hkLocal = getHouseStatus(bedId);
  if (
    typeof housekeepingRequiresInspect === "function" &&
    housekeepingRequiresInspect()
  )
    return hkLocal === "可用";
  return hkLocal === "净房" || hkLocal === "可用";
}

async function housekeepingLoadAndRender() {
  const grid = document.getElementById("hk-grid");
  if (grid) grid.innerHTML = '<p class="empty-tip">加载中…</p>';
  try {
    if (typeof rcEnsureViewModules === "function") {
      await rcEnsureViewModules("housekeeping", false);
    }
  } catch (e) {
    if (grid) {
      grid.innerHTML =
        '<p class="empty-tip">加载失败：' +
        escapeHtml(e.message || "未知错误") +
        "</p>";
    }
    return;
  }
  renderHousekeeping();
}

function renderHousekeeping() {
  const grid = document.getElementById("hk-grid");
  if (!grid) return;
  grid.innerHTML = "";
  var useRc =
    typeof boardReadCacheReady === "function" && boardReadCacheReady();
  const rooms = useRc
    ? rcBoardRooms()
    : query("SELECT * FROM rooms ORDER BY id");
  rooms.forEach((r) => {
    if (typeof isSpareRoom === "function" && isSpareRoom(r)) return;
    const beds = useRc
      ? rcBedsForRoomEnriched(r.id)
      : query(
          `
      SELECT b.*, l.id as lodger_id, l.name, l.dharma_name
      FROM beds b
      LEFT JOIN lodgers l ON l.bed_id = b.id AND l.status='在住'
      WHERE b.room_id = ? AND b.status != '备用'
      ORDER BY b.id
    `,
          [r.id],
        );
    if (!beds.length) return;

    const group = document.createElement("section");
    group.className = "hk-room-group";
    group.innerHTML =
      '<header class="hk-room-head">' +
      escapeHtml(r.name) +
      '<span class="hk-room-count">' +
      beds.length +
      " 床</span></header>" +
      '<div class="hk-room-beds"></div>';
    const bedWrap = group.querySelector(".hk-room-beds");

    beds.forEach((b) => {
      const hk = useRc ? b.hk_status || getHouseStatus(b.id) : getHouseStatus(b.id);
      const occupied = !!b.lodger_id;
      const card = document.createElement("article");
      card.className =
        "hk-bed-card hk-bed-" +
        (hk === "脏房" ? "dirty" : occupied ? "occupied" : "ready");
      card.innerHTML =
        '<div class="hk-bed-card-head">' +
        '<strong class="hk-bed-label">' +
        escapeHtml(formatBedLabel(b.bed_number, 0)) +
        "</strong>" +
        '<span class="hk-bed-status">' +
        escapeHtml(hk) +
        "</span>" +
        "</div>" +
        '<div class="hk-bed-card-meta">' +
        (b.lodger_id ? escapeHtml(personDisplayName(b)) + " 在住" : "无人") +
        "</div>" +
        '<div class="hk-bed-card-actions">' +
        (hk === "脏房"
          ? `<button type="button" class="btn btn-success btn-sm" onclick="setHkAndRender(${b.id}, '净房')">已净房</button>`
          : "") +
        (hk === "净房" && housekeepingRequiresInspect()
          ? `<button type="button" class="btn btn-primary btn-sm" onclick="setHkAndRender(${b.id}, '查房')">查房</button>`
          : "") +
        (hk === "净房" && !housekeepingRequiresInspect()
          ? `<button type="button" class="btn btn-success btn-sm" onclick="setHkAndRender(${b.id}, '可用')">可入住</button>`
          : "") +
        (hk === "查房"
          ? `<button type="button" class="btn btn-success btn-sm" onclick="setHkAndRender(${b.id}, '可用')">可入住</button>`
          : "") +
        (!b.lodger_id && hk !== "维修"
          ? `<button type="button" class="btn btn-warning btn-sm" onclick="setHkAndRender(${b.id}, '维修')">报修</button>`
          : "") +
        (hk === "维修"
          ? `<button type="button" class="btn btn-default btn-sm" onclick="setHkAndRender(${b.id}, '净房')">维修完成</button>`
          : "") +
        "</div>";
      bedWrap.appendChild(card);
    });

    grid.appendChild(group);
  });

  if (!grid.children.length) {
    grid.innerHTML = '<p class="empty-tip">暂无客房数据</p>';
  }
}

async function setHkAndRender(bedId, status) {
  if (status === "维修") {
    const occupied =
      typeof boardReadCacheReady === "function" && boardReadCacheReady()
        ? !!rcLodgerOnBed(bedId)
        : (query(
          "SELECT COUNT(*) as c FROM lodgers WHERE bed_id=? AND status='在住'",
          [bedId],
        )[0]?.c || 0) > 0;
    if (occupied) {
      alert("该床位当前有在住住客，不能设为维修");
      return;
    }
  }
  const current = getHouseStatus(bedId);
  const requireInspect = housekeepingRequiresInspect();
  if (!isHousekeepingTransitionAllowed(current, status, requireInspect)) {
    alert(
      requireInspect
        ? `当前为「${current}」，需按脏房→净房→查房→可入住流转`
        : `当前为「${current}」，不能直接设为「${status}」`,
    );
    return;
  }
  try {
    var writeResult = null;
    if (isLocalForceDb()) {
      await withTransaction(async () => {
        setHouseStatus(bedId, status, `手动设置${status}`);
        if (status === "维修")
          run("UPDATE beds SET status='维修' WHERE id=?", [bedId]);
        else if (status === "净房" || status === "可用") {
          const occ =
            query(
              "SELECT COUNT(*) as c FROM lodgers WHERE bed_id=? AND status='在住'",
              [bedId],
            )[0]?.c || 0;
          if (occ === 0)
            run("UPDATE beds SET status='可用' WHERE id=?", [bedId]);
        }
        logAudit("房务状态变更", "bed", bedId, { status: status });
      });
      await saveDB();
    } else {
      writeResult = await apiSetHouseStatus({
        bed_id: bedId,
        status: status,
        notes: `手动设置${status}`,
      });
    }
    renderHousekeeping();
    refreshAfterWrite(writeResult);
  } catch (e) {
    console.error(e);
    alert("房务状态变更失败：" + e.message);
  }
}

function renderOperationalSettingsPanel() {
  const panel = document.getElementById("operational-settings-panel");
  if (!panel) return;
  if (typeof requireAdmin === "function" && !requireAdmin()) {
    panel.innerHTML = '<p class="empty-tip">需要 users.write 权限。</p>';
    return;
  }
  panel.innerHTML = '<p class="empty-tip">加载中…</p>';
  loadOperationalSettings()
    .then(function (data) {
      const checked = data.housekeeping_require_inspect ? "checked" : "";
      panel.innerHTML =
        '<label class="role-perm-item">' +
        '<input type="checkbox" id="hk-require-inspect" ' +
        checked +
        "> " +
        "分配床位前必须经过「查房→可入住」（关闭时「净房」即可分配）" +
        "</label>" +
        '<div class="btn-bar" style="margin-top: var(--space-3);">' +
        '<button type="button" class="btn btn-primary" onclick="saveOperationalSettings()">保存运营配置</button>' +
        "</div>";
    })
    .catch(function (e) {
      panel.innerHTML =
        '<p class="empty-tip">加载失败：' + escapeHtml(e.message) + "</p>";
    });
}

function loadOperationalSettings() {
  if (!isLocalForceDb()) {
    return apiAdminGetOperationalSettings();
  }
  return Promise.resolve({
    housekeeping_require_inspect: housekeepingRequiresInspect(),
  });
}

async function saveOperationalSettings() {
  if (typeof requireAdmin === "function" && !requireAdmin()) return;
  const requireInspect =
    !!document.getElementById("hk-require-inspect")?.checked;
  try {
    var writeResult = null;
    if (isLocalForceDb()) {
      setAppMetaValue(APP_META_HK_REQUIRE_INSPECT, requireInspect ? "1" : "0");
      await saveDB();
    } else {
      writeResult = await apiAdminSaveOperationalSettings({
        housekeeping_require_inspect: requireInspect,
      });
      setAppMetaValue(APP_META_HK_REQUIRE_INSPECT, requireInspect ? "1" : "0");
    }
    showToast("运营配置已保存");
    renderOperationalSettingsPanel();
    if (typeof refreshAfterWrite === "function") {
      await refreshAfterWrite(writeResult);
    }
    if (
      document.getElementById("view-housekeeping")?.classList.contains("active")
    )
      renderHousekeeping();
  } catch (e) {
    alert("保存失败：" + e.message);
  }
}
