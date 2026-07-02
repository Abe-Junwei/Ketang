/* 云端同步协调 | Remote sync coordinator (Phase 12.2–12.5) */

var BOARD_POLL_INTERVAL_MS = 3000;
var BOARD_POLL_IDLE_INTERVAL_MS = 20000;

var SYNC_DOMAIN_MODULES = {
  board: "board",
  lodging: "lodgers",
  events: "events",
  reservations: "reservations",
  meals: "meals",
  settings: "settings",
};

var INFO_TAB_MODULES = {
  rooms: "settings_rooms",
  beds: "settings_beds",
  guests: "settings_guests",
  lodgers: "lodgers_records",
  events: "events",
};

/** 视图写后同步/刷新范围 | View-scoped sync + render (industry: minimal refresh) */
var VIEW_SYNC_SCOPES = {
  board: {
    module: "board",
    refresh: function () {
      if (typeof renderRooms === "function") renderRooms();
      if (typeof renderBoard === "function") renderBoard();
    },
  },
  lodgers: {
    module: "lodgers_records",
    refresh: function () {
      if (typeof renderLodgersPage === "function") renderLodgersPage();
    },
  },
  lodging: {
    module: "board",
    refresh: function () {
      if (typeof renderLodging === "function") renderLodging();
    },
  },
  stay: {
    module: "board",
    refresh: function () {
      if (typeof renderBedOptions === "function") renderBedOptions();
      var mode =
        typeof _pendingStayMode !== "undefined" ? _pendingStayMode : "checkin";
      if (typeof setStayMode === "function") setStayMode(mode);
    },
  },
  housekeeping: {
    module: "board",
    refresh: function () {
      if (typeof renderHousekeeping === "function") renderHousekeeping();
    },
  },
  reports: {
    refresh: function () {
      if (
        !document.getElementById("view-reports")?.classList.contains("active")
      )
        return;
      if (typeof renderMealReport === "function") renderMealReport();
      if (typeof renderDailyReport === "function") renderDailyReport();
      if (typeof renderMonthlyReport === "function") renderMonthlyReport();
      if (typeof renderEventReport === "function") renderEventReport();
    },
  },
  forecast: {
    refresh: function () {
      if (
        !document.getElementById("view-forecast")?.classList.contains("active")
      )
        return;
      var tab =
        document.querySelector(".forecast-tab-btn.active")?.dataset.tab ||
        "today";
      if (typeof renderForecastTab === "function") renderForecastTab(tab);
    },
  },
  history: {
    module: "lodgers_records",
    refresh: function () {
      if (typeof renderHistory === "function") renderHistory();
    },
  },
  info: {
    refresh: function () {
      if (typeof renderInfo === "function") {
        renderInfo(
          typeof infoCurrentTab !== "undefined" ? infoCurrentTab : "rooms",
        );
      }
    },
  },
  backup: {
    refresh: function () {
      if (typeof renderOperationalSettingsPanel === "function") {
        renderOperationalSettingsPanel();
      }
      if (typeof renderRolePermissionsPanel === "function") {
        renderRolePermissionsPanel();
      }
      if (typeof renderUserList === "function") renderUserList();
    },
  },
};

var _viewRefreshHandlers = {};
var _boardEventSource = null;
var _boardSseVersion = null;
var _boardSseRetryMs = 3000;
var _boardSseRetryTimer = null;

function parseBoardVersion(value) {
  if (value == null || value === "") return null;
  var n = parseInt(value, 10);
  return isFinite(n) ? n : null;
}

function getLocalBoardVersion() {
  return typeof lastBoardVersion !== "undefined" ? lastBoardVersion : null;
}

function setLocalBoardVersion(version) {
  if (typeof lastBoardVersion !== "undefined") {
    lastBoardVersion = version;
  }
}

function isBoardViewActive() {
  return !!document.getElementById("view-board")?.classList.contains("active");
}

function getBoardPollIntervalMs() {
  return isBoardViewActive()
    ? BOARD_POLL_INTERVAL_MS
    : BOARD_POLL_IDLE_INTERVAL_MS;
}

function registerViewRefresh(viewId, fn) {
  if (!viewId || typeof fn !== "function") return;
  _viewRefreshHandlers[viewId] = fn;
}

function getActiveViewId() {
  var active = document.querySelector(".view.active");
  if (!active || !active.id) return null;
  return active.id.replace(/^view-/, "");
}

