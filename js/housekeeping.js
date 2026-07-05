var HOUSEKEEPING_PENDING_BEDS = {};

function getHouseStatus(bedId) {
  if (
    typeof boardReadCacheReady === "function" &&
    boardReadCacheReady() &&
    typeof rcLatestHkStatus === "function"
  ) {
    return rcLatestHkStatus(bedId);
  }
  if (readUseOnlineDataPath()) return "净房";
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

function applyHousekeepingOptimistic(bedId, status) {
  if (
    isLocalForceDb() ||
    typeof boardReadCacheReady !== "function" ||
    !boardReadCacheReady() ||
    typeof rcApplyDeltaPatches !== "function"
  ) {
    return null;
  }
  var rowId = -Date.now();
  var row = {
    id: rowId,
    bed_id: bedId,
    status: status,
    operator: "optimistic",
    notes: "前端临时房务状态",
    changed_at: new Date().toISOString(),
    _optimistic: true,
  };
  rcApplyDeltaPatches({ housekeeping: [row] }, []);
  return { rowId: rowId };
}

function rollbackHousekeepingOptimistic(optimistic) {
  if (!optimistic || typeof rcApplyDeltaPatches !== "function") return true;
  try {
    rcApplyDeltaPatches(null, [
      { table_name: "housekeeping", row_id: optimistic.rowId },
    ]);
    return true;
  } catch (e) {
    console.warn("housekeeping optimistic rollback failed:", e.message || e);
    return false;
  }
}

async function forceRefreshHousekeeping() {
  if (typeof rcEnsureViewModules === "function") {
    try {
      await rcEnsureViewModules("housekeeping", true);
      return true;
    } catch (e) {
      console.warn("housekeeping force refresh failed:", e.message || e);
      return false;
    }
  }
  return true;
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
  if (readUseOnlineDataPath()) return false;
  var bedRow = query("SELECT * FROM beds WHERE id = ?", [bedId])[0];
  if (!bedRow || bedRow.status === "维修" || bedRow.status === "备用")
    return false;
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
  if (!useRc && readUseOnlineDataPath()) {
    grid.innerHTML = '<p class="empty-tip">加载中…</p>';
    return;
  }
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
      const pendingStatus = HOUSEKEEPING_PENDING_BEDS[b.id];
      const hk = pendingStatus
        ? pendingStatus
        : useRc
          ? b.hk_status || getHouseStatus(b.id)
          : getHouseStatus(b.id);
      const occupied = !!b.lodger_id;
      const pending = !!pendingStatus;
      const card = document.createElement("article");
      card.className =
        "hk-bed-card hk-bed-" +
        (hk === "脏房" ? "dirty" : occupied ? "occupied" : "ready");
      var actionsHtml = pending
        ? '<button type="button" class="btn btn-sm" disabled>保存中…</button>'
        : (hk === "脏房"
            ? `<button type="button" class="btn btn-success btn-sm" onclick="setHkAndRender(event.currentTarget, ${b.id}, '净房')">已净房</button>`
            : "") +
          (hk === "净房" && housekeepingRequiresInspect()
            ? `<button type="button" class="btn btn-primary btn-sm" onclick="setHkAndRender(event.currentTarget, ${b.id}, '查房')">查房</button>`
            : "") +
          (hk === "净房" && !housekeepingRequiresInspect()
            ? `<button type="button" class="btn btn-success btn-sm" onclick="setHkAndRender(event.currentTarget, ${b.id}, '可用')">可入住</button>`
            : "") +
          (hk === "查房"
            ? `<button type="button" class="btn btn-success btn-sm" onclick="setHkAndRender(event.currentTarget, ${b.id}, '可用')">可入住</button>`
            : "") +
          (!b.lodger_id && hk !== "维修"
            ? `<button type="button" class="btn btn-warning btn-sm" onclick="setHkAndRender(event.currentTarget, ${b.id}, '维修')">报修</button>`
            : "") +
          (hk === "维修"
            ? `<button type="button" class="btn btn-default btn-sm" onclick="setHkAndRender(event.currentTarget, ${b.id}, '净房')">维修完成</button>`
            : "");
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
        actionsHtml +
        "</div>";
      bedWrap.appendChild(card);
    });

    grid.appendChild(group);
  });

  if (!grid.children.length) {
    grid.innerHTML = '<p class="empty-tip">暂无客房数据</p>';
  }
}

