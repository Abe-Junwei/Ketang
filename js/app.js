document.addEventListener("DOMContentLoaded", async () => {
  initShellIcons();
  try {
    await initSqlite();
    if (typeof initRolePermissionDefaults === "function") {
      await initRolePermissionDefaults();
    }
    await loadDB();
    if (!isRemoteDB()) {
      initSchema();
      migrateV1toV2();
      migrateV2toV3();
      migrateV3toV4();
      migrateV4toV5();
      migrateV5toV6();
      migrateV6toV7();
      migrateV7toV8();
      migrateV8toV9();
      migrateV9toV10();
      migrateV10toV11();
      migrateV11toV12();
      migrateV12toV13();
      migrateV13toV14();
      migrateV14toV15();
      createIndexes();
      await seedRooms();
    }
    initAuth();
    if (typeof isRemoteDB === "function" && isRemoteDB()) {
      await restoreRemoteSession();
    }
    applyDeploymentModeUI();
    applyPermissions();
    if (isLoggedIn()) {
      hideLoginOverlay();
      mountFormMealNeedPickers();
      mountLodgerRoleSelects();
      await renderAll();
      document.getElementById("ci-in").valueAsDate = new Date();
      startBoardPolling();
    } else {
      showLoginOverlay();
    }
    if (typeof upgradeSelects === "function") {
      const appRoot = document.querySelector(".app-shell");
      const sidebar = document.querySelector(".sidebar");
      if (appRoot) upgradeSelects(appRoot);
      if (sidebar) upgradeSelects(sidebar);
    }
    window.ketangReady = true;
    console.log("客堂系统初始化完成");
  } catch (e) {
    console.error("初始化失败 | Init failed:", e);
    document
      .querySelectorAll(".sidebar-nav-btn, .sidebar-footer-btn")
      .forEach((b) => {
        b.disabled = true;
        b.style.opacity = "0.5";
      });
    const isAdminUser = isAdmin();
    const isRemote = typeof isRemoteDB === "function" && isRemoteDB();
    const importAccept = isRemote ? ".json" : ".db,.json";
    const recoveryButtons = isAdminUser
      ? `
      <button class="btn btn-warning" onclick="document.getElementById('import-file').click()">从文件恢复数据</button>
      <input type="file" id="import-file" style="display:none" accept="${importAccept}" onchange="importDB(this)">
      <button class="btn btn-danger" onclick="if(confirm('确定要重置所有数据吗？此操作不可恢复！')){resetDatabase()}">重置数据库</button>
    `
      : `<p class="empty-tip">需要管理员权限才能恢复或重置数据。请使用管理员账号登录后刷新页面。</p>`;
    document.querySelector("main").innerHTML = `
      <div class="card" style="text-align:center; padding: var(--space-10);">
        <h2 style="color:var(--color-danger);">⚠️ 系统初始化失败</h2>
        <p style="color:var(--color-muted);">${escapeHtml(e.message)}</p>
        <div class="card card-info" style="text-align:left;">
          <h3>恢复步骤：</h3>
          <ol>
            <li>如果你有备份文件 <code>ketang.db</code>，请点击下方按钮恢复。</li>
            <li>如果没有备份，可以<strong>重置数据库</strong>（所有数据将丢失）。</li>
          </ol>
          ${recoveryButtons}
        </div>
      </div>
    `;
  }
});

const TOPBAR_TITLES = {
  board: "客堂大盘",
  lodging: "住宿管理",
  lodgers: "在住挂单",
  stay: "住宿办理",
  checkin: "住宿办理",
  reservations: "住宿办理",
  forecast: "流动预测",
  housekeeping: "客房维护",
  reports: "账务报表",
  history: "历史查询",
  info: "基础设置",
  backup: "系统设置",
};

function initShellIcons() {
  const map = {
    ".sidebar-logo": "temple",
    ".sidebar-cta-icon": "add",
    ".nav-icon-dashboard": "dashboard",
    ".nav-icon-room": "room",
    ".nav-icon-people": "people",
    ".nav-icon-calendar": "calendar",
    ".nav-icon-checkin": "checkin",
    ".nav-icon-payments": "payments",
    ".nav-icon-cleaning": "cleaning",
    ".nav-icon-settings": "settings",
    ".nav-icon-account": "account",
    ".nav-icon-tune": "tune",
    ".sidebar-zen-icon": "quote",
    ".topbar-search-icon": "search",
    ".topbar-icon-bell": "notifications",
    ".topbar-icon-help": "help",
    ".ops-notice-icon-campaign": "campaign",
    ".ops-notice-icon-info": "info",
    ".section-icon-room": "room",
    ".section-icon-people": "people",
    ".lodgers-search-icon": "search",
  };
  Object.keys(map).forEach(function (sel) {
    document.querySelectorAll(sel).forEach(function (el) {
      el.innerHTML = icon(map[sel], "icon-sm");
    });
  });
}

function updateTopbarTitle(name) {
  let el = document.getElementById("topbar-title");
  if (el) el.textContent = TOPBAR_TITLES[name] || "客堂住宿系统";
  let search = document.getElementById("board-search");
  if (search)
    search.parentElement.style.display =
      name === "board" || name === "lodging" ? "" : "none";
}

function refreshBoardSearch() {
  handleBoardSearch(document.getElementById("board-search")?.value || "");
}

// 床位卡片点击：有住客打开操作菜单，空床位进入挂单登记
function handleBedCardClick(event, bedId, lodgerId) {
  event.stopPropagation();
  if (lodgerId) {
    openLodgerActions(lodgerId);
  } else {
    openCheckinForBed(bedId);
  }
}

let _pendingStayMode = "checkin";