function resolveScopeModuleKey(options) {
  var infoTab = options && options.infoTab;
  if (infoTab && INFO_TAB_MODULES[infoTab]) return INFO_TAB_MODULES[infoTab];
  var scope = options && options.scope;
  if (scope && VIEW_SYNC_SCOPES[scope] && VIEW_SYNC_SCOPES[scope].module) {
    return VIEW_SYNC_SCOPES[scope].module;
  }
  if (options && options.useActiveViewModule) {
    var active = getActiveViewId();
    if (active && VIEW_SYNC_SCOPES[active] && VIEW_SYNC_SCOPES[active].module) {
      return VIEW_SYNC_SCOPES[active].module;
    }
  }
  return null;
}

function refreshViewForScope(scopeKey, options) {
  var key = scopeKey || getActiveViewId();
  if (!key) return;
  if (options && options.infoOnly) {
    if (typeof renderInfo === "function") {
      renderInfo(
        options.infoTab ||
          (typeof infoCurrentTab !== "undefined" ? infoCurrentTab : "rooms"),
      );
    }
    return;
  }
  var scope = VIEW_SYNC_SCOPES[key];
  if (scope && typeof scope.refresh === "function") {
    scope.refresh(options);
    return;
  }
  if (_viewRefreshHandlers[key]) {
    _viewRefreshHandlers[key](options);
  }
}

function lodgingModuleForView(active) {
  if (active === "lodgers" || active === "history") return "lodgers_records";
  if (
    active === "board" ||
    active === "lodging" ||
    active === "housekeeping" ||
    active === "stay"
  ) {
    return "board";
  }
  if (active === "info" && typeof infoCurrentTab !== "undefined") {
    return INFO_TAB_MODULES[infoCurrentTab] === "lodgers_records"
      ? "lodgers_records"
      : null;
  }
  return "lodgers";
}

function domainsToModules(domains, options) {
  var scoped = resolveScopeModuleKey(options);
  if (scoped && options && (options.scope || options.infoTab)) return [scoped];

  var keys = [];
  var active = getActiveViewId();
  (domains || []).forEach(function (domain) {
    if (domain === "housekeeping" && keys.indexOf("board") !== -1) return;
    if (domain === "lodging") {
      var lodgingMod = lodgingModuleForView(active);
      if (lodgingMod && keys.indexOf(lodgingMod) === -1) keys.push(lodgingMod);
      return;
    }
    if (domain === "board") {
      if (keys.indexOf("board") === -1) keys.push("board");
      return;
    }
    var mod = SYNC_DOMAIN_MODULES[domain];
    if (mod && keys.indexOf(mod) === -1) keys.push(mod);
  });
  if (keys.indexOf("board") !== -1) {
    return keys.filter(function (k) {
      return k !== "lodgers_records" && k !== "lodgers";
    });
  }
  return keys;
}

function dedupeReadModules(modules) {
  var keys = [];
  (modules || []).forEach(function (mod) {
    if (mod && keys.indexOf(mod) === -1) keys.push(mod);
  });
  if (keys.indexOf("board") !== -1) {
    return keys.filter(function (k) {
      return k !== "lodgers_records" && k !== "lodgers" && k !== "settings";
    });
  }
  return keys;
}

function writeResultToModules(writeResult, options) {
  var fromServer = writeResult && writeResult.changed_modules;
  if (Array.isArray(fromServer) && fromServer.length) {
    return dedupeReadModules(fromServer);
  }
  return domainsToModules(writeResult && writeResult.changed_domains, options);
}

function notifyViewsForDomains(domains) {
  var seen = {};
  (domains || []).forEach(function (domain) {
    var mod = SYNC_DOMAIN_MODULES[domain];
    if (mod && _viewRefreshHandlers["module:" + mod]) {
      _viewRefreshHandlers["module:" + mod]();
      seen[mod] = true;
    }
    if (_viewRefreshHandlers["domain:" + domain]) {
      _viewRefreshHandlers["domain:" + domain]();
    }
  });
  if (domains && domains.indexOf("events") !== -1) {
    refreshActiveViewsAfterSync();
  }
  if (!domains || !domains.length) {
    refreshActiveViewsAfterSync();
  }
}

function refreshActiveViewsAfterSync() {
  refreshViewForScope(getActiveViewId());
}

