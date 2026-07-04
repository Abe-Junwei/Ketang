/* 云端同步协调 | Remote sync coordinator (Phase 12.2–12.5) */

var BOARD_POLL_INTERVAL_MS = 3000;
var BOARD_POLL_IDLE_INTERVAL_MS = 20000;
var _remoteDbSyncQueue = Promise.resolve();

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
  lodgers: "lodgers",
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
    module: "lodgers_active",
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
      if (typeof forecastLoadTab === "function") forecastLoadTab(tab);
      else if (typeof renderForecastTab === "function") renderForecastTab(tab);
    },
  },
  history: {
    refresh: function () {
      if (typeof historyLoadAndRender === "function") historyLoadAndRender();
      else if (typeof renderHistory === "function") renderHistory();
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
  if (typeof lastBoardVersion === "undefined") return null;
  return parseBoardVersion(lastBoardVersion);
}

function setLocalBoardVersion(version) {
  if (typeof lastBoardVersion === "undefined") return;
  lastBoardVersion = parseBoardVersion(version);
}

/** 串行化本地读模型写入，避免并发灌库互相覆盖 | Serialize local read-model writes */
function withRemoteDbSync(fn) {
  var next = _remoteDbSyncQueue.then(function () {
    return fn();
  });
  _remoteDbSyncQueue = next.catch(function () {});
  return next;
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
  var keys = resolveScopedModuleKeys(options);
  return keys.length ? keys[0] : null;
}

/** 写后同步：视图/infoTab 对应的全部读模块 | All read modules for active scope */
function resolveScopedModuleKeys(options) {
  options = options || {};
  if (options.infoTab && typeof rcModulesForInfoTab === "function") {
    var infoMods = rcModulesForInfoTab(options.infoTab);
    if (infoMods.length) return infoMods.slice();
  }
  if (options.useActiveViewModule) {
    var active = getActiveViewId();
    if (active === "info" && typeof infoCurrentTab !== "undefined") {
      if (typeof rcModulesForInfoTab === "function") {
        var tabMods = rcModulesForInfoTab(infoCurrentTab);
        if (tabMods.length) return tabMods.slice();
      }
      if (INFO_TAB_MODULES[infoCurrentTab]) {
        return [INFO_TAB_MODULES[infoCurrentTab]];
      }
    }
    if (active && VIEW_SYNC_SCOPES[active] && VIEW_SYNC_SCOPES[active].module) {
      return [VIEW_SYNC_SCOPES[active].module];
    }
  }
  var scope = options.scope;
  if (scope && VIEW_SYNC_SCOPES[scope] && VIEW_SYNC_SCOPES[scope].module) {
    return [VIEW_SYNC_SCOPES[scope].module];
  }
  if (options.infoTab && INFO_TAB_MODULES[options.infoTab]) {
    return [INFO_TAB_MODULES[options.infoTab]];
  }
  return [];
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
  if (active === "lodgers") return "lodgers_active";
  if (
    active === "board" ||
    active === "lodging" ||
    active === "housekeeping" ||
    active === "stay"
  ) {
    return "board";
  }
  if (active === "info" && typeof infoCurrentTab !== "undefined") {
    return INFO_TAB_MODULES[infoCurrentTab] === "lodgers"
      ? "lodgers"
      : null;
  }
  return "lodgers";
}

function domainsToModules(domains, options) {
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
      return k !== "lodgers_active" && k !== "lodgers_records" && k !== "lodgers";
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
      return k !== "lodgers_active" && k !== "lodgers_records" && k !== "lodgers" && k !== "settings";
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

async function fetchAndApplyModule(moduleKey, options) {
  options = options || {};
  var skipSql =
    options.skipSqlHydrate ||
    (typeof shouldSkipSqlDeltaHydrate === "function" &&
      shouldSkipSqlDeltaHydrate()) ||
    (typeof rcReadReady === "function" && rcReadReady());
  var payload = await apiReadModule(moduleKey, getLocalBoardVersion());
  if (payload && payload.notModified) {
    if (payload.board_version != null)
      setLocalBoardVersion(payload.board_version);
    return { module: moduleKey, skipped: true };
  }
  if (typeof rcStorePayload === "function") {
    rcStorePayload(moduleKey, payload);
  }
  if (skipSql) {
    if (payload && payload.board_version != null) {
      setLocalBoardVersion(payload.board_version);
    }
    return { module: moduleKey, skipped: false };
  }
  return withRemoteDbSync(function () {
    if (payload && payload.tables) {
      applyModuleTables(payload.tables, {
        upsertOnly: !!(options && options.upsertOnly),
      });
    }
    if (payload && payload.board_version != null) {
      setLocalBoardVersion(payload.board_version);
    }
    return { module: moduleKey, skipped: false };
  });
}

async function syncRemoteByModules(modules, domains, options) {
  options = options || {};
  if (!modules || !modules.length) return false;
  if (!options.quiet) setRemoteSyncStatus("loading");
  try {
    await Promise.all(
      modules.map(function (moduleKey) {
        return fetchAndApplyModule(moduleKey, options);
      }),
    );
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
  options = options || {};
  var modules = domainsToModules(domains, options);
  if (!modules.length) return false;
  return syncRemoteByModules(modules, domains, options);
}

async function syncRemoteDeltaSince(sinceVersion, options) {
  options = options || {};
  var since = parseBoardVersion(sinceVersion);
  if (since == null) return false;
  if (!options.quiet) setRemoteSyncStatus("loading");
  if (typeof ketangPerfMark === "function") ketangPerfMark("delta:start");
  if (typeof ketangPerfInc === "function") ketangPerfInc("delta_count");
  try {
    var delta = await apiSyncDelta(since, since);
    if (delta && delta.not_modified) {
      if (typeof ketangPerfInc === "function")
        ketangPerfInc("delta_not_modified_count");
      if (delta.board_version != null)
        setLocalBoardVersion(delta.board_version);
      setRemoteSyncStatus("ready");
      return true;
    }
    if (delta && delta.full_sync_required) {
      if (typeof ketangPerfInc === "function")
        ketangPerfInc("delta_full_sync_count");
      await syncRemoteReadModel({ force: true });
      return true;
    }
    if (typeof ketangPerfInc === "function") ketangPerfInc("delta_apply_count");
    if (typeof rcApplyDeltaPatches === "function" && delta) {
      if (delta.patch_mode && delta.patches) {
        rcApplyDeltaPatches(delta.patches, delta.deletions);
      } else if (delta.modules) {
        rcApplyDeltaModules(delta.modules);
      }
    }
    var skipSql =
      typeof shouldSkipSqlDeltaHydrate === "function" &&
      shouldSkipSqlDeltaHydrate();
    if (!skipSql) {
      await withRemoteDbSync(function () {
        if (typeof applyRemoteDelta === "function") {
          applyRemoteDelta(delta, { skipRcPatch: true });
        }
      });
    } else if (delta && delta.board_version != null) {
      setLocalBoardVersion(delta.board_version);
      remoteReadModelReady = true;
      lastRemoteSyncAt = Date.now();
      setRemoteSyncStatus("ready");
    }
    if (!options.skipNotify) {
      notifyViewsForDomains(delta.domains || []);
    }
    return true;
  } catch (e) {
    setRemoteSyncStatus("error", e.message || "数据同步失败");
    throw e;
  } finally {
    if (typeof ketangPerfMark === "function") {
      ketangPerfMark("delta:end");
      ketangPerfMeasure("delta", "delta:start", "delta:end");
    }
  }
}

/** 写操作后按需同步 | Sync after write */
async function syncAfterRemoteWrite(writeResult, options) {
  if (typeof isRemoteDB !== "function" || !isRemoteDB()) return;
  if (typeof isLoggedIn === "function" && !isLoggedIn()) return;

  options = options || {};
  var scopedModules = resolveScopedModuleKeys(
    Object.assign({ useActiveViewModule: true }, options),
  );

  var writeVersion = parseBoardVersion(
    writeResult && writeResult.board_version,
  );
  var localVersion = getLocalBoardVersion();
  var quiet = options.quietSync !== false;
  var syncOpts = { quiet: quiet, skipNotify: true, skipSqlHydrate: true };

  if (
    writeVersion != null &&
    localVersion != null &&
    writeVersion === localVersion &&
    !scopedModules.length
  ) {
    notifyViewsForDomains(writeResult && writeResult.changed_domains);
    return;
  }

  if (!remoteReadModelReady || localVersion == null) {
    await syncRemoteReadModel({ force: true });
    notifyViewsForDomains(writeResult && writeResult.changed_domains);
    return;
  }

  if (options.skipModuleSync) {
    if (
      writeResult &&
      (writeResult.patches || writeResult.deletions) &&
      writeVersion != null &&
      localVersion != null &&
      writeVersion === localVersion
    ) {
      notifyViewsForDomains(writeResult.changed_domains);
      return;
    }
    if (
      writeVersion != null &&
      localVersion != null &&
      writeVersion > localVersion &&
      remoteReadModelReady
    ) {
      try {
        await syncRemoteDeltaSince(localVersion, syncOpts);
      } catch (e) {
        console.warn("write delta sync skipped:", e.message || e);
      }
    }
    if (!options.skipViewRefresh) {
      refreshViewForScope(getActiveViewId(), options);
    }
    return;
  }

  var domains =
    writeResult && Array.isArray(writeResult.changed_domains)
      ? writeResult.changed_domains
      : null;

  if (
    writeVersion != null &&
    localVersion != null &&
    writeVersion > localVersion &&
    remoteReadModelReady
  ) {
    try {
      await syncRemoteDeltaSince(localVersion, syncOpts);
      notifyViewsForDomains(domains);
      if (!options.skipViewRefresh) {
        refreshViewForScope(getActiveViewId(), options);
      }
      return;
    } catch (e) {
      console.warn(
        "write delta sync failed, fallback modules:",
        e.message || e,
      );
    }
  }

  var modules = dedupeReadModules(
    scopedModules.concat(writeResultToModules(writeResult, options)),
  );

  if (scopedModules.length) {
    if (!modules.length) modules = scopedModules.slice();
    if (!quiet) setRemoteSyncStatus("loading");
    try {
      await syncRemoteByModules(modules, domains, syncOpts);
      if (!options.skipViewRefresh) {
        refreshViewForScope(getActiveViewId(), options);
      }
    } catch (e) {
      setRemoteSyncStatus("error", e.message || "数据同步失败");
      throw e;
    }
    return;
  }

  modules = writeResultToModules(writeResult, options);
  if (modules.length) {
    await syncRemoteByModules(modules, domains, syncOpts);
    return;
  }

  if (domains && domains.length) {
    await syncRemoteByDomains(domains, options);
    return;
  }

  if (writeVersion != null && writeVersion > localVersion) {
    await syncRemoteDeltaSince(localVersion, syncOpts);
    return;
  }

  var board = await apiBoardVersion();
  var remoteVersion = parseBoardVersion(board.version);
  if (remoteVersion != null && remoteVersion === localVersion) {
    return;
  }
  await syncRemoteDeltaSince(localVersion, syncOpts);
}

/** 轮询/SSE 触发的增量同步 | Background incremental sync */
async function syncRemoteIfStale(options) {
  options = options || {};
  var pushSource = options.pushSource || null;
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
  // Push latency: version change detected → delta applied + view refresh
  if (pushSource && typeof ketangPerfMark === "function") {
    ketangPerfMark("push:start");
  }
  try {
    await syncRemoteDeltaSince(localVersion);
    refreshViewForScope(getActiveViewId());
  } finally {
    if (pushSource && typeof ketangPerfMark === "function") {
      ketangPerfMark("push:end");
      ketangPerfMeasure("push", "push:start", "push:end");
      if (typeof ketangPerfInc === "function") {
        ketangPerfInc("push_count");
        if (pushSource === "sse") ketangPerfInc("push_sse_count");
        if (pushSource === "poll") ketangPerfInc("push_poll_count");
      }
    }
  }
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
      syncRemoteIfStale({ pushSource: "sse" }).catch(function () {
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
  syncRemoteIfStale({ pushSource: "poll" }).catch(function () {
    /* non-fatal */
  });
}

/** 设置页手动全量同步 | Full read-model sync (settings only) */
async function forceFullRemoteSync() {
  if (typeof isRemoteDB !== "function" || !isRemoteDB()) {
    if (typeof showToast === "function") showToast("当前环境未启用云端读模型");
    return;
  }
  if (!confirm("将重新从云端拉取全部数据，可能需要十几秒。继续？")) return;
  setRemoteSyncStatus("loading");
  try {
    await rcEnsureAppData(true, { hydrateSql: isLocalForceDb() });
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
  registerViewRefresh("domain:reservations", function () {
    if (
      document.getElementById("view-stay")?.classList.contains("active") &&
      typeof _pendingStayMode !== "undefined" &&
      _pendingStayMode === "reservation" &&
      typeof renderReservations === "function"
    ) {
      renderReservations("全部");
    }
  });
  registerViewRefresh("module:reservations", function () {
    if (
      document.getElementById("view-stay")?.classList.contains("active") &&
      typeof _pendingStayMode !== "undefined" &&
      _pendingStayMode === "reservation" &&
      typeof renderReservations === "function"
    ) {
      renderReservations("全部");
    }
  });
})();