/** 住宿办理 Tab：现场入住 / 提前预约 | Stay registration mode switch */
function setStayMode(mode) {
  mode = mode === "reservation" ? "reservation" : "checkin";
  _pendingStayMode = mode;
  const checkinPanel = document.getElementById("stay-panel-checkin");
  const resvPanel = document.getElementById("stay-panel-reservation");
  const tabCheckin = document.getElementById("stay-tab-checkin");
  const tabResv = document.getElementById("stay-tab-reservation");
  if (!checkinPanel || !resvPanel) return;
  const isCheckin = mode === "checkin";
  checkinPanel.hidden = !isCheckin;
  resvPanel.hidden = isCheckin;
  if (tabCheckin) {
    tabCheckin.classList.toggle("active", isCheckin);
    tabCheckin.setAttribute("aria-selected", isCheckin ? "true" : "false");
  }
  if (tabResv) {
    tabResv.classList.toggle("active", !isCheckin);
    tabResv.setAttribute("aria-selected", !isCheckin ? "true" : "false");
  }
  if (isCheckin) renderBedOptions();
  else renderReservations("全部");
}

function requireAuth() {
  if (!isLoggedIn()) {
    showLoginOverlay();
    return false;
  }
  return true;
}

function showView(name) {
  if (!requireAuth()) return;
  // 权限检查：info 和 backup 仅管理员可访问
  if (
    (name === "info" && !hasPermission("settings.read")) ||
    (name === "backup" && !hasPermission("backup.read"))
  ) {
    alert("需要管理员权限");
    return;
  }
  if (name === "checkin") {
    _pendingStayMode = "checkin";
    name = "stay";
  } else if (name === "reservations") {
    _pendingStayMode = "reservation";
    name = "stay";
  }
  document
    .querySelectorAll(".view")
    .forEach((v) => v.classList.remove("active"));
  document
    .querySelectorAll(".sidebar-nav-btn, .sidebar-footer-btn")
    .forEach((b) => b.classList.remove("active"));
  document.getElementById("view-" + name).classList.add("active");
  const navView = name === "stay" ? "stay" : name;
  const primary = document.querySelector(
    '.sidebar-nav-btn[data-view="' + navView + '"]',
  );
  const footer = document.querySelector(
    '.sidebar-footer-btn[data-view="' + navView + '"]',
  );
  if (primary) primary.classList.add("active");
  if (footer) footer.classList.add("active");
  updateTopbarTitle(name);
  if (name === "board") renderBoard();
  if (name === "lodging") renderLodging();
  if (name === "lodgers") renderLodgersPage();
  if (name === "stay") setStayMode(_pendingStayMode);
  if (name === "history") renderHistory();
  if (name === "forecast") {
    initForecastDates();
    renderForecastTab("today");
  }
  if (name === "housekeeping") renderHousekeeping();
  if (name === "reports") initReportDates();
  if (name === "info") renderInfo("rooms");
  if (name === "backup") renderUserList();
}

function renderBoard() {
  renderCheckoutReminders();
  renderOpsNotice();
  checkBackupReminder();
  renderStats();
  renderBoardCharts();
  renderTodayMealsPanel();
  renderBedOptions();
  refreshBoardSearch();
}

function renderLodgersPage() {
  renderLodgers();
  updateLodgersPageMeta();
  handleLodgerSearch(document.getElementById("lodger-search")?.value || "");
}