async function fetchAndApplyModule(moduleKey) {
  var payload = await apiReadModule(moduleKey, getLocalBoardVersion());
  if (payload && payload.notModified) {
    if (payload.board_version != null)
      setLocalBoardVersion(payload.board_version);
    return { module: moduleKey, skipped: true };
  }
  if (payload && payload.tables) {
    applyModuleTables(payload.tables);
  }
  if (payload && payload.board_version != null) {
    setLocalBoardVersion(payload.board_version);
  }
  return { module: moduleKey, skipped: false };
}

async function syncRemoteByModules(modules, domains) {
  if (!modules || !modules.length) return false;
  setRemoteSyncStatus("loading");
  try {
    for (var i = 0; i < modules.length; i++) {
      await fetchAndApplyModule(modules[i]);
    }
    remoteReadModelReady = true;
    lastRemoteSyncAt = Date.now();
    setRemoteSyncStatus("ready");
    notifyViewsForDomains(domains || []);
    return true;
  } catch (e) {
    setRemoteSyncStatus("error", e.message || "数据同步失败");
    throw e;
  }
}

async function syncRemoteByDomains(domains, options) {
  var modules = domainsToModules(domains, options);
  if (!modules.length) return false;
  setRemoteSyncStatus("loading");
  try {
    for (var i = 0; i < modules.length; i++) {
      await fetchAndApplyModule(modules[i]);
    }
    remoteReadModelReady = true;
    lastRemoteSyncAt = Date.now();
    setRemoteSyncStatus("ready");
    notifyViewsForDomains(domains);
    return true;
  } catch (e) {
    setRemoteSyncStatus("error", e.message || "数据同步失败");
    throw e;
  }
}

async function syncRemoteDeltaSince(sinceVersion) {
  var since = parseBoardVersion(sinceVersion);
  if (since == null) return false;
  setRemoteSyncStatus("loading");
  try {
    var delta = await apiSyncDelta(since, since);
    if (delta && delta.not_modified) {
      if (delta.board_version != null)
        setLocalBoardVersion(delta.board_version);
      setRemoteSyncStatus("ready");
      return true;
    }
    if (delta && delta.full_sync_required) {
      await syncRemoteReadModel({ force: true });
      return true;
    }
    if (typeof applyRemoteDelta === "function") {
      applyRemoteDelta(delta);
    }
    notifyViewsForDomains(delta.domains || []);
    return true;
  } catch (e) {
    setRemoteSyncStatus("error", e.message || "数据同步失败");
    throw e;
  }
}

/** 写操作后按需同步 | Sync after write */
async function syncAfterRemoteWrite(writeResult, options) {
  if (typeof isRemoteDB !== "function" || !isRemoteDB()) return;
  if (typeof isLoggedIn === "function" && !isLoggedIn()) return;

  var scopedModule = resolveScopeModuleKey(
    Object.assign({ useActiveViewModule: true }, options || {}),
  );

  var writeVersion = parseBoardVersion(
    writeResult && writeResult.board_version,
  );
  var localVersion = getLocalBoardVersion();

  if (
    writeVersion != null &&
    localVersion != null &&
    writeVersion === localVersion &&
    !scopedModule
  ) {
    notifyViewsForDomains(writeResult && writeResult.changed_domains);
    return;
  }

  if (!remoteReadModelReady || localVersion == null) {
    await syncRemoteReadModel({ force: true });
    notifyViewsForDomains(writeResult && writeResult.changed_domains);
    return;
  }

  if (scopedModule) {
    setRemoteSyncStatus("loading");
    try {
      await fetchAndApplyModule(scopedModule);
      remoteReadModelReady = true;
      lastRemoteSyncAt = Date.now();
      setRemoteSyncStatus("ready");
    } catch (e) {
      setRemoteSyncStatus("error", e.message || "数据同步失败");
      throw e;
    }
    return;
  }

  var domains =
    writeResult && Array.isArray(writeResult.changed_domains)
      ? writeResult.changed_domains
      : null;
  var modules = writeResultToModules(writeResult, options);
  if (modules.length) {
    await syncRemoteByModules(modules, domains);
    return;
  }

  if (domains && domains.length) {
    await syncRemoteByDomains(domains, options);
    return;
  }

  if (writeVersion != null && writeVersion > localVersion) {
    await syncRemoteDeltaSince(localVersion);
    return;
  }

  var board = await apiBoardVersion();
  var remoteVersion = parseBoardVersion(board.version);
  if (remoteVersion != null && remoteVersion === localVersion) {
    return;
  }
  await syncRemoteDeltaSince(localVersion);
}