async function setHkAndRender(source, bedId, status) {
  if (HOUSEKEEPING_PENDING_BEDS[bedId]) return;
  if (status === "维修") {
    var occupied;
    if (
      typeof boardReadCacheReady === "function" &&
      boardReadCacheReady() &&
      typeof rcLodgerOnBed === "function"
    ) {
      occupied = !!rcLodgerOnBed(bedId);
    } else if (readUseOnlineDataPath()) {
      occupied = false;
    } else {
      occupied =
        (query(
          "SELECT COUNT(*) as c FROM lodgers WHERE bed_id=? AND status='在住'",
          [bedId],
        )[0]?.c || 0) > 0;
    }
    if (occupied) {
      await uiAlert("该床位当前有在住住客，不能设为维修");
      return;
    }
  }
  const current = getHouseStatus(bedId);
  const requireInspect = housekeepingRequiresInspect();
  if (!isHousekeepingTransitionAllowed(current, status, requireInspect)) {
    await uiAlert(
      requireInspect
        ? `当前为「${current}」，需按脏房→净房→查房→可入住流转`
        : `当前为「${current}」，不能直接设为「${status}」`,
    );
    return;
  }
  var finishPending = safeBeginActionPending(source, "保存中…");
  if (!finishPending) return;
  HOUSEKEEPING_PENDING_BEDS[bedId] = status;
  var optimistic = applyHousekeepingOptimistic(bedId, status);
  var optimisticRolledBack = false;
  renderHousekeeping();
  var writeResult = null;
  try {
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
      writeResult = { ok: true, local: true };
    } else {
      writeResult = await apiSetHouseStatus({
        bed_id: bedId,
        status: status,
        notes: `手动设置${status}`,
      });
    }
    optimisticRolledBack = rollbackHousekeepingOptimistic(optimistic);
    rcRefreshAfterWrite(writeResult, { skipViewRefresh: true });
  } catch (e) {
    console.error(e);
    if (!optimisticRolledBack) rollbackHousekeepingOptimistic(optimistic);
    var refreshOk = await forceRefreshHousekeeping();
    if (writeResult) {
      if (refreshOk) showToast("房务状态已保存");
      else
        await uiAlert("房务状态已保存，但刷新失败，请手动刷新页面查看最新数据");
    } else {
      await uiAlert("房务状态变更失败：" + e.message);
    }
  } finally {
    delete HOUSEKEEPING_PENDING_BEDS[bedId];
    finishPending();
    renderHousekeeping();
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
        '<button type="button" class="btn btn-primary" onclick="saveOperationalSettings(event.currentTarget)">保存运营配置</button>' +
        "</div>";
    })
    .catch(function (e) {
      panel.innerHTML =
        '<p class="empty-tip">加载失败：' + escapeHtml(e.message) + "</p>";
    });
}

function loadOperationalSettings() {
  if (useOnlineDataPath()) {
    return apiAdminGetOperationalSettings();
  }
  return Promise.resolve({
    housekeeping_require_inspect: housekeepingRequiresInspect(),
  });
}

async function saveOperationalSettings(source) {
  if (typeof requireAdmin === "function" && !requireAdmin()) return;
  return safeWithActionPending(source, "保存中…", async function () {
    const requireInspect =
      !!document.getElementById("hk-require-inspect")?.checked;
    try {
      var writeResult = null;
      if (isLocalForceDb()) {
        setAppMetaValue(
          APP_META_HK_REQUIRE_INSPECT,
          requireInspect ? "1" : "0",
        );
        await saveDB();
      } else {
        writeResult = await apiAdminSaveOperationalSettings({
          housekeeping_require_inspect: requireInspect,
        });
        setAppMetaValue(
          APP_META_HK_REQUIRE_INSPECT,
          requireInspect ? "1" : "0",
        );
      }
      showToast("运营配置已保存");
      renderOperationalSettingsPanel();
      if (typeof rcRefreshAfterWrite === "function") {
        rcRefreshAfterWrite(writeResult);
      } else if (typeof refreshAfterWrite === "function") {
        refreshAfterWrite(writeResult);
      }
      if (
        document
          .getElementById("view-housekeeping")
          ?.classList.contains("active")
      )
        renderHousekeeping();
    } catch (e) {
      await uiAlert("保存失败：" + e.message);
    }
  });
}