function getBoardBedStats() {
  var spareSql = spareRoomExcludeClause("r");
  var total =
    query(
      "SELECT COUNT(*) as c FROM beds b JOIN rooms r ON r.id = b.room_id WHERE b.status != '备用' AND " +
        spareSql,
    )[0]?.c || 0;
  var occupied =
    query(
      "SELECT COUNT(DISTINCT l.bed_id) as c FROM lodgers l JOIN beds b ON b.id = l.bed_id JOIN rooms r ON r.id = b.room_id WHERE l.status='在住' AND b.status != '备用' AND " +
        spareSql,
    )[0]?.c || 0;
  var empty = Math.max(0, total - occupied);
  var dirty =
    query(
      "SELECT COUNT(*) as c FROM beds b JOIN rooms r ON r.id = b.room_id WHERE b.status != '备用' AND " +
        spareSql +
        " AND (SELECT status FROM housekeeping WHERE bed_id = b.id ORDER BY changed_at DESC LIMIT 1) = '脏房'",
    )[0]?.c || 0;
  var cleanEmpty = Math.max(0, empty - dirty);
  var lodgerCount =
    query("SELECT COUNT(*) as c FROM lodgers WHERE status='在住'")[0]?.c || 0;
  var resvToday =
    query(
      "SELECT COUNT(*) as c FROM reservations WHERE expected_check_in = ? AND status IN ('预约','已确认')",
      [todayStr()],
    )[0]?.c || 0;
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

function renderBoardRingChart(key, canvasId, pctElId, stats) {
  var T = getChartTheme();
  var pctEl = pctElId ? document.getElementById(pctElId) : null;
  if (pctEl) pctEl.textContent = stats.occPct + "%";
  createKetangRingChart(key, canvasId, {
    type: "doughnut",
    data: {
      labels: ["已住", "空床", "脏房"],
      datasets: [
        {
          data: [stats.occupied, stats.cleanEmpty, stats.dirty],
          backgroundColor: [T.primary, T.success, T.warning],
        },
      ],
    },
  });
  var legendEl = document.getElementById("board-occ-legend");
  if (legendEl && key === "board-occ") {
    legendEl.innerHTML = chartLegendHtml([
      { label: "已住", value: stats.occupied, color: T.primary },
      { label: "空床", value: stats.cleanEmpty, color: T.success },
      { label: "脏房", value: stats.dirty, color: T.warning },
    ]);
  }
  var subEl = document.getElementById("board-chart-occ-sub");
  if (subEl && key === "board-occ") {
    subEl.textContent = stats.total + " 床 · 在住 " + stats.lodgerCount + " 人";
  }
}

function renderBoardCharts() {
  if (typeof Chart === "undefined") return;
  destroyKetangChartsByPrefix("board-");
  var stats = getBoardBedStats();
  var today = todayStr();
  var T = getChartTheme();

  renderBoardRingChart("board-occ", "chart-board-occ", "board-occ-pct", stats);

  var expArrive = query(
    "SELECT COUNT(*) as c FROM (SELECT id FROM reservations WHERE expected_check_in = ? AND status IN ('预约','已确认') UNION ALL SELECT id FROM lodgers WHERE check_in_date = ? AND status = '在住')",
    [today, today],
  )[0].c;
  var expDepart = query(
    "SELECT COUNT(*) as c FROM lodgers WHERE expected_check_out = ? AND status = '在住'",
    [today],
  )[0].c;
  var actArrive = query(
    "SELECT COUNT(*) as c FROM lodgers WHERE check_in_date = ? AND status = '在住'",
    [today],
  )[0].c;
  var actDepart = query(
    "SELECT COUNT(*) as c FROM lodgers WHERE actual_check_out = ?",
    [today],
  )[0].c;

  createKetangChart("board-flow", "chart-board-flow", {
    type: "bar",
    data: {
      labels: ["预到", "预离", "实到", "实离"],
      datasets: [
        {
          label: "人数",
          data: [expArrive, expDepart, actArrive, actDepart],
          backgroundColor: [T.arrive, T.depart, T.flowIn, T.flowOut],
          borderRadius: 6,
          borderSkipped: false,
          maxBarThickness: 48,
        },
      ],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1, precision: 0 },
          grid: { drawBorder: false },
        },
        x: { grid: { display: false } },
      },
    },
  });

  var spareSql = spareRoomExcludeClause("r");
  var maleBeds =
    query(
      "SELECT COUNT(*) as c FROM beds b JOIN rooms r ON r.id=b.room_id WHERE r.dorm_type='男寮' AND b.status!='维修' AND b.status!='备用' AND " +
        spareSql,
    )[0]?.c || 0;
  var femaleBeds =
    query(
      "SELECT COUNT(*) as c FROM beds b JOIN rooms r ON r.id=b.room_id WHERE r.dorm_type='女寮' AND b.status!='维修' AND b.status!='备用' AND " +
        spareSql,
    )[0]?.c || 0;
  var maleOcc =
    query(
      "SELECT COUNT(DISTINCT l.bed_id) as c FROM lodgers l JOIN beds b ON b.id=l.bed_id JOIN rooms r ON r.id=b.room_id WHERE l.status='在住' AND r.dorm_type='男寮' AND b.status!='备用' AND " +
        spareSql,
    )[0]?.c || 0;
  var femaleOcc =
    query(
      "SELECT COUNT(DISTINCT l.bed_id) as c FROM lodgers l JOIN beds b ON b.id=l.bed_id JOIN rooms r ON r.id=b.room_id WHERE l.status='在住' AND r.dorm_type='女寮' AND b.status!='备用' AND " +
        spareSql,
    )[0]?.c || 0;
  var maleFree = Math.max(0, maleBeds - maleOcc);
  var femaleFree = Math.max(0, femaleBeds - femaleOcc);
  var dormSub = document.getElementById("board-chart-dorm-sub");
  if (dormSub)
    dormSub.textContent = "男余 " + maleFree + " · 女余 " + femaleFree;

  createKetangChart("board-dorm", "chart-board-dorm", {
    type: "bar",
    data: {
      labels: ["男寮", "女寮"],
      datasets: [
        {
          label: "在住",
          data: [maleOcc, femaleOcc],
          backgroundColor: [T.male, T.female],
          borderRadius: 6,
          borderSkipped: false,
          maxBarThickness: 36,
        },
        {
          label: "余床",
          data: [maleFree, femaleFree],
          backgroundColor: [T.successSoft, T.primarySoft],
          borderRadius: 6,
          borderSkipped: false,
          maxBarThickness: 36,
        },
      ],
    },
    options: {
      plugins: { legend: { position: "bottom" } },
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: {
          stacked: true,
          beginAtZero: true,
          ticks: { stepSize: 1, precision: 0 },
          grid: { drawBorder: false },
        },
      },
    },
  });
}

function renderLodging() {
  renderRooms();
  refreshBoardSearch();
  renderLodgingOccupancyChart();
}

function renderLodgingOccupancyChart() {
  if (typeof Chart === "undefined") return;
  renderBoardRingChart(
    "lodging-occ",
    "chart-lodging-occ",
    "lodging-occ-pct",
    getBoardBedStats(),
  );
}

async function renderAll(options) {
  if (typeof isLoggedIn === "function" && !isLoggedIn()) return;
  if (
    isRemoteDB() &&
    getRemoteSessionToken() &&
    !(options && options.skipSync)
  ) {
    const forceSync = !!(options && options.forceSync);
    try {
      if (forceSync || !remoteReadModelReady) {
        await syncRemoteReadModel({ force: true });
      } else {
        try {
          const result = await apiBoardVersion();
          if (
            lastBoardVersion == null ||
            result.version !== lastBoardVersion
          ) {
            await syncRemoteReadModel({ force: true });
          }
          lastBoardVersion = result.version;
        } catch (e) {
          await syncRemoteReadModel({ force: true });
          const result = await apiBoardVersion();
          lastBoardVersion = result.version;
        }
      }
    } catch (e) {
      if (typeof showToast === "function") {
        showToast("数据同步失败：" + (e.message || "请刷新后重试"));
      }
      throw e;
    }
  }
  updateRemoteSyncBanner();
  renderRooms();
  renderBoard();
  renderLodgers();
  var lodgersView = document.getElementById("view-lodgers");
  if (lodgersView && lodgersView.classList.contains("active")) {
    updateLodgersPageMeta();
    handleLodgerSearch(document.getElementById("lodger-search")?.value || "");
  }
  // 若用户停留在其他视图，同步刷新避免数据陈旧
  if (document.getElementById("view-reports")?.classList.contains("active")) {
    renderMealReport();
    renderDailyReport();
    renderMonthlyReport();
    renderEventReport();
  }
  if (document.getElementById("view-forecast")?.classList.contains("active")) {
    var activeTab =
      document.querySelector(".forecast-tab-btn.active")?.dataset.tab ||
      "today";
    renderForecastTab(activeTab);
  }
  if (document.getElementById("view-history")?.classList.contains("active")) {
    renderHistory();
  }
  if (
    document.getElementById("view-housekeeping")?.classList.contains("active")
  ) {
    renderHousekeeping();
  }
}