/** 轮询/SSE 触发的增量同步 | Background incremental sync */
async function syncRemoteIfStale() {
  if (typeof isRemoteDB !== "function" || !isRemoteDB()) return;
  if (typeof isLoggedIn === "function" && !isLoggedIn()) return;
  if (!remoteReadModelReady) {
    await syncRemoteReadModel({ force: true });
    return;
  }
  var localVersion = getLocalBoardVersion();
  if (localVersion == null) {
    await syncRemoteReadModel({ force: true });
    return;
  }
  var board = await apiBoardVersion();
  var remoteVersion = parseBoardVersion(board.version);
  if (remoteVersion == null || remoteVersion === localVersion) return;
  await syncRemoteDeltaSince(localVersion);
  refreshViewForScope(getActiveViewId());
}

function stopBoardStream(cancelRetry) {
  if (_boardEventSource) {
    try {
      _boardEventSource.close();
    } catch (e) {
      /* ignore */
    }
    _boardEventSource = null;
  }
  _boardSseVersion = null;
  if (cancelRetry !== false && _boardSseRetryTimer) {
    clearTimeout(_boardSseRetryTimer);
    _boardSseRetryTimer = null;
    _boardSseRetryMs = 3000;
  }
}

function scheduleBoardStreamReconnect() {
  if (typeof isBoardViewActive === "function" && !isBoardViewActive()) return;
  if (_boardSseRetryTimer || _boardEventSource) return;
  _boardSseRetryTimer = setTimeout(function () {
    _boardSseRetryTimer = null;
    startBoardStream();
    _boardSseRetryMs = Math.min(_boardSseRetryMs * 2, 30000);
  }, _boardSseRetryMs);
}

function startBoardStream() {
  if (typeof isRemoteDB !== "function" || !isRemoteDB()) return;
  if (typeof EventSource === "undefined") return;
  if (_boardEventSource) return;
  _boardEventSource = new EventSource("/api/v1/stream/board", {
    withCredentials: true,
  });
  _boardEventSource.onmessage = function (event) {
    try {
      var payload = JSON.parse(event.data || "{}");
      var version = parseBoardVersion(payload.version);
      if (version == null) return;
      _boardSseRetryMs = 3000;
      if (_boardSseVersion != null && version === _boardSseVersion) return;
      _boardSseVersion = version;
      syncRemoteIfStale().catch(function () {
        /* non-fatal */
      });
    } catch (e) {
      /* ignore malformed SSE payload */
    }
  };
  _boardEventSource.onerror = function () {
    if (_boardEventSource) {
      try {
        _boardEventSource.close();
      } catch (e) {
        /* ignore */
      }
      _boardEventSource = null;
    }
    scheduleBoardStreamReconnect();
  };
}

function onBoardViewVisibilityChange() {
  if (!isBoardViewActive()) {
    stopBoardStream(true);
    return;
  }
  startBoardStream();
  syncRemoteIfStale().catch(function () {
    /* non-fatal */
  });
}

/** 设置页手动全量同步 | Full read-model sync (settings only) */
async function forceFullRemoteSync() {
  if (typeof isRemoteDB !== "function" || !isRemoteDB()) {
    if (typeof showToast === "function")
      showToast("当前为本地模式，无需云端同步");
    return;
  }
  if (!confirm("将重新从云端拉取全部数据，可能需要十几秒。继续？")) return;
  setRemoteSyncStatus("loading");
  try {
    await syncRemoteReadModel({ force: true });
    if (typeof renderAll === "function") {
      await renderAll({ skipSync: true });
    }
    refreshActiveViewsAfterSync();
    if (typeof showToast === "function") showToast("云端数据已同步");
  } catch (e) {
    if (typeof showToast === "function") {
      showToast("同步失败：" + (e.message || "未知错误"));
    }
    throw e;
  }
}

(function registerDefaultViewRefreshers() {
  registerViewRefresh("domain:events", function () {
    if (
      document.getElementById("view-info")?.classList.contains("active") &&
      typeof infoCurrentTab !== "undefined" &&
      infoCurrentTab === "events" &&
      typeof renderEventList === "function"
    ) {
      renderEventList();
    }
  });
})();