function checkBackupReminder() {
  const el = document.getElementById("backup-reminder");
  if (!el) return;
  if (typeof isRemoteDB === "function" && isRemoteDB()) {
    el.style.display = "none";
    return;
  }
  const last = localStorage.getItem("ketang_last_backup");
  const today = todayStr();
  el.style.display = last === today ? "none" : "block";
}

let boardPollTimer = null;
let lastBoardVersion = null;
let boardPollVisibilityBound = false;

async function pollRemoteBoardVersion() {
  if (!isLoggedIn || (typeof isLoggedIn === "function" && !isLoggedIn()))
    return;
  try {
    const result = await apiBoardVersion();
    if (lastBoardVersion != null && result.version !== lastBoardVersion) {
      await renderAll({ forceSync: true });
    }
    lastBoardVersion = result.version;
  } catch (e) {
    /* 轮询失败不推进版本号 | Do not bump version on poll failure */
  }
}

function onVisibilityChangeRemoteSync() {
  if (document.visibilityState !== "visible") return;
  pollRemoteBoardVersion();
}

function startBoardPolling() {
  if (typeof useRemoteWriteApi !== "function" || !useRemoteWriteApi()) return;
  stopBoardPolling();
  boardPollTimer = setInterval(pollRemoteBoardVersion, 8000);
  if (!boardPollVisibilityBound) {
    document.addEventListener("visibilitychange", onVisibilityChangeRemoteSync);
    boardPollVisibilityBound = true;
  }
}

function stopBoardPolling() {
  if (boardPollTimer) {
    clearInterval(boardPollTimer);
    boardPollTimer = null;
  }
  if (boardPollVisibilityBound) {
    document.removeEventListener(
      "visibilitychange",
      onVisibilityChangeRemoteSync,
    );
    boardPollVisibilityBound = false;
  }
}

function applyDeploymentModeUI() {
  const backupDesc = document.getElementById("backup-mode-desc");
  const backupSteps = document.getElementById("backup-mode-steps");
  const loginHint = document.getElementById("login-hint");
  const isRemote = typeof isRemoteDB === "function" && isRemoteDB();
  if (isRemote) {
    if (backupDesc)
      backupDesc.textContent =
        "数据保存在 Cloudflare D1 云端。管理员可在系统设置导出 JSON 备份。";
    if (backupSteps)
      backupSteps.innerHTML =
        "<li>点击「导出数据库」，保存 JSON 备份到 U 盘或桌面。</li><li>如需恢复：使用「从文件恢复数据」导入 JSON 备份（仅管理员）。</li><li>也可在 Cloudflare D1 控制台执行数据库级备份。</li>";
    if (loginHint) {
      loginHint.hidden = false;
      loginHint.textContent =
        "首次使用：选「管理员」密码 admin，选「知客师」密码 zhike。";
    }
  } else if (loginHint) {
    loginHint.hidden = false;
    loginHint.textContent =
      "本地演示：选「管理员」密码 admin，选「知客师」密码 zhike";
  }
}

function handleBoardSearch(q) {
  q = (q || "").trim().toLowerCase();
  document.querySelectorAll("#room-grid .room-card").forEach(function (card) {
    if (!q) {
      card.classList.remove("search-hidden", "search-match");
      return;
    }
    const text = (card.getAttribute("data-search") || "").toLowerCase();
    const match = text.indexOf(q) !== -1;
    card.classList.toggle("search-hidden", !match);
    card.classList.toggle("search-match", match);
  });
}

function handleLodgerSearch(q) {
  q = (q || "").trim().toLowerCase();
  var rows = document.querySelectorAll("#lodger-table tr");
  var visible = 0;
  rows.forEach(function (row) {
    if (row.querySelector(".empty-tip")) return;
    if (!q) {
      row.classList.remove("search-hidden");
      visible++;
      return;
    }
    var text = (
      row.getAttribute("data-search") ||
      row.textContent ||
      ""
    ).toLowerCase();
    var match = text.indexOf(q) !== -1;
    row.classList.toggle("search-hidden", !match);
    if (match) visible++;
  });
  var hint = document.getElementById("lodgers-search-hint");
  if (!hint) return;
  if (!q) {
    hint.hidden = true;
    hint.textContent = "";
    return;
  }
  hint.hidden = false;
  hint.textContent = visible
    ? "匹配 " + visible + " 人"
    : "未找到匹配的在住挂单";
}

function updateLodgersPageMeta() {
  var countEl = document.getElementById("lodgers-page-count");
  if (!countEl) return;
  var total =
    query("SELECT COUNT(*) as c FROM lodgers WHERE status='在住'")[0]?.c || 0;
  countEl.textContent = total ? "共 " + total + " 人在住" : "暂无在住挂单";
}

function formatBedLabel(bedNumber, index) {
  if (!bedNumber) return "床" + (index + 1);
  if (/^床/.test(String(bedNumber))) return String(bedNumber);
  if (/^\d+$/.test(String(bedNumber))) return "床" + bedNumber;
  return String(bedNumber);
}

function renderTodayMeals() {
  renderTodayMealsPanel();
}

function renderStats() {
  const stats = getBoardBedStats();
  const strip = document.getElementById("kpi-strip");
  if (!strip) return;
  const emptyPct = stats.total
    ? Math.round((stats.empty / stats.total) * 100)
    : 0;
  strip.innerHTML = `
    <div class="kpi-item"><span class="kpi-label">总床位</span><span class="kpi-num" id="stat-total">${stats.total}</span></div>
    <div class="kpi-item kpi-item-bar">
      <span class="kpi-label">已住</span>
      <span class="kpi-num kpi-num-primary">${stats.occupied}</span>
      <div class="stat-bar"><div class="stat-bar-fill" style="width:${stats.occPct}%;background:var(--color-primary);"></div></div>
    </div>
    <div class="kpi-item kpi-item-bar">
      <span class="kpi-label">空床</span>
      <span class="kpi-num">${stats.empty}</span>
      <div class="stat-bar"><div class="stat-bar-fill" style="width:${emptyPct}%;background:var(--color-foreground);"></div></div>
    </div>
    <div class="kpi-item"><span class="kpi-label">在住人数</span><span class="kpi-num">${stats.lodgerCount}</span></div>
    <div class="kpi-item"><span class="kpi-label">脏房</span><span class="kpi-num kpi-num-dai">${stats.dirty}</span></div>
    <div class="kpi-item"><span class="kpi-label">今日预约</span><span class="kpi-num">${stats.resvToday}</span></div>
  `;
}

let _expandedRoomId = null;

function formatCheckoutHint(expectedOut) {
  if (!expectedOut) return "";
  let today = todayStr();
  let tomorrow = dateStr(1);
  if (expectedOut < today) return "已超期";
  if (expectedOut === today) return "今日退";
  if (expectedOut === tomorrow) return "明日退";
  return expectedOut;
}

function ensureRoomDetailPanelHome() {
  const panel = document.getElementById("room-detail-panel");
  const home = document.getElementById("room-detail-home");
  if (panel && home && panel.parentElement !== home) {
    home.appendChild(panel);
  }
}

function closeRoomDetail() {
  _expandedRoomId = null;
  document.querySelectorAll(".room-card-selected").forEach(function (c) {
    c.classList.remove("room-card-selected");
  });
  const panel = document.getElementById("room-detail-panel");
  if (panel) {
    panel.hidden = true;
    panel.innerHTML = "";
  }
  ensureRoomDetailPanelHome();
}

function splitBedColumns(beds, cols) {
  cols = cols || 3;
  if (!beds.length) return [];
  const perCol = Math.ceil(beds.length / cols);
  const columns = [];
  for (let i = 0; i < cols; i++) {
    const chunk = beds.slice(i * perCol, (i + 1) * perCol);
    if (chunk.length) columns.push(chunk);
  }
  return columns;
}

function renderBedDetailRow(b, idx) {
  let bedLabel = escapeHtml(formatBedLabel(b.bed_number, idx));
  const bedTag = '<span class="room-detail-bed-tag">' + bedLabel + "</span>";
  let actionHtml = "";

  if (b.lodger_id) {
    actionHtml = renderBedActionMenu(b.lodger_id);
    return (
      '<div class="room-detail-row room-detail-row-occ">' +
      '<div class="room-detail-row-main">' +
      bedTag +
      '<span class="room-detail-row-text">' +
      '<span class="room-detail-dot room-detail-dot-occ" aria-hidden="true">●</span>' +
      '<span class="room-detail-guest">' +
      escapeHtml(personDisplayName(b)) +
      "</span>" +
      "</span>" +
      "</div>" +
      actionHtml +
      "</div>"
    );
  }
  if (b.status === "维修") {
    return (
      '<div class="room-detail-row room-detail-row-dirty">' +
      '<div class="room-detail-row-main">' +
      bedTag +
      '<span class="room-detail-row-text room-detail-row-muted">' +
      '<span class="room-detail-dot room-detail-dot-dirty" aria-hidden="true">●</span>' +
      '<span class="room-detail-status">维修中</span>' +
      "</span>" +
      "</div>" +
      "</div>"
    );
  }
  if (b.hk_status === "脏房") {
    return (
      '<div class="room-detail-row room-detail-row-dirty">' +
      '<div class="room-detail-row-main">' +
      bedTag +
      '<span class="room-detail-row-text room-detail-row-muted">' +
      '<span class="room-detail-dot room-detail-dot-dirty" aria-hidden="true">●</span>' +
      '<span class="room-detail-status">清洁中</span>' +
      "</span>" +
      "</div>" +
      "</div>"
    );
  }
  actionHtml =
    '<button type="button" class="bed-action-trigger bed-action-trigger-icon bed-action-trigger-assign" title="入住" aria-label="入住" onclick="event.stopPropagation(); openCheckinForBed(' +
    b.id +
    ')">' +
    icon("assign", "icon-xs") +
    "</button>";
  return (
    '<div class="room-detail-row room-detail-row-free">' +
    '<div class="room-detail-row-main">' +
    bedTag +
    '<span class="room-detail-row-text room-detail-row-muted">' +
    '<span class="room-detail-dot room-detail-dot-free" aria-hidden="true">○</span>' +
    '<span class="room-detail-status">空</span>' +
    "</span>" +
    "</div>" +
    actionHtml +
    "</div>"
  );
}

function toggleRoomExpand(roomId, cardEl) {
  if (_expandedRoomId === roomId) {
    closeRoomDetail();
    return;
  }
  _expandedRoomId = roomId;
  document.querySelectorAll(".room-card-selected").forEach(function (c) {
    c.classList.remove("room-card-selected");
  });
  if (cardEl) cardEl.classList.add("room-card-selected");
  renderRoomDetailPanel(roomId, cardEl);
}

function renderRoomDetailPanel(roomId, cardEl) {
  const panel = document.getElementById("room-detail-panel");
  if (!panel) return;
  const r = query("SELECT * FROM rooms WHERE id = ?", [roomId])[0];
  if (!r) {
    closeRoomDetail();
    return;
  }

  const beds = query(
    `
    SELECT b.*, l.id as lodger_id, l.name, l.dharma_name,
      COALESCE((SELECT status FROM housekeeping WHERE bed_id = b.id ORDER BY changed_at DESC LIMIT 1), '净房') as hk_status
    FROM beds b
    LEFT JOIN lodgers l ON l.bed_id = b.id AND l.status='在住'
        WHERE b.room_id = ? AND b.status != '备用'
        ORDER BY b.id
      `,
    [roomId],
  );
  const columns = splitBedColumns(beds, 3);
  let offset = 0;
  const columnsHtml = columns
    .map(function (colBeds) {
      let rows = colBeds
        .map(function (b, i) {
          return renderBedDetailRow(b, offset + i);
        })
        .join("");
      offset += colBeds.length;
      return '<div class="room-detail-col">' + rows + "</div>";
    })
    .join("");

  panel.innerHTML =
    '<div class="room-detail-head">' +
    '<span class="room-detail-head-title">' +
    escapeHtml(r.name) +
    " · 床位</span>" +
    '<button type="button" class="room-detail-close" onclick="closeRoomDetail()" aria-label="关闭">' +
    icon("close", "icon-sm") +
    "</button>" +
    "</div>" +
    '<div class="room-detail-body">' +
    '<div class="room-detail-columns">' +
    columnsHtml +
    "</div>" +
    "</div>";

  const section = cardEl && cardEl.closest(".board-loc-section");
  if (section) section.appendChild(panel);
  panel.hidden = false;
}

function renderRooms() {
  const grid = document.getElementById("room-grid");
  if (!grid) return;
  closeRoomDetail();
  if (
    typeof isRemoteDataUnavailable === "function" &&
    isRemoteDataUnavailable()
  ) {
    const msg =
      remoteSyncStatus === "error"
        ? remoteSyncError || "数据同步失败，请刷新后重试"
        : "正在加载房态数据…";
    grid.innerHTML =
      '<p class="empty-tip">' + escapeHtml(msg) + "</p>";
    return;
  }
  const rooms = query("SELECT * FROM rooms ORDER BY floor ASC, id");

  let groups = {};
  const locFloor = {};
  rooms.forEach(function (r) {
    if (isSpareRoom(r)) return;
    let key = r.location || "其他";
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
    if (locFloor[key] === undefined || r.floor > locFloor[key])
      locFloor[key] = r.floor;
  });

  const locOrder = Object.keys(groups).sort(function (a, b) {
    return (locFloor[a] || 0) - (locFloor[b] || 0);
  });

  let html = "";

  locOrder.forEach(function (loc) {
    const rlist = groups[loc].slice().sort(function (a, b) {
      const fa = a.floor || 0;
      const fb = b.floor || 0;
      if (fa !== fb) return fa - fb;
      return a.id - b.id;
    });
    if (!rlist.length) return;
    let sectionHtml = '<div class="board-loc-section">';
    sectionHtml +=
      '<div class="board-loc-title-row"><h3 class="board-loc-title">' +
      escapeHtml(loc) +
      " · " +
      rlist.length +
      " 间</h3></div>";
    sectionHtml += '<div class="room-grid">';

    rlist.forEach(function (r) {
      if (isSpareRoom(r)) return;
      const beds = query(
        `
        SELECT b.*, l.id as lodger_id, l.name, l.dharma_name, l.gender,
          COALESCE((SELECT status FROM housekeeping WHERE bed_id = b.id ORDER BY changed_at DESC LIMIT 1), '净房') as hk_status
        FROM beds b
        LEFT JOIN lodgers l ON l.bed_id = b.id AND l.status='在住'
        WHERE b.room_id = ? AND b.status != '备用'
        ORDER BY b.id
      `,
        [r.id],
      );

      const totalBeds = beds.length;
      if (!totalBeds) return;

      const occBeds = beds.filter(function (b) {
        return b.lodger_id;
      }).length;
      let dirtyBeds = beds.filter(function (b) {
        return !b.lodger_id && b.hk_status === "脏房";
      }).length;
      const maintBeds = beds.filter(function (b) {
        return b.status === "维修";
      }).length;
      let cardTheme = "empty";
      if (maintBeds > 0 || dirtyBeds > 0) cardTheme = "dirty";
      else if (occBeds >= totalBeds && totalBeds > 0) cardTheme = "full";
      else if (occBeds > 0) cardTheme = "partial";

      const cleanIcon =
        dirtyBeds > 0 || maintBeds > 0
          ? '<span class="room-card-clean-icon" aria-label="脏房或维护">' +
            icon("cleaning", "icon-sm") +
            "</span>"
          : "";

      const nameCls = cardTheme === "empty" ? " room-card-name-muted" : "";

      const miniDots = beds
        .map(function (b, idx) {
          let dotCls = "room-bed-dot-avail";
          let tip = formatBedLabel(b.bed_number, idx) + " · ";
          if (b.lodger_id) {
            dotCls = "room-bed-dot-occ";
            tip += personDisplayName(b);
          } else if (b.status === "维修") {
            dotCls = "room-bed-dot-blocked";
            tip += "维修中";
          } else if (b.hk_status === "脏房") {
            dotCls = "room-bed-dot-blocked";
            tip += "清洁中";
          } else {
            tip += "空 · 可住";
          }
          return (
            '<span class="room-bed-dot ' +
            dotCls +
            '" title="' +
            escapeHtml(tip) +
            '"></span>'
          );
        })
        .join("");

      const searchParts = [r.name, r.location, r.dorm_type];
      beds.forEach(function (b) {
        if (b.lodger_id) searchParts.push(personDisplayName(b));
      });
      const searchAttr = escapeHtml(
        searchParts.filter(Boolean).join(" ").toLowerCase(),
      );

      const occLabel = occBeds + "/" + totalBeds;
      const metaRight = cleanIcon
        ? cleanIcon + '<span class="room-card-occ">' + occLabel + "</span>"
        : '<span class="room-card-occ">' + occLabel + "</span>";
      const dotsClass = totalBeds > 10 ? " room-bed-dots-dense" : "";
      const bodyHtml =
        '<div class="room-card-meta-row">' +
        '<div class="room-bed-dots' +
        dotsClass +
        '" aria-hidden="true">' +
        miniDots +
        "</div>" +
        metaRight +
        "</div>";

      const dormCls =
        r.dorm_type === "男寮"
          ? " room-card-dorm-male"
          : r.dorm_type === "女寮"
            ? " room-card-dorm-female"
            : "";

      sectionHtml +=
        '<div class="room-card room-card-' +
        cardTheme +
        dormCls +
        '" data-search="' +
        searchAttr +
        '" onclick="toggleRoomExpand(' +
        r.id +
        ', this)">' +
        '<div class="room-card-header">' +
        '<span class="room-card-name' +
        nameCls +
        '" title="' +
        escapeHtml(r.name) +
        '">' +
        escapeHtml(r.name) +
        "</span>" +
        "</div>" +
        '<div class="room-card-body">' +
        bodyHtml +
        "</div>" +
        "</div>";
    });

    sectionHtml += "</div></div>";
    html += sectionHtml;
  });

  grid.innerHTML =
    html || '<p class="empty-tip">暂无房间数据，请先在基础设置中维护房号。</p>';
}

function lodgerMealsToday(lodgerId) {
  return formatLodgerMealsToday(lodgerId);
}

function formatCheckoutCell(l) {
  const out = l.expected_check_out;
  if (!out) return "-";
  const today = todayStr();
  const tomorrow = dateStr(1);
  if (out < today) {
    return '<span class="badge-overdue">已超期</span> ' + escapeHtml(out);
  }
  if (out === today) {
    return '<span class="checkout-today">' + escapeHtml(out) + " (今日)</span>";
  }
  if (out === tomorrow) {
    return escapeHtml(out) + " (明日)";
  }
  return escapeHtml(out);
}

function renderLodgers() {
  const tbody = document.getElementById("lodger-table");
  if (!tbody) return;
  tbody.innerHTML = "";
  const lodgers = query(`
    SELECT l.*, r.name as room_name, r.location, b.bed_number
    FROM lodgers l
    LEFT JOIN beds b ON b.id = l.bed_id
    LEFT JOIN rooms r ON r.id = b.room_id
    WHERE l.status='在住'
    ORDER BY l.check_in_date DESC, l.id DESC
  `);
  lodgers.forEach(function (l, idx) {
    const bedLabel = formatBedLabel(l.bed_number, 0);
    const roomLabel = escapeHtml(
      (l.room_name || "-") + (l.bed_number ? " - " + bedLabel : ""),
    );
    const searchParts = [
      personDisplayName(l),
      l.gender,
      l.phone,
      l.role,
      l.room_name,
      l.location,
      l.bed_number,
      l.check_in_date,
      l.expected_check_out,
    ];
    const tr = document.createElement("tr");
    tr.setAttribute(
      "data-search",
      searchParts.filter(Boolean).join(" ").toLowerCase(),
    );
    tr.innerHTML = `
      <td class="lodger-name">${escapeHtml(personDisplayName(l))}</td>
      <td>${escapeHtml(l.gender) || "-"}</td>
      <td>${roomLabel}</td>
      <td>${escapeHtml(l.check_in_date) || "-"}</td>
      <td>${formatCheckoutCell(l)}</td>
      <td class="meal-today-cell" onclick="openMealModal(${l.id})" title="点击管理用斋">${lodgerMealsToday(l.id)}</td>
      <td class="col-actions">${renderBedActionMenu(l.id)}</td>
    `;
    tbody.appendChild(tr);
  });
  if (lodgers.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="7" class="empty-tip">暂无在住挂单</td></tr>';
  }
  updateLodgersPageMeta();
}

let _reminderData = {};

function renderOpsNotice() {
  const el = document.getElementById("ops-notice-text");
  if (!el) return;
  const today = todayStr();

  // 今日到离预报
  const arrivals = query(
    `
    SELECT COUNT(*) as c FROM (
      SELECT id FROM reservations WHERE expected_check_in = ? AND status IN ('预约','已确认')
      UNION ALL
      SELECT id FROM lodgers WHERE check_in_date = ? AND status = '在住'
    )
  `,
    [today, today],
  )[0].c;
  const departures = query(
    "SELECT COUNT(*) as c FROM lodgers WHERE expected_check_out = ? AND status = '在住'",
    [today],
  )[0].c;

  if (arrivals > 0 || departures > 0) {
    const changeRooms = query(
      `
      SELECT COUNT(*) as c FROM (
        SELECT DISTINCT b.room_id FROM reservations res
        LEFT JOIN beds b ON b.id = (
          SELECT id FROM beds WHERE room_id IN (
            SELECT id FROM rooms WHERE dorm_type = CASE WHEN res.gender='男' THEN '男寮' WHEN res.gender='女' THEN '女寮' ELSE '不限' END
          ) AND status != '维修' AND status != '备用' LIMIT 1
        )
        WHERE res.expected_check_in = ? AND res.status IN ('预约','已确认')
        UNION
        SELECT DISTINCT b.room_id FROM lodgers l JOIN beds b ON b.id = l.bed_id
        WHERE l.expected_check_out = ? AND l.status = '在住'
      )
    `,
      [today, today],
    )[0].c;
    el.innerHTML = `<strong>今日预报：</strong>预计到达 <strong>${arrivals}</strong> 人，预计离开 <strong>${departures}</strong> 人，涉及约 <strong>${changeRooms}</strong> 个房间变动。
      <a href="javascript:void(0)" onclick="showView('forecast'); renderForecastTab('today')" style="margin-left:var(--space-2);text-decoration:underline;color:var(--color-primary)">查看详情</a>`;
    return;
  }

  // 营期招生预警：未来 7 天内开始且招生不足
  const upcomingEvents = query(
    `
    SELECT e.*,
      (SELECT COUNT(*) FROM lodgers l WHERE l.event_id = e.id AND l.status = '在住') as checked_in,
      (SELECT COUNT(*) FROM reservations r WHERE r.event_id = e.id AND r.status IN ('预约','已确认')) as reserved
    FROM events e
    WHERE e.status IN ('筹备中','招生中')
      AND e.start_date IS NOT NULL
      AND e.start_date >= ?
      AND e.start_date <= ?
      AND e.expected_count > 0
    ORDER BY e.start_date ASC
  `,
    [today, dateStr(7)],
  );
  const alerts = upcomingEvents.filter((e) => {
    const registered = (e.checked_in || 0) + (e.reserved || 0);
    return registered < e.expected_count;
  });
  if (alerts.length > 0) {
    const first = alerts[0];
    const gap =
      first.expected_count - (first.checked_in || 0) - (first.reserved || 0);
    const more = alerts.length > 1 ? `等 ${alerts.length} 个营期` : "";
    el.innerHTML = `<strong>招生预警：</strong>${escapeHtml(first.name)}${more} 预计 ${first.expected_count} 人，目前还差 <strong>${gap}</strong> 人。
      <a href="javascript:void(0)" onclick="showView('info'); renderInfo('events')" style="margin-left:var(--space-2);text-decoration:underline;color:var(--color-primary)">去营期管理</a>`;
    return;
  }

  // 脏房提醒
  const dirtyBeds = query(`
    SELECT r.name as room_name, b.bed_number
    FROM beds b
    JOIN rooms r ON r.id = b.room_id
    WHERE b.status != '备用'
      AND ${spareRoomExcludeClause("r")}
      AND (SELECT status FROM housekeeping WHERE bed_id = b.id ORDER BY changed_at DESC LIMIT 1) = '脏房'
    LIMIT 3
  `);
  if (dirtyBeds.length === 0) {
    el.textContent = "房态正常，暂无特殊待办。";
    return;
  }
  const first = dirtyBeds[0];
  const label =
    escapeHtml(first.room_name) +
    (first.bed_number
      ? " " + escapeHtml(formatBedLabel(first.bed_number, 0))
      : "");
  el.innerHTML = "提醒：" + label + " 需在今日午后安排深度清洁维护。";
}

function switchReminderTab(key) {
  document.querySelectorAll("#reminder-tabs .tab-btn").forEach(function (btn) {
    btn.classList.toggle("active", btn.dataset.tab === key);
    btn.setAttribute(
      "aria-selected",
      btn.dataset.tab === key ? "true" : "false",
    );
  });
  const listEl = document.getElementById("reminders");
  if (!listEl) return;
  listEl.className = "reminder-list reminder-list-grid";
  const rows = _reminderData[key] || [];
  if (rows.length === 0) {
    listEl.innerHTML = '<div class="empty-tip">无</div>';
    return;
  }
  listEl.innerHTML = rows
    .map(function (r, i) {
      const dormLabel =
        r.dorm_type === "男寮"
          ? "男寮"
          : r.dorm_type === "女寮"
            ? "女寮"
            : escapeHtml(r.dorm_type || "");
      const room = escapeHtml(r.room_name || "-");
      const timeHint =
        key === "today"
          ? '<span class="reminder-time">' +
            (i % 2 === 0 ? "12:00 前" : "14:00 前") +
            "</span>"
          : "";
      return (
        '<div class="reminder-row">' +
        "<span><strong>" +
        escapeHtml(personDisplayName(r)) +
        '</strong> <span class="reminder-meta">(' +
        dormLabel +
        " " +
        room +
        ")</span></span>" +
        '<span class="reminder-row-actions">' +
        timeHint +
        renderBedActionMenu(r.id) +
        "</span>" +
        "</div>"
      );
    })
    .join("");
}

function renderCheckoutReminders() {
  const tabsEl = document.getElementById("reminder-tabs");
  const listEl = document.getElementById("reminders");
  if (!tabsEl || !listEl) return;
  _reminderData = {};
  const groups = [
    { key: "today", label: "今日应退", date: todayStr() },
    { key: "tomorrow", label: "明日应退", date: dateStr(1) },
    { key: "overdue", label: "已超期", date: null },
  ];
  groups.forEach(function (g) {
    let sql = `SELECT l.*, r.name as room_name, r.dorm_type, b.bed_number FROM lodgers l LEFT JOIN beds b ON b.id=l.bed_id LEFT JOIN rooms r ON r.id=b.room_id WHERE l.status='在住' `;
    const params = [];
    if (g.key === "overdue") {
      sql += `AND l.expected_check_out IS NOT NULL AND l.expected_check_out < ? ORDER BY l.expected_check_out ASC`;
      params.push(todayStr());
    } else {
      sql += `AND l.expected_check_out = ? ORDER BY r.name ASC`;
      params.push(g.date);
    }
    _reminderData[g.key] = query(sql, params);
  });
  tabsEl.innerHTML = groups
    .map(function (g, i) {
      const count = _reminderData[g.key].length;
      const overdueCls =
        g.key === "overdue" && count > 0 ? " tab-btn-danger" : "";
      const activeBadgeCls = i === 0 ? " tab-badge-active" : "";
      return (
        '<button type="button" class="tab-btn' +
        (i === 0 ? " active" : "") +
        overdueCls +
        '" role="tab" data-tab="' +
        g.key +
        '" aria-selected="' +
        (i === 0 ? "true" : "false") +
        '" onclick="switchReminderTab(\'' +
        g.key +
        "')\">" +
        escapeHtml(g.label) +
        ' <span class="tab-badge' +
        activeBadgeCls +
        '">' +
        count +
        "</span></button>"
      );
    })
    .join("");
  switchReminderTab("today");
  renderOpsNotice();
}

function setModalBody(html) {
  const body = document.getElementById("modal-body");
  body.innerHTML = html;
  if (typeof upgradeSelects === "function") upgradeSelects(body);
}

let _confirmResolver = null;

function dismissConfirm(result) {
  if (!_confirmResolver) return;
  const resolve = _confirmResolver;
  _confirmResolver = null;
  document.getElementById("modal").classList.remove("active");
  if (typeof closeAllSelectPickers === "function") closeAllSelectPickers();
  resolve(result);
}

function showConfirm(options) {
  options = options || {};
  return new Promise(function (resolve) {
    _confirmResolver = resolve;
    let title = options.title || "确认";
    const message = options.message || "";
    const confirmText = options.confirmText || "确定";
    const cancelText = options.cancelText || "取消";
    const danger = !!options.danger;
    document.getElementById("modal-title").textContent = title;
    setModalBody(
      '<div class="modal-form confirm-dialog">' +
        '<p class="confirm-dialog-message">' +
        escapeHtml(message).replace(/\n/g, "<br>") +
        "</p>" +
        '<div class="modal-actions">' +
        '<button type="button" class="btn btn-default" id="confirm-cancel">' +
        escapeHtml(cancelText) +
        "</button>" +
        '<button type="button" class="btn ' +
        (danger ? "btn-danger" : "btn-primary") +
        '" id="confirm-ok">' +
        escapeHtml(confirmText) +
        "</button>" +
        "</div>" +
        "</div>",
    );
    document.getElementById("confirm-cancel").onclick = function () {
      dismissConfirm(false);
    };
    document.getElementById("confirm-ok").onclick = function () {
      dismissConfirm(true);
    };
    document.getElementById("modal").classList.add("active");
  });
}

function closeModal() {
  if (_confirmResolver) {
    dismissConfirm(false);
    return;
  }
  document.getElementById("modal").classList.remove("active");
  if (typeof closeAllSelectPickers === "function") closeAllSelectPickers();
}
