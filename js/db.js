let SQL, db;
const DB_NAME = "ketang";
const STORE_NAME = "db";
const KEY = "main";
const REMOTE_SESSION_KEY = "ketang_remote_session_token";
const LEGACY_ACCESS_TOKEN_KEY = "ketang_access_token";
const REFRESH_BLOCK_KEY = "ketang_block_refresh";
const SQL_JS_URL = "./lib/sql-wasm.js?v=2";
const SQL_WASM_URL = "./lib/sql-wasm.wasm";
let _localSqlLoadPromise = null;
const REMOTE_DB_ENABLED = (() => {
  if (typeof window === "undefined" || !window.location) return false;
  if (window.KETANG_FORCE_LOCAL_DB === true) return false;
  // KETANG_REMOTE_DB=false 时 REMOTE_DB_ENABLED 为 false，走本地 sql 路径（同 force_local_db 语义）
  if (window.KETANG_REMOTE_DB === false) return false;
  // 在线-only：除 CI 强制本地库外一律走云端 API + 读模型
  return true;
})();

/** file:// 便携打开已废弃 | Portable file:// open is deprecated */
function isDeprecatedFileOpen() {
  return (
    typeof window !== "undefined" &&
    window.location &&
    window.location.protocol === "file:" &&
    window.KETANG_FORCE_LOCAL_DB !== true
  );
}

let remoteLastInsertId = 0;
let remoteLocalSchemaReady = false;
let remoteReadModelReady = false;
let remoteSyncStatus = "idle";
let remoteSyncError = "";
let _remoteHydrating = false;
let remoteSyncPromise = null;
let lastRemoteSyncAt = 0;

const REMOTE_SNAPSHOT_INSERT_ORDER = [
  "users",
  "rooms",
  "beds",
  "guests",
  "events",
  "rooming_plans",
  "rooming_assignments",
  "rooming_checkin_queue",
  "rooming_adjustments",
  "lodgers",
  "reservations",
  "meals",
  "payments",
  "housekeeping",
  "schema_version",
  "app_meta",
];

const REMOTE_SNAPSHOT_TABLE_RE = /^[a-z_][a-z0-9_]*$/i;

function isRemoteDB() {
  return REMOTE_DB_ENABLED;
}

function purgeLegacyClientTokens() {
  try {
    localStorage.removeItem(REMOTE_SESSION_KEY);
    sessionStorage.removeItem(LEGACY_ACCESS_TOKEN_KEY);
  } catch (e) {
    /* ignore */
  }
}

function isRemoteRefreshBlocked() {
  try {
    return sessionStorage.getItem(REFRESH_BLOCK_KEY) === "1";
  } catch (e) {
    return false;
  }
}

function setRemoteRefreshBlocked(blocked) {
  try {
    if (blocked) sessionStorage.setItem(REFRESH_BLOCK_KEY, "1");
    else sessionStorage.removeItem(REFRESH_BLOCK_KEY);
  } catch (e) {
    /* ignore */
  }
}

function setRemoteSyncStatus(status, message) {
  remoteSyncStatus = status || "idle";
  remoteSyncError = message || "";
  updateRemoteSyncBanner();
}

function updateRemoteSyncBanner() {
  const el = document.getElementById("remote-sync-banner");
  if (!el) return;
  const loggedIn = typeof isLoggedIn === "function" ? isLoggedIn() : false;
  if (!isRemoteDB() || !loggedIn) {
    el.hidden = true;
    return;
  }
  // 常规同步静默进行，仅错误时提示 | Keep normal sync silent; only surface explicit errors.
  if (remoteSyncStatus === "error") {
    el.hidden = false;
    el.className = "remote-sync-banner remote-sync-banner-error";
    el.textContent = remoteSyncError || "数据同步失败，请刷新页面或重新登录";
    return;
  }
  el.hidden = true;
}

function isRemoteDataUnavailable() {
  return (
    isRemoteDB() &&
    !remoteReadModelReady &&
    !_remoteHydrating &&
    remoteSyncStatus !== "loading"
  );
}

function refreshAfterWrite(writeResult, options) {
  if (
    typeof renderAll !== "function" &&
    typeof refreshViewForScope !== "function"
  ) {
    return;
  }
  options = options || {};
  if (
    isRemoteDB() &&
    typeof rcReadReady === "function" &&
    rcReadReady() &&
    options.awaitSync !== true
  ) {
    options = Object.assign({ quietSync: true }, options);
  }
  const task = (async function () {
    if (isRemoteDB()) {
      if (options && options.deferSyncRender) {
        if (!(options && options.skipViewRefresh)) {
          if (options && options.fullRefresh) {
            renderAll({ skipSync: true });
          } else if (typeof refreshViewForScope === "function") {
            refreshViewForScope((options && options.scope) || null, options);
          }
        }
        var deferOpts = Object.assign({}, options, { skipViewRefresh: true });
        var bgSync =
          typeof syncAfterRemoteWrite === "function"
            ? syncAfterRemoteWrite(writeResult, deferOpts)
            : syncRemoteReadModel({ force: true });
        if (bgSync && typeof bgSync.then === "function") {
          bgSync
            .then(function () {
              if (options && options.fullRefresh) {
                return renderAll({ skipSync: true });
              }
              if (
                !(options && options.skipViewRefresh) &&
                typeof refreshViewForScope === "function"
              ) {
                refreshViewForScope(
                  (options && options.scope) || null,
                  options,
                );
              }
            })
            .catch(function (e) {
              if (typeof showToast === "function") {
                showToast("后台同步失败：" + (e.message || "未知错误"));
              }
            });
        }
        return bgSync;
      }
      if (typeof syncAfterRemoteWrite === "function") {
        await syncAfterRemoteWrite(writeResult, options);
      } else {
        await syncRemoteReadModel({ force: true });
      }
      if (options && options.fullRefresh) {
        await renderAll({ skipSync: true });
        return;
      }
      if (typeof refreshViewForScope === "function") {
        refreshViewForScope((options && options.scope) || null, options);
      } else if (
        options &&
        options.infoOnly &&
        typeof renderInfo === "function"
      ) {
        renderInfo(
          options.infoTab ||
            (typeof infoCurrentTab !== "undefined" ? infoCurrentTab : "rooms"),
        );
      } else {
        await renderAll({ skipSync: true });
      }
      return;
    }
    if (options && options.fullRefresh) {
      await renderAll({ skipSync: true });
      return;
    }
    if (typeof refreshViewForScope === "function") {
      refreshViewForScope((options && options.scope) || null, options);
      return;
    }
    await renderAll({ skipSync: true });
  })();
  if (task && typeof task.catch === "function") {
    task.catch(function (e) {
      if (typeof showToast === "function") {
        showToast("刷新失败：" + (e.message || "未知错误"));
      }
    });
  }
  return task;
}

function remoteLogout() {
  /* access/refresh 由服务端 HttpOnly Cookie 管理 | Cookies cleared via apiAuthLogout */
}

/** 本地/灾备模式才需加载 sql.js | Local-only paths need sql.js */
function needsLocalSqlEngine() {
  if (typeof useLocalDbPath === "function") return useLocalDbPath();
  return typeof isRemoteDB === "function" && !isRemoteDB();
}

function isLocalSqlEngineLoaded() {
  return typeof initSqlJs === "function" && !!SQL;
}

function shouldSkipSqlDeltaHydrate() {
  if (typeof rcReadReady === "function" && rcReadReady()) return true;
  return (
    typeof isRemoteDB === "function" &&
    isRemoteDB() &&
    !(typeof window !== "undefined" && window.KETANG_FORCE_LOCAL_DB === true) &&
    !isLocalSqlEngineLoaded()
  );
}

function inferOnlineQueryCaller() {
  try {
    var stack = new Error().stack || "";
    var line = stack.split("\n")[2] || "";
    var m = line.match(/(?:at\s+\w+\s+\()?([^:)]+:\d+)/);
    return m ? m[1].replace(/^.*\/js\//, "js/") : "unknown";
  } catch (e) {
    return "unknown";
  }
}

async function loadSqlJsScript() {
  if (typeof initSqlJs === "function") return;
  if (window.__ketangSqlJsLoading) {
    await window.__ketangSqlJsLoading;
    return;
  }
  window.__ketangSqlJsLoading = new Promise(function (resolve, reject) {
    var script = document.createElement("script");
    script.src = SQL_JS_URL;
    script.onload = function () {
      resolve();
    };
    script.onerror = function () {
      reject(new Error("无法加载 " + SQL_JS_URL));
    };
    document.head.appendChild(script);
  });
  await window.__ketangSqlJsLoading;
}

async function ensureLocalSqlite() {
  if (SQL) return;
  if (_localSqlLoadPromise) return _localSqlLoadPromise;
  _localSqlLoadPromise = (async function () {
    await loadSqlJsScript();
    await initSqlite();
  })();
  return _localSqlLoadPromise;
}

async function initSqlite() {
  if (SQL) return;
  if (typeof initSqlJs !== "function") {
    throw new Error("sql.js 未加载，请先调用 ensureLocalSqlite()");
  }
  const wasmPath = SQL_WASM_URL;
  const response = await fetch(wasmPath);
  if (!response.ok) {
    throw new Error(
      `无法加载 SQLite 引擎 (${wasmPath})，HTTP 状态：${response.status}。请确认 lib/sql-wasm.wasm 文件存在且服务从项目根目录启动。`,
    );
  }
  const wasmBinary = await response.arrayBuffer();
  SQL = await initSqlJs({ wasmBinary });
}

// IndexedDB 操作

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const idb = e.target.result;
      if (!idb.objectStoreNames.contains(STORE_NAME)) {
        idb.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

function initLocalSchemaAndMigrations() {
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
  migrateV15toV16();
  migrateV16toV17();
  migrateV17toV18();
  migrateV18toV19();
  migrateV19toV20();
  migrateV20toV21();
  migrateV21toV22();
  createIndexes();
}

function ensureRemoteLocalSchema() {
  if (remoteLocalSchemaReady && db && typeof db.prepare === "function") return;
  if (!SQL) throw new Error("SQLite 引擎未加载");
  db = new SQL.Database();
  initLocalSchemaAndMigrations();
  remoteLocalSchemaReady = true;
}

function normalizeSnapshotRow(table, row) {
  const data = { ...(row || {}) };
  // 读模型永不下发 password；占位以满足 NOT NULL | Read-model never ships password
  if (
    table === "users" &&
    (data.password === undefined ||
      data.password === null ||
      data.password === "")
  ) {
    data.password = "remote_sync_placeholder";
  }
  return data;
}

function snapshotRowExists(table, rowId) {
  if (rowId == null || !REMOTE_SNAPSHOT_TABLE_RE.test(table)) return false;
  return !!query("SELECT id FROM " + table + " WHERE id = ?", [rowId])[0];
}

function insertSnapshotRow(table, row, options) {
  const data = normalizeSnapshotRow(table, row);
  const columns = Object.keys(data);
  if (!columns.length) return;
  const placeholders = columns.map(() => "?").join(", ");
  const sql = `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`;
  const values = columns.map((col) => {
    const value = data[col];
    return value === undefined ? null : value;
  });
  run(sql, values);
}

/** 模块 upsert：UPDATE/INSERT，避免 REPLACE 触发 FK 级联 | Module upsert without REPLACE */
function upsertSnapshotRow(table, row) {
  const data = normalizeSnapshotRow(table, row);
  const rowId = data.id;
  if (rowId == null) {
    insertSnapshotRow(table, row);
    return;
  }
  if (snapshotRowExists(table, rowId)) {
    const columns = Object.keys(data).filter(function (col) {
      return col !== "id";
    });
    if (!columns.length) return;
    const sets = columns
      .map(function (col) {
        return col + " = ?";
      })
      .join(", ");
    const values = columns.map(function (col) {
      return data[col] === undefined ? null : data[col];
    });
    values.push(rowId);
    run("UPDATE " + table + " SET " + sets + " WHERE id = ?", values);
    return;
  }
  insertSnapshotRow(table, row);
}

function applyRemoteSnapshot(payload) {
  if (!payload || !payload.tables) throw new Error("读模型数据无效");
  if (!SQL) throw new Error("SQLite 引擎未加载");
  const prevDb = db;
  const wasReady = remoteReadModelReady;
  const nextDb = new SQL.Database();
  db = nextDb;
  remoteLocalSchemaReady = false;
  _remoteHydrating = true;
  try {
    initLocalSchemaAndMigrations();
    REMOTE_SNAPSHOT_INSERT_ORDER.forEach(function (table) {
      if (!REMOTE_SNAPSHOT_TABLE_RE.test(table)) return;
      try {
        db.run(`DELETE FROM ${table}`);
      } catch (e) {
        /* 表可能不存在 | table may be missing */
      }
    });
    REMOTE_SNAPSHOT_INSERT_ORDER.forEach(function (table) {
      if (!REMOTE_SNAPSHOT_TABLE_RE.test(table)) return;
      const rows = payload.tables[table];
      if (!Array.isArray(rows) || !rows.length) return;
      rows.forEach(function (row) {
        insertSnapshotRow(table, row);
      });
    });
    remoteReadModelReady = true;
    lastRemoteSyncAt = Date.now();
    if (typeof lastBoardVersion !== "undefined") {
      lastBoardVersion = payload.version != null ? payload.version : null;
    }
    if (payload.permissions && typeof setSessionPermissions === "function") {
      setSessionPermissions(payload.permissions);
      if (typeof applyPermissions === "function") applyPermissions();
    }
    setRemoteSyncStatus("ready");
    if (prevDb && prevDb !== nextDb && typeof prevDb.close === "function") {
      try {
        prevDb.close();
      } catch (e) {
        /* ignore */
      }
    }
  } catch (err) {
    remoteReadModelReady = wasReady;
    if (prevDb && prevDb !== nextDb) {
      db = prevDb;
      remoteLocalSchemaReady = true;
      try {
        nextDb.close();
      } catch (e) {
        /* ignore */
      }
    }
    throw err;
  } finally {
    _remoteHydrating = false;
  }
}

/** 模块表局部灌库 | Patch sql.js tables from read-module payload */
function applyModuleTables(tables, options) {
  if (!tables || typeof tables !== "object") return;
  ensureRemoteLocalSchema();
  _remoteHydrating = true;
  try {
    applyModuleTablesInner(tables, options);
  } finally {
    _remoteHydrating = false;
  }
}

/** 远程模式乐观本地补丁 | Optimistic local patch during remote write (main thread) */
function applyRemoteLocalPatch(patchFn) {
  if (typeof patchFn !== "function") return;
  if (!isRemoteDB()) {
    patchFn();
    return;
  }
  ensureRemoteLocalSchema();
  _remoteHydrating = true;
  try {
    patchFn();
  } finally {
    _remoteHydrating = false;
  }
}

function touchBoardVersionFromWrite(writeResult) {
  if (writeResult && writeResult.board_version != null) {
    if (typeof setLocalBoardVersion === "function") {
      setLocalBoardVersion(writeResult.board_version);
    } else if (typeof lastBoardVersion !== "undefined") {
      var parsed =
        typeof parseBoardVersion === "function"
          ? parseBoardVersion(writeResult.board_version)
          : writeResult.board_version;
      lastBoardVersion = parsed;
    }
  }
}

function applyModuleTablesInner(tables, options) {
  const upsertOnly = !!(options && options.upsertOnly);
  Object.keys(tables).forEach(function (table) {
    if (!REMOTE_SNAPSHOT_TABLE_RE.test(table)) return;
    const rows = tables[table];
    if (!Array.isArray(rows)) return;
    if (table === "app_meta") {
      rows.forEach(function (row) {
        if (!row || row.key == null) return;
        run("INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)", [
          row.key,
          row.value,
        ]);
      });
      return;
    }
    if (!upsertOnly) {
      try {
        db.run(`DELETE FROM ${table}`);
      } catch (e) {
        /* ignore */
      }
    }
    rows.forEach(function (row) {
      if (upsertOnly) {
        upsertSnapshotRow(table, row);
      } else {
        insertSnapshotRow(table, row);
      }
    });
  });
}

/** 增量同步灌库 | Apply delta sync payload into sql.js */
function applyRemoteDelta(delta, options) {
  if (!delta || typeof delta !== "object") {
    console.warn("applyRemoteDelta: invalid payload", delta);
    return false;
  }
  options = options || {};
  if (!options.skipRcPatch && typeof rcApplyDeltaPatches === "function") {
    if (delta.patch_mode && delta.patches) {
      rcApplyDeltaPatches(delta.patches, delta.deletions);
    } else if (delta.modules && typeof rcApplyDeltaModules === "function") {
      rcApplyDeltaModules(delta.modules);
    }
  }
  var skipSql = shouldSkipSqlDeltaHydrate();
  if (skipSql) {
    if (
      delta.board_version != null &&
      typeof lastBoardVersion !== "undefined"
    ) {
      lastBoardVersion = delta.board_version;
    }
    remoteReadModelReady = true;
    lastRemoteSyncAt = Date.now();
    setRemoteSyncStatus("ready");
    return true;
  }
  ensureRemoteLocalSchema();
  _remoteHydrating = true;
  try {
    if (delta.patch_mode && delta.patches) {
      applyModuleTablesInner(delta.patches, { upsertOnly: true });
    } else {
      const modules = delta.modules || {};
      Object.keys(modules).forEach(function (key) {
        const mod = modules[key];
        if (mod && mod.tables) applyModuleTablesInner(mod.tables);
      });
    }
    const deletions = delta.deletions || [];
    deletions.forEach(function (item) {
      const table = item.table_name;
      const rowId = item.row_id;
      if (!table || !rowId || !REMOTE_SNAPSHOT_TABLE_RE.test(table)) return;
      run(`DELETE FROM ${table} WHERE id = ?`, [rowId]);
    });
    if (
      delta.board_version != null &&
      typeof lastBoardVersion !== "undefined"
    ) {
      lastBoardVersion = delta.board_version;
    }
    remoteReadModelReady = true;
    lastRemoteSyncAt = Date.now();
    setRemoteSyncStatus("ready");
    return true;
  } finally {
    _remoteHydrating = false;
  }
}

async function resetRemoteReadModelState() {
  if (!isRemoteDB()) return;
  remoteReadModelReady = false;
  remoteLocalSchemaReady = false;
  remoteSyncPromise = null;
  lastRemoteSyncAt = 0;
  setRemoteSyncStatus("idle");
  if (db && typeof db.close === "function") {
    try {
      db.close();
    } catch (e) {
      /* ignore */
    }
  }
  db = null;
}

let remoteDeferredPromise = null;

async function syncRemoteReadModel(options) {
  if (!isRemoteDB()) return;
  if (typeof isLoggedIn === "function" && !isLoggedIn()) return;
  const bootstrapOnly = !!(options && options.bootstrapOnly);
  const deferredOnly = !!(options && options.deferredOnly);
  const force = !!(options && options.force);
  if (deferredOnly) {
    if (remoteDeferredPromise) return remoteDeferredPromise;
    remoteDeferredPromise = (async function () {
      try {
        if (typeof rcEnsureAppData !== "function") {
          throw new Error("read-cache 未加载");
        }
        setRemoteSyncStatus("loading");
        await rcEnsureAppData(force, {
          deferredOnly: true,
          hydrateSql: typeof useLocalDbPath === "function" && useLocalDbPath(),
        });
        setRemoteSyncStatus("ready");
      } catch (err) {
        setRemoteSyncStatus("error", err.message || "数据同步失败");
        throw err;
      } finally {
        remoteDeferredPromise = null;
      }
    })();
    return remoteDeferredPromise;
  }
  if (remoteSyncPromise) return remoteSyncPromise;
  if (
    !force &&
    !bootstrapOnly &&
    remoteReadModelReady &&
    Date.now() - lastRemoteSyncAt < (options?.minIntervalMs || 800)
  ) {
    return;
  }
  remoteSyncPromise = (async function () {
    setRemoteSyncStatus("loading");
    try {
      if (typeof rcEnsureAppData !== "function") {
        throw new Error("read-cache 未加载");
      }
      await rcEnsureAppData(force, {
        bootstrapOnly: bootstrapOnly,
        hydrateSql: typeof useLocalDbPath === "function" && useLocalDbPath(),
      });
      if (!bootstrapOnly) setRemoteSyncStatus("ready");
      else setRemoteSyncStatus("idle");
    } catch (err) {
      setRemoteSyncStatus("error", err.message || "数据同步失败");
      throw err;
    } finally {
      remoteSyncPromise = null;
    }
  })();
  return remoteSyncPromise;
}

async function loadDB() {
  if (isRemoteDB()) {
    remoteReadModelReady = false;
    setRemoteSyncStatus("idle");
    return;
  }
  let idb;
  try {
    idb = await Promise.race([
      openIDB(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("IndexedDB 打开超时")), 3000),
      ),
    ]);
  } catch (e) {
    console.warn("IndexedDB 不可用，使用内存数据库（数据不会持久化）：", e);
    db = new SQL.Database();
    // 显示持久化警告 | Show persistence warning
    showToast("⚠️ 浏览器存储不可用，本次数据不会保存！请检查浏览器设置。");
    return;
  }
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(KEY);
    getReq.onsuccess = (e) => {
      const record = e.target.result;
      if (record && record.data) {
        db = new SQL.Database(new Uint8Array(record.data));
      } else {
        db = new SQL.Database();
      }
      resolve();
    };
    getReq.onerror = (e) => {
      console.warn("读取 IndexedDB 失败，使用内存数据库：", e.target.error);
      db = new SQL.Database();
      showToast("⚠️ 读取存储失败，本次数据不会保存！");
      resolve();
    };
  });
}

// 写入锁，防止并发 saveDB 导致数据竞争 | Write lock to prevent concurrent saveDB race
let saveLock = Promise.resolve();

async function saveDB() {
  if (isRemoteDB()) return;
  // 串行化所有写入操作 | Serialize all write operations
  const prev = saveLock;
  let release;
  saveLock = new Promise((resolve) => {
    release = resolve;
  });
  await prev;
  try {
    const data = db.export();
    const idb = await openIDB();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const putReq = store.put({ id: KEY, data: Array.from(data) });
      putReq.onsuccess = () => resolve();
      putReq.onerror = (e) => reject(e.target.error);
    });
  } catch (e) {
    console.error("保存数据失败：", e);
    await uiAlert(
      "保存数据失败：" +
        e.message +
        "\n请立即导出 ketang.db 备份，避免数据丢失！",
    );
    throw e;
  } finally {
    release();
  }
}

// 业务事务包装 | Business transaction wrapper
let inTransaction = false;
async function withTransaction(fn) {
  if (isRemoteDB()) {
    // 云端兼容模式：D1 每条写入独立提交；关键唯一约束由数据库兜底。
    // Remote compatibility mode: D1 commits each write; critical uniqueness is enforced by DB constraints.
    return await fn();
  }
  if (inTransaction) {
    return await fn();
  }
  inTransaction = true;
  db.run("BEGIN TRANSACTION;");
  try {
    const result = await fn();
    db.run("COMMIT;");
    return result;
  } catch (e) {
    try {
      db.run("ROLLBACK;");
    } catch (rollbackErr) {
      /* ignore */
    }
    throw e;
  } finally {
    inTransaction = false;
  }
}

function initSchema() {
  db.run(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      location TEXT,
      floor INTEGER DEFAULT 1,
      dorm_type TEXT DEFAULT '不限' CHECK(dorm_type IN ('男寮','女寮','不限')),
      room_type TEXT DEFAULT '学员房',
      suitable_elder INTEGER DEFAULT 0 CHECK(suitable_elder IN (0,1)),
      suitable_child INTEGER DEFAULT 0 CHECK(suitable_child IN (0,1)),
      near_zen_hall INTEGER DEFAULT 0 CHECK(near_zen_hall IN (0,1)),
      flexible_use INTEGER DEFAULT 0 CHECK(flexible_use IN (0,1)),
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS beds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      bed_number TEXT NOT NULL,
      status TEXT DEFAULT '可用' CHECK(status IN ('可用','占用','维修','备用')),
      bed_type TEXT DEFAULT '单床',
      suitable_elder INTEGER DEFAULT 0 CHECK(suitable_elder IN (0,1)),
      is_flexible INTEGER DEFAULT 0 CHECK(is_flexible IN (0,1)),
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS guests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      dharma_name TEXT,
      gender TEXT,
      phone TEXT,
      id_card TEXT,
      emergency_contact TEXT,
      emergency_phone TEXT,
      blacklist INTEGER DEFAULT 0,
      visit_count INTEGER DEFAULT 0,
      last_visit_date TEXT,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      event_type TEXT DEFAULT '禅营',
      gender_type TEXT DEFAULT '混合' CHECK(gender_type IN ('男众','女众','混合')),
      expected_count INTEGER DEFAULT 0,
      start_date TEXT,
      end_date TEXT,
      status TEXT DEFAULT '筹备中' CHECK(status IN ('筹备中','招生中','进行中','已结束','已取消')),
      notes TEXT,
      include_spare_beds INTEGER DEFAULT 0 CHECK(include_spare_beds IN (0,1)),
      activity_target TEXT,
      arrival_date TEXT,
      departure_date TEXT,
      confirmed_count INTEGER DEFAULT 0,
      actual_arrival_count INTEGER DEFAULT 0,
      expected_absent_count INTEGER DEFAULT 0,
      male_count INTEGER DEFAULT 0,
      female_count INTEGER DEFAULT 0,
      child_count INTEGER DEFAULT 0,
      elder_count INTEGER DEFAULT 0,
      teacher_count INTEGER DEFAULT 0,
      volunteer_count INTEGER DEFAULT 0,
      special_needs_count INTEGER DEFAULT 0,
      manager_name TEXT,
      manager_phone TEXT,
      backup_manager_name TEXT,
      needs_central_lodging INTEGER DEFAULT 0 CHECK(needs_central_lodging IN (0,1)),
      needs_quiet_zone INTEGER DEFAULT 0 CHECK(needs_quiet_zone IN (0,1)),
      needs_near_zen_hall INTEGER DEFAULT 0 CHECK(needs_near_zen_hall IN (0,1)),
      needs_teacher_room INTEGER DEFAULT 0 CHECK(needs_teacher_room IN (0,1)),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT,
      role TEXT NOT NULL CHECK(role IN ('admin','zhike','kitchen','housekeeping','viewer')),
      is_advanced INTEGER DEFAULT 0 CHECK(is_advanced IN (0,1)),
      permissions TEXT,
      password TEXT NOT NULL,
      is_active INTEGER DEFAULT 1 CHECK(is_active IN (0,1)),
      auth_version INTEGER DEFAULT 1,
      must_change_password INTEGER DEFAULT 0 CHECK(must_change_password IN (0,1)),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT OR IGNORE INTO users (username, display_name, role, password) VALUES ('admin', '管理员', 'admin', 'sha256$ketang_default_salt$8d62959035f9b60a02e709f9826f3f996d07a09a4f5091e2884642fa01adf8a3');
    INSERT OR IGNORE INTO users (username, display_name, role, password) VALUES ('zhike', '知客师', 'zhike', 'sha256$ketang_default_salt$fc286955fb12bec3fb16b4f2619f9b675337b1240537bc21d830b5f495121565');
    CREATE TABLE IF NOT EXISTS lodgers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guest_id INTEGER REFERENCES guests(id) ON DELETE SET NULL,
      event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      dharma_name TEXT,
      gender TEXT,
      phone TEXT,
      id_card TEXT,
      check_in_date TEXT,
      expected_check_out TEXT,
      actual_check_out TEXT,
      bed_id INTEGER REFERENCES beds(id) ON DELETE SET NULL,
      role TEXT,
      class_name TEXT,
      participant_identity TEXT,
      age_group TEXT,
      special_needs TEXT,
      status TEXT DEFAULT '在住' CHECK(status IN ('在住','已退','已取消','No-show')),
      source TEXT,
      notes TEXT,
      meal_default_breakfast INTEGER DEFAULT 1 CHECK(meal_default_breakfast IN (0,1)),
      meal_default_lunch INTEGER DEFAULT 1 CHECK(meal_default_lunch IN (0,1)),
      meal_default_dinner INTEGER DEFAULT 1 CHECK(meal_default_dinner IN (0,1)),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS meals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lodger_id INTEGER NOT NULL REFERENCES lodgers(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      breakfast INTEGER DEFAULT 0 CHECK(breakfast IN (0,1)),
      lunch INTEGER DEFAULT 0 CHECK(lunch IN (0,1)),
      dinner INTEGER DEFAULT 0 CHECK(dinner IN (0,1)),
      notes TEXT,
      UNIQUE(lodger_id, date)
    );
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lodger_id INTEGER REFERENCES lodgers(id) ON DELETE CASCADE,
      reservation_id INTEGER REFERENCES reservations(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN ('押金','房费','退款','其他')),
      amount REAL NOT NULL,
      method TEXT,
      remark TEXT,
      paid_at TEXT DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guest_id INTEGER REFERENCES guests(id) ON DELETE SET NULL,
      event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      dharma_name TEXT,
      gender TEXT,
      phone TEXT,
      id_card TEXT,
      role TEXT,
      class_name TEXT,
      participant_identity TEXT,
      age_group TEXT,
      special_needs TEXT,
      expected_check_in TEXT,
      expected_check_out TEXT,
      room_preference TEXT,
      source TEXT,
      status TEXT DEFAULT '预约' CHECK(status IN ('预约','已确认','已入住','已取消','No-show')),
      meal_breakfast INTEGER DEFAULT 1 CHECK(meal_breakfast IN (0,1)),
      meal_lunch INTEGER DEFAULT 1 CHECK(meal_lunch IN (0,1)),
      meal_dinner INTEGER DEFAULT 1 CHECK(meal_dinner IN (0,1)),
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS rooming_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
      name TEXT,
      status TEXT DEFAULT '未确认' CHECK(status IN ('未确认','待调整','已确认')),
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS rooming_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id INTEGER NOT NULL REFERENCES rooming_plans(id) ON DELETE CASCADE,
      member_kind TEXT NOT NULL CHECK(member_kind IN ('lodger','reservation','forecast')),
      member_ref_id INTEGER,
      member_name TEXT NOT NULL,
      member_gender TEXT,
      participant_identity TEXT,
      age_group TEXT,
      special_needs TEXT,
      bed_id INTEGER REFERENCES beds(id),
      item_status TEXT DEFAULT '未确认' CHECK(item_status IN ('未确认','待调整','已确认')),
      notes TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS housekeeping (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bed_id INTEGER NOT NULL REFERENCES beds(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK(status IN ('脏房','净房','查房','可用','占用','维修')),
      operator TEXT,
      changed_at TEXT DEFAULT CURRENT_TIMESTAMP,
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id INTEGER,
      detail TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    );
    -- 仅当表为空时才插入初始版本号 | Only insert initial version if table is empty
    INSERT INTO schema_version (version) SELECT 14 WHERE NOT EXISTS (SELECT 1 FROM schema_version);
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    INSERT OR IGNORE INTO app_meta (key, value) VALUES ('board_version', '0');
  `);
}

function migrateV1toV2() {
  // 清理可能的重复行（历史 bug 导致）| Clean up possible duplicate rows (from historical bug)
  db.run(
    "DELETE FROM schema_version WHERE version > (SELECT MIN(version) FROM schema_version)",
  );
  const version =
    db.exec("SELECT MIN(version) as v FROM schema_version")[0]?.values[0][0] ||
    0;
  if (version >= 2) return;
  db.run("BEGIN TRANSACTION;");
  try {
    // V1 表缺少 location 列，先补齐 | V1 tables lack location column, add it first
    try {
      db.run("ALTER TABLE rooms ADD COLUMN location TEXT");
    } catch (e) {
      /* 已存在则忽略 | ignore if exists */
    }
    // V1 表可能已有 location 但无 capacity（部分迁移残留），补齐 capacity 列做兜底 | Add capacity column if missing (partial migration residue)
    try {
      db.run("ALTER TABLE rooms ADD COLUMN capacity INTEGER DEFAULT 1");
    } catch (e) {
      /* 已存在则忽略 | ignore if exists */
    }

    // 1. 创建新表 | Create new tables
    db.run(`
    CREATE TABLE IF NOT EXISTS beds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL,
      bed_number TEXT NOT NULL,
      status TEXT DEFAULT '可用',
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS meals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lodger_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      breakfast INTEGER DEFAULT 0,
      lunch INTEGER DEFAULT 0,
      dinner INTEGER DEFAULT 0,
      notes TEXT,
      UNIQUE(lodger_id, date)
    );
  `);

    // 2. 根据 rooms.capacity 创建床位（幂等：已有床位则跳过）| Create beds from rooms.capacity (idempotent: skip if beds exist)
    const rooms = query("SELECT id, capacity FROM rooms");
    const bedMap = {}; // room_id -> [bedId1, bedId2, ...]
    // 先检查是否已有床位（迁移重入场景）| Check if beds already exist (migration re-entry scenario)
    const existingBeds = query("SELECT COUNT(*) as c FROM beds")[0]?.c || 0;
    if (existingBeds === 0) {
      rooms.forEach((r) => {
        bedMap[r.id] = [];
        const cap = r.capacity || 1;
        for (let i = 1; i <= cap; i++) {
          run(
            "INSERT INTO beds (room_id, bed_number, status) VALUES (?, ?, '可用')",
            [r.id, i + "号床"],
          );
          const res = db.exec("SELECT last_insert_rowid() as id");
          bedMap[r.id].push(res[0].values[0][0]);
        }
      });
    } else {
      // 已有床位：从现有 beds 表构建 bedMap | Beds exist: build bedMap from existing beds table
      const existingBedsList = query(
        "SELECT id, room_id FROM beds ORDER BY room_id, id",
      );
      existingBedsList.forEach((b) => {
        if (!bedMap[b.room_id]) bedMap[b.room_id] = [];
        bedMap[b.room_id].push(b.id);
      });
    }

    // 3. 创建新的 lodgers 表（含 bed_id，不含 room_id）
    db.run(`
    CREATE TABLE lodgers_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      dharma_name TEXT,
      gender TEXT,
      phone TEXT,
      id_card TEXT,
      check_in_date TEXT,
      expected_check_out TEXT,
      actual_check_out TEXT,
      bed_id INTEGER,
      role TEXT,
      status TEXT DEFAULT '在住',
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

    // 4. 迁移旧 lodgers（先清除 lodgers_new 残留，确保幂等）| Migrate old lodgers (clear lodgers_new first for idempotency)
    db.run("DELETE FROM lodgers_new");
    const lodgers = query("SELECT * FROM lodgers ORDER BY id");
    const usedIndex = {}; // room_id -> index
    lodgers.forEach((l) => {
      const beds = bedMap[l.room_id] || [];
      const idx = usedIndex[l.room_id] || 0;
      const bedId = beds.length > 0 ? beds[idx % beds.length] : null;
      usedIndex[l.room_id] = idx + 1;
      // V1 表无 role 列，迁移时默认 null | V1 table has no role column, default to null
      run(
        `INSERT INTO lodgers_new
      (id, name, dharma_name, gender, phone, id_card, check_in_date, expected_check_out, actual_check_out, bed_id, role, status, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          l.id,
          l.name,
          l.dharma_name,
          l.gender,
          l.phone,
          l.id_card,
          l.check_in_date,
          l.expected_check_out,
          l.actual_check_out,
          bedId,
          l.role || null,
          l.status,
          l.notes,
          l.created_at,
        ],
      );
    });

    // 迁移完成前预检：确保 lodgers_new 有数据（防止空迁移破坏数据）| Pre-check: ensure lodgers_new has data before destroying old table
    const newCount =
      db.exec("SELECT COUNT(*) as c FROM lodgers_new")[0]?.values[0][0] || 0;
    const oldCount =
      db.exec("SELECT COUNT(*) as c FROM lodgers")[0]?.values[0][0] || 0;
    if (newCount < oldCount && oldCount > 0) {
      throw new Error(
        `挂单数据迁移不完整：旧表${oldCount}条，新表仅${newCount}条。请重置数据库。`,
      );
    }
    db.run("DROP TABLE lodgers");
    db.run("ALTER TABLE lodgers_new RENAME TO lodgers");

    // 5. 删除 rooms.capacity
    db.run("ALTER TABLE rooms DROP COLUMN capacity");

    // 6. 更新版本（仅更新旧版本，防止多行冲突）| Update version (only old versions, prevent multi-row conflict)
    db.run("DELETE FROM schema_version WHERE version < 2");
    db.run("INSERT OR REPLACE INTO schema_version (version) VALUES (2)");
    db.run("COMMIT;");
  } catch (e) {
    try {
      db.run("ROLLBACK;");
    } catch (rollbackErr) {
      /* ignore */
    }
    throw new Error("migrateV1toV2 failed: " + e.message);
  }
}

function migrateV2toV3() {
  const version =
    db.exec("SELECT MIN(version) as v FROM schema_version")[0]?.values[0][0] ||
    0;
  if (version >= 3) return;
  db.run("BEGIN TRANSACTION;");
  try {
    db.run("ALTER TABLE lodgers ADD COLUMN role TEXT");
    // 使用 DELETE + INSERT 代替 UPDATE，防止多行 PRIMARY KEY 冲突 | Use DELETE+INSERT instead of UPDATE to prevent multi-row PK conflict
    db.run("DELETE FROM schema_version WHERE version < 3");
    db.run("INSERT OR REPLACE INTO schema_version (version) VALUES (3)");
    db.run("COMMIT;");
  } catch (e) {
    try {
      db.run("ROLLBACK;");
    } catch (rollbackErr) {
      /* ignore */
    }
    throw new Error("migrateV2toV3 failed: " + e.message);
  }
}

function migrateV3toV4() {
  const version =
    db.exec("SELECT MIN(version) as v FROM schema_version")[0]?.values[0][0] ||
    0;
  if (version >= 4) return;
  db.run("BEGIN TRANSACTION;");
  try {
    // 1. 创建 V4 新表（幂等：IF NOT EXISTS）
    db.run(`
    CREATE TABLE IF NOT EXISTS guests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      dharma_name TEXT,
      gender TEXT,
      phone TEXT,
      id_card TEXT,
      emergency_contact TEXT,
      emergency_phone TEXT,
      blacklist INTEGER DEFAULT 0,
      visit_count INTEGER DEFAULT 0,
      last_visit_date TEXT,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lodger_id INTEGER,
      reservation_id INTEGER,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      method TEXT,
      remark TEXT,
      paid_at TEXT DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guest_id INTEGER,
      name TEXT NOT NULL,
      dharma_name TEXT,
      gender TEXT,
      phone TEXT,
      id_card TEXT,
      role TEXT,
      expected_check_in TEXT,
      expected_check_out TEXT,
      room_preference TEXT,
      group_code TEXT,
      source TEXT,
      status TEXT DEFAULT '预约',
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS housekeeping (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bed_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      operator TEXT,
      changed_at TEXT DEFAULT CURRENT_TIMESTAMP,
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id INTEGER,
      detail TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

    // 2. 为 lodgers 增加 guest_id / source / group_code 列
    try {
      db.run("ALTER TABLE lodgers ADD COLUMN guest_id INTEGER");
    } catch (e) {
      /* 已存在则忽略 */
    }
    try {
      db.run("ALTER TABLE lodgers ADD COLUMN source TEXT");
    } catch (e) {
      /* 已存在则忽略 */
    }
    try {
      db.run("ALTER TABLE lodgers ADD COLUMN group_code TEXT");
    } catch (e) {
      /* 已存在则忽略 */
    }

    // 3. 从现有 lodgers 生成 guests 主数据，并回写 guest_id（按手机号/身份证去重）
    const lodgers = query(
      "SELECT * FROM lodgers WHERE guest_id IS NULL ORDER BY id",
    );
    const guestMap = {}; // key: phone 或 id_card 或 name
    lodgers.forEach((l) => {
      const key = l.phone || l.id_card || `${l.name}|${l.dharma_name || ""}`;
      let guestId = guestMap[key];
      if (!guestId) {
        run(
          `INSERT INTO guests (name, dharma_name, gender, phone, id_card, visit_count, last_visit_date, notes, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            l.name,
            l.dharma_name || null,
            l.gender || null,
            l.phone || null,
            l.id_card || null,
            1,
            l.check_in_date || null,
            l.notes || null,
            new Date().toISOString(),
          ],
        );
        guestId = db.exec("SELECT last_insert_rowid() as id")[0].values[0][0];
        guestMap[key] = guestId;
      } else {
        // 累计到访次数
        run(
          "UPDATE guests SET visit_count = visit_count + 1, last_visit_date = COALESCE(?, last_visit_date), updated_at = ? WHERE id = ?",
          [l.check_in_date || null, new Date().toISOString(), guestId],
        );
      }
      run("UPDATE lodgers SET guest_id = ? WHERE id = ?", [guestId, l.id]);
    });

    // 4. 初始化 housekeeping 记录（已有床位）
    const existingHk =
      query("SELECT COUNT(*) as c FROM housekeeping")[0]?.c || 0;
    if (existingHk === 0) {
      const beds = query("SELECT id, status FROM beds");
      beds.forEach((b) => {
        let hkStatus;
        if (b.status === "占用") hkStatus = "占用";
        else if (b.status === "维修" || b.status === "停用") hkStatus = "维修";
        else hkStatus = "净房";
        if (b.status === "停用")
          run("UPDATE beds SET status='维修' WHERE id=?", [b.id]);
        run(
          "INSERT INTO housekeeping (bed_id, status, notes) VALUES (?, ?, 'V4 初始化')",
          [b.id, hkStatus],
        );
      });
    }

    // 5. 迁移老 beds.status = '可用' 为房务可用（实际需经清洁流程才能再次入住）
    // 保留 beds.status 作为物理占用/维修/可用，新增房务状态在 housekeeping 中维护

    // 6. 更新版本号
    db.run("DELETE FROM schema_version WHERE version < 4");
    db.run("INSERT OR REPLACE INTO schema_version (version) VALUES (4)");
    db.run("COMMIT;");
  } catch (e) {
    try {
      db.run("ROLLBACK;");
    } catch (rollbackErr) {
      /* ignore */
    }
    throw new Error("migrateV3toV4 failed: " + e.message);
  }
}

function migrateV4toV5() {
  const version =
    db.exec("SELECT MIN(version) as v FROM schema_version")[0]?.values[0][0] ||
    0;
  if (version >= 5) return;
  db.run("BEGIN TRANSACTION;");
  try {
    // 添加男寮/女寮字段 | Add male/female dorm field
    try {
      db.run("ALTER TABLE rooms ADD COLUMN dorm_type TEXT DEFAULT '不限'");
    } catch (e) {
      /* 已存在则忽略 */
    }

    // V4 的 rooms 表没有 gender_type 列，无法自动推断 dorm_type；保持默认值 '不限'，由用户在基础设置中维护。

    // 更新版本号
    db.run("DELETE FROM schema_version WHERE version < 5");
    db.run("INSERT OR REPLACE INTO schema_version (version) VALUES (5)");
    db.run("COMMIT;");
  } catch (e) {
    try {
      db.run("ROLLBACK;");
    } catch (rollbackErr) {
      /* ignore */
    }
    throw new Error("migrateV4toV5 failed: " + e.message);
  }
}

function migrateV5toV6() {
  const version =
    db.exec("SELECT MIN(version) as v FROM schema_version")[0]?.values[0][0] ||
    0;
  if (version >= 6) return;
  db.run("BEGIN TRANSACTION;");
  try {
    // 1. 创建 events 表（幂等）
    db.run(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      event_type TEXT DEFAULT '禅营',
      gender_type TEXT DEFAULT '混合',
      expected_count INTEGER DEFAULT 0,
      start_date TEXT,
      end_date TEXT,
      status TEXT DEFAULT '筹备中',
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

    // 2. 从旧的 group_code 自动创建营期记录（按 name 去重，幂等）
    const eventMap = {}; // group_code / event_name -> event_id
    const eventClassMap = {}; // group_code -> class_name（拆分后的班级/分组）
    const existingEvents = query("SELECT id, name FROM events");
    existingEvents.forEach((e) => {
      eventMap[e.name] = e.id;
    });

    // 旧版本表结构可能不包含 group_code（如部分 V3 备份），先检查列是否存在
    function tableHasColumn(table, column) {
      const info = db.exec(`PRAGMA table_info(${table})`)[0];
      if (!info) return false;
      const idx = info.columns.indexOf("name");
      return info.values.some((row) => row[idx] === column);
    }
    const lodgersHasGroupCode = tableHasColumn("lodgers", "group_code");
    const reservationsHasGroupCode = tableHasColumn(
      "reservations",
      "group_code",
    );

    let groups = [];
    if (lodgersHasGroupCode || reservationsHasGroupCode) {
      const parts = [];
      if (lodgersHasGroupCode)
        parts.push(
          "SELECT group_code FROM lodgers WHERE group_code IS NOT NULL AND group_code != ''",
        );
      if (reservationsHasGroupCode)
        parts.push(
          "SELECT group_code FROM reservations WHERE group_code IS NOT NULL AND group_code != ''",
        );
      groups = query(`SELECT group_code FROM (${parts.join(" UNION ")})`);
    }
    groups.forEach((g) => {
      const code = g.group_code;

      // 尝试拆分营期名与班级/分组，例如 "2026水陆法会-一班"
      let eventName = code;
      let className = null;
      const sepIdx = code.indexOf("-");
      if (sepIdx > 0) {
        eventName = code.slice(0, sepIdx).trim();
        className = code.slice(sepIdx + 1).trim() || null;
      }
      eventClassMap[code] = className;

      if (eventMap[code]) return; // 已存在，直接复用
      if (eventMap[eventName]) {
        eventMap[code] = eventMap[eventName];
        return; // 拆分后的营期名已存在，不重复创建
      }

      const eventType = eventName.includes("法会") ? "法会" : "禅营";
      run(
        `INSERT INTO events (name, event_type, gender_type, status, notes) VALUES (?, ?, '混合', '进行中', ?)`,
        [eventName, eventType, "原团体批次号：" + code],
      );
      const eventId = db.exec("SELECT last_insert_rowid() as id")[0]
        .values[0][0];
      eventMap[code] = eventId;
      eventMap[eventName] = eventId;
    });

    // 3. 重建 lodgers 表（去掉 group_code，新增 event_id / class_name）
    db.run(`
    CREATE TABLE lodgers_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guest_id INTEGER,
      event_id INTEGER,
      name TEXT NOT NULL,
      dharma_name TEXT,
      gender TEXT,
      phone TEXT,
      id_card TEXT,
      check_in_date TEXT,
      expected_check_out TEXT,
      actual_check_out TEXT,
      bed_id INTEGER,
      role TEXT,
      class_name TEXT,
      status TEXT DEFAULT '在住',
      source TEXT,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
    db.run("DELETE FROM lodgers_new");
    const lodgers = query("SELECT * FROM lodgers ORDER BY id");
    lodgers.forEach((l) => {
      run(
        `INSERT INTO lodgers_new
      (id, guest_id, event_id, name, dharma_name, gender, phone, id_card, check_in_date, expected_check_out, actual_check_out, bed_id, role, class_name, status, source, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          l.id,
          l.guest_id || null,
          (lodgersHasGroupCode ? eventMap[l.group_code] : null) || null,
          l.name,
          l.dharma_name || null,
          l.gender || null,
          l.phone || null,
          l.id_card || null,
          l.check_in_date || null,
          l.expected_check_out || null,
          l.actual_check_out || null,
          l.bed_id || null,
          l.role || null,
          (lodgersHasGroupCode ? eventClassMap[l.group_code] : null) || null,
          l.status || "在住",
          l.source || null,
          l.notes || null,
          l.created_at || null,
        ],
      );
    });
    const newLodgerCount =
      db.exec("SELECT COUNT(*) as c FROM lodgers_new")[0]?.values[0][0] || 0;
    const oldLodgerCount =
      db.exec("SELECT COUNT(*) as c FROM lodgers")[0]?.values[0][0] || 0;
    if (newLodgerCount < oldLodgerCount && oldLodgerCount > 0) {
      throw new Error(
        `挂单数据迁移不完整：旧表${oldLodgerCount}条，新表仅${newLodgerCount}条。`,
      );
    }
    db.run("DROP TABLE lodgers");
    db.run("ALTER TABLE lodgers_new RENAME TO lodgers");

    // 4. 重建 reservations 表（去掉 group_code，新增 event_id / class_name）
    db.run(`
    CREATE TABLE reservations_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guest_id INTEGER,
      event_id INTEGER,
      name TEXT NOT NULL,
      dharma_name TEXT,
      gender TEXT,
      phone TEXT,
      id_card TEXT,
      role TEXT,
      class_name TEXT,
      expected_check_in TEXT,
      expected_check_out TEXT,
      room_preference TEXT,
      source TEXT,
      status TEXT DEFAULT '预约',
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
    db.run("DELETE FROM reservations_new");
    const reservations = query("SELECT * FROM reservations ORDER BY id");
    reservations.forEach((r) => {
      run(
        `INSERT INTO reservations_new
      (id, guest_id, event_id, name, dharma_name, gender, phone, id_card, role, class_name, expected_check_in, expected_check_out, room_preference, source, status, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          r.id,
          r.guest_id || null,
          (reservationsHasGroupCode ? eventMap[r.group_code] : null) || null,
          r.name,
          r.dharma_name || null,
          r.gender || null,
          r.phone || null,
          r.id_card || null,
          r.role || null,
          (reservationsHasGroupCode ? eventClassMap[r.group_code] : null) ||
            null,
          r.expected_check_in || null,
          r.expected_check_out || null,
          r.room_preference || null,
          r.source || null,
          r.status || "预约",
          r.notes || null,
          r.created_at || null,
        ],
      );
    });
    const newResvCount =
      db.exec("SELECT COUNT(*) as c FROM reservations_new")[0]?.values[0][0] ||
      0;
    const oldResvCount =
      db.exec("SELECT COUNT(*) as c FROM reservations")[0]?.values[0][0] || 0;
    if (newResvCount < oldResvCount && oldResvCount > 0) {
      throw new Error(
        `预约数据迁移不完整：旧表${oldResvCount}条，新表仅${newResvCount}条。`,
      );
    }
    db.run("DROP TABLE reservations");
    db.run("ALTER TABLE reservations_new RENAME TO reservations");

    // 5. 更新版本号
    db.run("DELETE FROM schema_version WHERE version < 6");
    db.run("INSERT OR REPLACE INTO schema_version (version) VALUES (6)");
    db.run("COMMIT;");
  } catch (e) {
    try {
      db.run("ROLLBACK;");
    } catch (rollbackErr) {
      /* ignore */
    }
    throw new Error("migrateV5toV6 failed: " + e.message);
  }
}

function migrateV6toV7() {
  const version =
    db.exec("SELECT MIN(version) as v FROM schema_version")[0]?.values[0][0] ||
    0;
  if (version >= 7) return;
  db.run("BEGIN TRANSACTION;");
  try {
    // 1. 创建 users 表
    db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT,
      role TEXT NOT NULL,
      password TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

    // 2. 初始化默认账号（仅在表为空时）
    const count = query("SELECT COUNT(*) as c FROM users")[0]?.c || 0;
    if (count === 0) {
      run(
        "INSERT INTO users (username, display_name, role, password) VALUES (?, ?, ?, ?)",
        [
          "admin",
          "管理员",
          "admin",
          "sha256$ketang_default_salt$8d62959035f9b60a02e709f9826f3f996d07a09a4f5091e2884642fa01adf8a3",
        ],
      );
      run(
        "INSERT INTO users (username, display_name, role, password) VALUES (?, ?, ?, ?)",
        [
          "zhike",
          "知客师",
          "zhike",
          "sha256$ketang_default_salt$fc286955fb12bec3fb16b4f2619f9b675337b1240537bc21d830b5f495121565",
        ],
      );
    }

    // 3. 更新版本号
    db.run("DELETE FROM schema_version WHERE version < 7");
    db.run("INSERT OR REPLACE INTO schema_version (version) VALUES (7)");
    db.run("COMMIT;");
  } catch (e) {
    try {
      db.run("ROLLBACK;");
    } catch (rollbackErr) {
      /* ignore */
    }
    throw new Error("migrateV6toV7 failed: " + e.message);
  }
}

function migrateV7toV8() {
  const version =
    db.exec("SELECT MIN(version) as v FROM schema_version")[0]?.values[0][0] ||
    0;
  if (version >= 8) return;
  db.run("BEGIN TRANSACTION;");
  try {
    // 清理已废弃的 events.actual_count 列
    const cols = db.exec("PRAGMA table_info(events)")[0];
    const colIdx = cols.columns.indexOf("name");
    const hasActualCount = cols.values.some(
      (row) => row[colIdx] === "actual_count",
    );
    if (hasActualCount) {
      try {
        db.run("ALTER TABLE events DROP COLUMN actual_count");
      } catch (dropErr) {
        // 旧版 SQLite 不支持 DROP COLUMN，则通过重建表移除
        db.run(`
          CREATE TABLE events_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            event_type TEXT DEFAULT '禅营',
            gender_type TEXT DEFAULT '混合',
            expected_count INTEGER DEFAULT 0,
            start_date TEXT,
            end_date TEXT,
            status TEXT DEFAULT '筹备中',
            notes TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
          );
        `);
        db.run(`INSERT INTO events_new (id, name, event_type, gender_type, expected_count, start_date, end_date, status, notes, created_at)
                SELECT id, name, event_type, gender_type, expected_count, start_date, end_date, status, notes, created_at FROM events`);
        db.run("DROP TABLE events");
        db.run("ALTER TABLE events_new RENAME TO events");
      }
    }
    db.run("DELETE FROM schema_version WHERE version < 8");
    db.run("INSERT OR REPLACE INTO schema_version (version) VALUES (8)");
    db.run("COMMIT;");
  } catch (e) {
    try {
      db.run("ROLLBACK;");
    } catch (rollbackErr) {
      /* ignore */
    }
    throw new Error("migrateV7toV8 failed: " + e.message);
  }
}

function migrateV8toV9() {
  const version =
    db.exec("SELECT MIN(version) as v FROM schema_version")[0]?.values[0][0] ||
    0;
  if (version >= 9) return;
  db.run("BEGIN TRANSACTION;");
  try {
    // 为用户表增加软删除标记
    try {
      db.run("ALTER TABLE users ADD COLUMN is_active INTEGER DEFAULT 1");
    } catch (e) {
      /* 已存在则忽略 */
    }
    db.run("DELETE FROM schema_version WHERE version < 9");
    db.run("INSERT OR REPLACE INTO schema_version (version) VALUES (9)");
    db.run("COMMIT;");
  } catch (e) {
    try {
      db.run("ROLLBACK;");
    } catch (rollbackErr) {
      /* ignore */
    }
    throw new Error("migrateV8toV9 failed: " + e.message);
  }
}

function migrateV9toV10() {
  const version =
    db.exec("SELECT MIN(version) as v FROM schema_version")[0]?.values[0][0] ||
    0;
  if (version >= 10) return;
  // 重建期间临时关闭外键检查，必须在事务开始前设置
  db.run(`PRAGMA foreign_keys = OFF;`);
  db.run("BEGIN TRANSACTION;");
  try {
    // 1. 清洗不符合新 CHECK 约束的历史数据，避免重建时复制失败
    db.run(
      "UPDATE rooms SET dorm_type = '不限' WHERE dorm_type NOT IN ('男寮','女寮','不限') OR dorm_type IS NULL",
    );
    db.run(
      "UPDATE events SET gender_type = '混合' WHERE gender_type NOT IN ('男众','女众','混合') OR gender_type IS NULL",
    );
    db.run(
      "UPDATE events SET status = '筹备中' WHERE status NOT IN ('筹备中','招生中','进行中','已结束','已取消') OR status IS NULL",
    );
    db.run(
      "UPDATE beds SET status = '可用' WHERE status NOT IN ('可用','占用','维修','备用') OR status IS NULL",
    );
    db.run(
      "UPDATE lodgers SET status = '在住' WHERE status NOT IN ('在住','已退','已取消','No-show') OR status IS NULL",
    );
    db.run(
      "UPDATE reservations SET status = '预约' WHERE status NOT IN ('预约','已确认','已入住','已取消','No-show') OR status IS NULL",
    );
    db.run(
      "UPDATE payments SET type = '其他' WHERE type NOT IN ('押金','房费','退款','其他') OR type IS NULL",
    );
    db.run(
      "UPDATE housekeeping SET status = '净房' WHERE status NOT IN ('脏房','净房','查房','可用','占用','维修') OR status IS NULL",
    );
    db.run(
      "UPDATE meals SET breakfast = 0 WHERE breakfast NOT IN (0,1) OR breakfast IS NULL",
    );
    db.run(
      "UPDATE meals SET lunch = 0 WHERE lunch NOT IN (0,1) OR lunch IS NULL",
    );
    db.run(
      "UPDATE meals SET dinner = 0 WHERE dinner NOT IN (0,1) OR dinner IS NULL",
    );

    // beds
    db.run(`
      CREATE TABLE beds_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        bed_number TEXT NOT NULL,
        status TEXT DEFAULT '可用' CHECK(status IN ('可用','占用','维修','备用')),
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
    db.run(
      `INSERT INTO beds_new (id, room_id, bed_number, status, notes, created_at) SELECT id, room_id, bed_number, status, notes, created_at FROM beds`,
    );
    db.run(`DROP TABLE beds`);
    db.run(`ALTER TABLE beds_new RENAME TO beds`);

    // lodgers
    db.run(`
      CREATE TABLE lodgers_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guest_id INTEGER REFERENCES guests(id) ON DELETE SET NULL,
        event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        dharma_name TEXT,
        gender TEXT,
        phone TEXT,
        id_card TEXT,
        check_in_date TEXT,
        expected_check_out TEXT,
        actual_check_out TEXT,
        bed_id INTEGER REFERENCES beds(id) ON DELETE SET NULL,
        role TEXT,
        class_name TEXT,
        status TEXT DEFAULT '在住' CHECK(status IN ('在住','已退','已取消','No-show')),
        source TEXT,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
    db.run(`INSERT INTO lodgers_new (id, guest_id, event_id, name, dharma_name, gender, phone, id_card, check_in_date, expected_check_out, actual_check_out, bed_id, role, class_name, status, source, notes, created_at)
            SELECT id, guest_id, event_id, name, dharma_name, gender, phone, id_card, check_in_date, expected_check_out, actual_check_out, bed_id, role, class_name, status, source, notes, created_at FROM lodgers`);
    db.run(`DROP TABLE lodgers`);
    db.run(`ALTER TABLE lodgers_new RENAME TO lodgers`);

    // meals
    db.run(`
      CREATE TABLE meals_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lodger_id INTEGER NOT NULL REFERENCES lodgers(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        breakfast INTEGER DEFAULT 0 CHECK(breakfast IN (0,1)),
        lunch INTEGER DEFAULT 0 CHECK(lunch IN (0,1)),
        dinner INTEGER DEFAULT 0 CHECK(dinner IN (0,1)),
        notes TEXT,
        UNIQUE(lodger_id, date)
      );
    `);
    db.run(
      `INSERT INTO meals_new (id, lodger_id, date, breakfast, lunch, dinner, notes) SELECT id, lodger_id, date, breakfast, lunch, dinner, notes FROM meals`,
    );
    db.run(`DROP TABLE meals`);
    db.run(`ALTER TABLE meals_new RENAME TO meals`);

    // payments
    db.run(`
      CREATE TABLE payments_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lodger_id INTEGER REFERENCES lodgers(id) ON DELETE CASCADE,
        reservation_id INTEGER REFERENCES reservations(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK(type IN ('押金','房费','退款','其他')),
        amount REAL NOT NULL,
        method TEXT,
        remark TEXT,
        paid_at TEXT DEFAULT CURRENT_TIMESTAMP,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
    db.run(`INSERT INTO payments_new (id, lodger_id, reservation_id, type, amount, method, remark, paid_at, created_at)
            SELECT id, lodger_id, reservation_id, type, amount, method, remark, paid_at, created_at FROM payments`);
    db.run(`DROP TABLE payments`);
    db.run(`ALTER TABLE payments_new RENAME TO payments`);

    // reservations
    db.run(`
      CREATE TABLE reservations_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guest_id INTEGER REFERENCES guests(id) ON DELETE SET NULL,
        event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        dharma_name TEXT,
        gender TEXT,
        phone TEXT,
        id_card TEXT,
        role TEXT,
        class_name TEXT,
        expected_check_in TEXT,
        expected_check_out TEXT,
        room_preference TEXT,
        source TEXT,
        status TEXT DEFAULT '预约' CHECK(status IN ('预约','已确认','已入住','已取消','No-show')),
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
    db.run(`INSERT INTO reservations_new (id, guest_id, event_id, name, dharma_name, gender, phone, id_card, role, class_name, expected_check_in, expected_check_out, room_preference, source, status, notes, created_at)
            SELECT id, guest_id, event_id, name, dharma_name, gender, phone, id_card, role, class_name, expected_check_in, expected_check_out, room_preference, source, status, notes, created_at FROM reservations`);
    db.run(`DROP TABLE reservations`);
    db.run(`ALTER TABLE reservations_new RENAME TO reservations`);

    // housekeeping
    db.run(`
      CREATE TABLE housekeeping_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bed_id INTEGER NOT NULL REFERENCES beds(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK(status IN ('脏房','净房','查房','可用','占用','维修')),
        operator TEXT,
        changed_at TEXT DEFAULT CURRENT_TIMESTAMP,
        notes TEXT
      );
    `);
    db.run(
      `INSERT INTO housekeeping_new (id, bed_id, status, operator, changed_at, notes) SELECT id, bed_id, status, operator, changed_at, notes FROM housekeeping`,
    );
    db.run(`DROP TABLE housekeeping`);
    db.run(`ALTER TABLE housekeeping_new RENAME TO housekeeping`);

    db.run("DELETE FROM schema_version WHERE version < 10");
    db.run("INSERT OR REPLACE INTO schema_version (version) VALUES (10)");
    db.run(`PRAGMA foreign_keys = ON;`);
    db.run("COMMIT;");
  } catch (e) {
    try {
      db.run("ROLLBACK;");
    } catch (rollbackErr) {
      /* ignore */
    }
    throw new Error("migrateV9toV10 failed: " + e.message);
  }
}

function dbTableHasColumn(table, column) {
  const info = db.exec("PRAGMA table_info(" + table + ")")[0];
  if (!info) return false;
  const idx = info.columns.indexOf("name");
  return info.values.some(function (row) {
    return row[idx] === column;
  });
}

function migrateV10toV11() {
  const version =
    db.exec("SELECT MIN(version) as v FROM schema_version")[0]?.values[0][0] ||
    0;
  if (version >= 11) return;
  db.run("BEGIN TRANSACTION;");
  try {
    if (!dbTableHasColumn("reservations", "meal_breakfast")) {
      db.run(
        "ALTER TABLE reservations ADD COLUMN meal_breakfast INTEGER DEFAULT 1 CHECK(meal_breakfast IN (0,1))",
      );
    }
    if (!dbTableHasColumn("reservations", "meal_lunch")) {
      db.run(
        "ALTER TABLE reservations ADD COLUMN meal_lunch INTEGER DEFAULT 1 CHECK(meal_lunch IN (0,1))",
      );
    }
    if (!dbTableHasColumn("reservations", "meal_dinner")) {
      db.run(
        "ALTER TABLE reservations ADD COLUMN meal_dinner INTEGER DEFAULT 0 CHECK(meal_dinner IN (0,1))",
      );
    }
    db.run(
      "UPDATE reservations SET meal_breakfast = 1 WHERE meal_breakfast IS NULL",
    );
    db.run("UPDATE reservations SET meal_lunch = 1 WHERE meal_lunch IS NULL");
    db.run("UPDATE reservations SET meal_dinner = 1 WHERE meal_dinner IS NULL");
    db.run("DELETE FROM schema_version WHERE version < 11");
    db.run("INSERT OR REPLACE INTO schema_version (version) VALUES (11)");
    db.run("COMMIT;");
  } catch (e) {
    try {
      db.run("ROLLBACK;");
    } catch (rollbackErr) {
      /* ignore */
    }
    throw new Error("migrateV10toV11 failed: " + e.message);
  }
}

function migrateV11toV12() {
  const version =
    db.exec("SELECT MIN(version) as v FROM schema_version")[0]?.values[0][0] ||
    0;
  if (version >= 12) return;
  db.run("BEGIN TRANSACTION;");
  try {
    if (!dbTableHasColumn("lodgers", "meal_default_breakfast")) {
      db.run(
        "ALTER TABLE lodgers ADD COLUMN meal_default_breakfast INTEGER DEFAULT 1 CHECK(meal_default_breakfast IN (0,1))",
      );
    }
    if (!dbTableHasColumn("lodgers", "meal_default_lunch")) {
      db.run(
        "ALTER TABLE lodgers ADD COLUMN meal_default_lunch INTEGER DEFAULT 1 CHECK(meal_default_lunch IN (0,1))",
      );
    }
    if (!dbTableHasColumn("lodgers", "meal_default_dinner")) {
      db.run(
        "ALTER TABLE lodgers ADD COLUMN meal_default_dinner INTEGER DEFAULT 0 CHECK(meal_default_dinner IN (0,1))",
      );
    }
    db.run(
      "UPDATE lodgers SET meal_default_breakfast = 1 WHERE meal_default_breakfast IS NULL",
    );
    db.run(
      "UPDATE lodgers SET meal_default_lunch = 1 WHERE meal_default_lunch IS NULL",
    );
    db.run(
      "UPDATE lodgers SET meal_default_dinner = 1 WHERE meal_default_dinner IS NULL",
    );
    query("SELECT id FROM lodgers").forEach(function (row) {
      const sample = query(
        "SELECT breakfast, lunch, dinner FROM meals WHERE lodger_id=? ORDER BY date LIMIT 1",
        [row.id],
      )[0];
      if (sample) {
        run(
          "UPDATE lodgers SET meal_default_breakfast=?, meal_default_lunch=?, meal_default_dinner=? WHERE id=?",
          [
            sample.breakfast ? 1 : 0,
            sample.lunch ? 1 : 0,
            sample.dinner ? 1 : sample.breakfast && sample.lunch ? 1 : 0,
            row.id,
          ],
        );
      }
    });
    db.run("DELETE FROM schema_version WHERE version < 12");
    db.run("INSERT OR REPLACE INTO schema_version (version) VALUES (12)");
    db.run("COMMIT;");
  } catch (e) {
    try {
      db.run("ROLLBACK;");
    } catch (rollbackErr) {
      /* ignore */
    }
    throw new Error("migrateV11toV12 failed: " + e.message);
  }
}

function migrateV12toV13() {
  const version =
    db.exec("SELECT MIN(version) as v FROM schema_version")[0]?.values[0][0] ||
    0;
  if (version >= 13) return;
  db.run("BEGIN TRANSACTION;");
  try {
    db.run("UPDATE lodgers SET meal_default_dinner = 1");
    db.run(`
      UPDATE meals SET dinner = 1
      WHERE dinner = 0 AND breakfast = 1 AND lunch = 1
    `);
    db.run("DELETE FROM schema_version WHERE version < 13");
    db.run("INSERT OR REPLACE INTO schema_version (version) VALUES (13)");
    db.run("COMMIT;");
  } catch (e) {
    try {
      db.run("ROLLBACK;");
    } catch (rollbackErr) {
      /* ignore */
    }
    throw new Error("migrateV12toV13 failed: " + e.message);
  }
}

function migrateV13toV14() {
  const version =
    db.exec("SELECT MIN(version) as v FROM schema_version")[0]?.values[0][0] ||
    0;
  if (version >= 14) return;
  db.run("BEGIN TRANSACTION;");
  try {
    try {
      db.run("ALTER TABLE users ADD COLUMN auth_version INTEGER DEFAULT 1");
    } catch (e) {
      /* 已存在则忽略 */
    }
    try {
      db.run(
        "ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0",
      );
    } catch (e) {
      /* 已存在则忽略 */
    }
    db.run("DELETE FROM schema_version WHERE version < 14");
    db.run("INSERT OR REPLACE INTO schema_version (version) VALUES (14)");
    db.run("COMMIT;");
  } catch (e) {
    try {
      db.run("ROLLBACK;");
    } catch (rollbackErr) {
      /* ignore */
    }
    throw new Error("migrateV13toV14 failed: " + e.message);
  }
}

function migrateV14toV15() {
  const version =
    db.exec("SELECT MIN(version) as v FROM schema_version")[0]?.values[0][0] ||
    0;
  if (version >= 15) return;
  db.run("BEGIN TRANSACTION;");
  try {
    // 扩展角色枚举并增加高级知客与权限字段 | Expand roles and add advanced zhike / permissions fields
    try {
      db.run("ALTER TABLE users ADD COLUMN is_advanced INTEGER DEFAULT 0");
    } catch (e) {
      /* 已存在则忽略 */
    }
    try {
      db.run("ALTER TABLE users ADD COLUMN permissions TEXT");
    } catch (e) {
      /* 已存在则忽略 */
    }
    // SQLite 不支持直接修改 CHECK 约束；通过重建 users 表更新角色枚举
    const hasOldCheck =
      db.exec(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='users'",
      )[0]?.values[0][0] || "";
    if (
      hasOldCheck.includes("'admin','zhike'") &&
      !hasOldCheck.includes("'kitchen'")
    ) {
      db.run("DROP TABLE IF EXISTS users_new");
      db.run(`
        CREATE TABLE users_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          display_name TEXT,
          role TEXT NOT NULL CHECK(role IN ('admin','zhike','kitchen','housekeeping','viewer')),
          is_advanced INTEGER DEFAULT 0 CHECK(is_advanced IN (0,1)),
          permissions TEXT,
          password TEXT NOT NULL,
          is_active INTEGER DEFAULT 1 CHECK(is_active IN (0,1)),
          auth_version INTEGER DEFAULT 1,
          must_change_password INTEGER DEFAULT 0 CHECK(must_change_password IN (0,1)),
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.run(`INSERT INTO users_new (id, username, display_name, role, is_advanced, permissions, password, is_active, auth_version, must_change_password, created_at)
              SELECT id, username, display_name, role, COALESCE(is_advanced, 0), permissions, password, COALESCE(is_active, 1), COALESCE(auth_version, 1), COALESCE(must_change_password, 0), created_at FROM users`);
      db.run("DROP TABLE users");
      db.run("ALTER TABLE users_new RENAME TO users");
    }
    db.run("DELETE FROM schema_version WHERE version < 15");
    db.run("INSERT OR REPLACE INTO schema_version (version) VALUES (15)");
    db.run("COMMIT;");
  } catch (e) {
    try {
      db.run("ROLLBACK;");
    } catch (rollbackErr) {
      /* ignore */
    }
    throw new Error("migrateV14toV15 failed: " + e.message);
  }
}

function migrateV15toV16() {
  const version =
    db.exec("SELECT MIN(version) as v FROM schema_version")[0]?.values[0][0] ||
    0;
  if (version >= 16) return;
  db.run("BEGIN TRANSACTION;");
  try {
    try {
      db.run(
        "ALTER TABLE events ADD COLUMN include_spare_beds INTEGER DEFAULT 0 CHECK(include_spare_beds IN (0,1))",
      );
    } catch (e) {
      /* 已存在则忽略 */
    }
    db.run("DELETE FROM schema_version WHERE version < 16");
    db.run("INSERT OR REPLACE INTO schema_version (version) VALUES (16)");
    db.run("COMMIT;");
  } catch (e) {
    try {
      db.run("ROLLBACK;");
    } catch (rollbackErr) {
      /* ignore */
    }
    throw new Error("migrateV15toV16 failed: " + e.message);
  }
}

function tableHasColumn(table, column) {
  const rows = db.exec(`PRAGMA table_info(${table})`)[0]?.values || [];
  return rows.some((row) => row[1] === column);
}

function addColumnIfMissing(table, column, definition) {
  if (tableHasColumn(table, column)) return;
  db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function ensureLocalRoomingSchemaColumns() {
  addColumnIfMissing("events", "activity_target", "TEXT");
  addColumnIfMissing("events", "arrival_date", "TEXT");
  addColumnIfMissing("events", "departure_date", "TEXT");
  addColumnIfMissing("events", "confirmed_count", "INTEGER DEFAULT 0");
  addColumnIfMissing("events", "actual_arrival_count", "INTEGER DEFAULT 0");
  addColumnIfMissing("events", "expected_absent_count", "INTEGER DEFAULT 0");
  addColumnIfMissing("events", "male_count", "INTEGER DEFAULT 0");
  addColumnIfMissing("events", "female_count", "INTEGER DEFAULT 0");
  addColumnIfMissing("events", "child_count", "INTEGER DEFAULT 0");
  addColumnIfMissing("events", "elder_count", "INTEGER DEFAULT 0");
  addColumnIfMissing("events", "teacher_count", "INTEGER DEFAULT 0");
  addColumnIfMissing("events", "volunteer_count", "INTEGER DEFAULT 0");
  addColumnIfMissing("events", "special_needs_count", "INTEGER DEFAULT 0");
  addColumnIfMissing("events", "manager_name", "TEXT");
  addColumnIfMissing("events", "manager_phone", "TEXT");
  addColumnIfMissing("events", "backup_manager_name", "TEXT");
  addColumnIfMissing(
    "events",
    "needs_central_lodging",
    "INTEGER DEFAULT 0 CHECK(needs_central_lodging IN (0,1))",
  );
  addColumnIfMissing(
    "events",
    "needs_quiet_zone",
    "INTEGER DEFAULT 0 CHECK(needs_quiet_zone IN (0,1))",
  );
  addColumnIfMissing(
    "events",
    "needs_near_zen_hall",
    "INTEGER DEFAULT 0 CHECK(needs_near_zen_hall IN (0,1))",
  );
  addColumnIfMissing(
    "events",
    "needs_teacher_room",
    "INTEGER DEFAULT 0 CHECK(needs_teacher_room IN (0,1))",
  );
  addColumnIfMissing("rooms", "room_type", "TEXT DEFAULT '学员房'");
  addColumnIfMissing(
    "rooms",
    "suitable_elder",
    "INTEGER DEFAULT 0 CHECK(suitable_elder IN (0,1))",
  );
  addColumnIfMissing(
    "rooms",
    "suitable_child",
    "INTEGER DEFAULT 0 CHECK(suitable_child IN (0,1))",
  );
  addColumnIfMissing(
    "rooms",
    "near_zen_hall",
    "INTEGER DEFAULT 0 CHECK(near_zen_hall IN (0,1))",
  );
  addColumnIfMissing(
    "rooms",
    "flexible_use",
    "INTEGER DEFAULT 0 CHECK(flexible_use IN (0,1))",
  );
  addColumnIfMissing("beds", "bed_type", "TEXT DEFAULT '单床'");
  addColumnIfMissing(
    "beds",
    "suitable_elder",
    "INTEGER DEFAULT 0 CHECK(suitable_elder IN (0,1))",
  );
  addColumnIfMissing(
    "beds",
    "is_flexible",
    "INTEGER DEFAULT 0 CHECK(is_flexible IN (0,1))",
  );
  addColumnIfMissing("lodgers", "participant_identity", "TEXT");
  addColumnIfMissing("lodgers", "age_group", "TEXT");
  addColumnIfMissing("lodgers", "special_needs", "TEXT");
  addColumnIfMissing("reservations", "participant_identity", "TEXT");
  addColumnIfMissing("reservations", "age_group", "TEXT");
  addColumnIfMissing("reservations", "special_needs", "TEXT");
}

function migrateV16toV17() {
  const version =
    db.exec("SELECT MIN(version) as v FROM schema_version")[0]?.values[0][0] ||
    0;
  db.run("BEGIN TRANSACTION;");
  try {
    ensureLocalRoomingSchemaColumns();
    if (version < 17) {
      db.run("DELETE FROM schema_version WHERE version < 17");
      db.run("INSERT OR REPLACE INTO schema_version (version) VALUES (17)");
    }
    db.run("COMMIT;");
  } catch (e) {
    try {
      db.run("ROLLBACK;");
    } catch (rollbackErr) {
      /* ignore */
    }
    throw new Error("migrateV16toV17 failed: " + e.message);
  }
}

function ensureLocalRoomingPlanTables() {
  db.run(`
    CREATE TABLE IF NOT EXISTS rooming_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
      name TEXT,
      status TEXT DEFAULT '未确认' CHECK(status IN ('未确认','待调整','已确认')),
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS rooming_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id INTEGER NOT NULL REFERENCES rooming_plans(id) ON DELETE CASCADE,
      member_kind TEXT NOT NULL CHECK(member_kind IN ('lodger','reservation','forecast')),
      member_ref_id INTEGER,
      member_name TEXT NOT NULL,
      member_gender TEXT,
      participant_identity TEXT,
      age_group TEXT,
      special_needs TEXT,
      bed_id INTEGER REFERENCES beds(id),
      item_status TEXT DEFAULT '未确认' CHECK(item_status IN ('未确认','待调整','已确认')),
      notes TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function migrateV17toV18() {
  const version =
    db.exec("SELECT MIN(version) as v FROM schema_version")[0]?.values[0][0] ||
    0;
  db.run("BEGIN TRANSACTION;");
  try {
    ensureLocalRoomingPlanTables();
    if (version < 18) {
      db.run("DELETE FROM schema_version WHERE version < 18");
      db.run("INSERT OR REPLACE INTO schema_version (version) VALUES (18)");
    }
    db.run("COMMIT;");
  } catch (e) {
    try {
      db.run("ROLLBACK;");
    } catch (rollbackErr) {
      /* ignore */
    }
    throw new Error("migrateV17toV18 failed: " + e.message);
  }
}

function ensureLocalRoomingPublishSchema() {
  addColumnIfMissing("rooming_plans", "published_at", "TEXT");
  db.run(`
    CREATE TABLE IF NOT EXISTS rooming_checkin_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id INTEGER NOT NULL REFERENCES rooming_plans(id) ON DELETE CASCADE,
      assignment_id INTEGER REFERENCES rooming_assignments(id) ON DELETE SET NULL,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      member_kind TEXT NOT NULL CHECK(member_kind IN ('lodger','reservation')),
      member_ref_id INTEGER,
      member_name TEXT NOT NULL,
      member_gender TEXT,
      participant_identity TEXT,
      age_group TEXT,
      special_needs TEXT,
      suggested_bed_id INTEGER REFERENCES beds(id),
      queue_status TEXT DEFAULT '待办理' CHECK(queue_status IN ('待办理','已办理','已跳过')),
      processed_at TEXT,
      notes TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function migrateV18toV19() {
  const version =
    db.exec("SELECT MIN(version) as v FROM schema_version")[0]?.values[0][0] ||
    0;
  db.run("BEGIN TRANSACTION;");
  try {
    ensureLocalRoomingPublishSchema();
    if (version < 19) {
      db.run("DELETE FROM schema_version WHERE version < 19");
      db.run("INSERT OR REPLACE INTO schema_version (version) VALUES (19)");
    }
    db.run("COMMIT;");
  } catch (e) {
    try {
      db.run("ROLLBACK;");
    } catch (rollbackErr) {
      /* ignore */
    }
    throw new Error("migrateV18toV19 failed: " + e.message);
  }
}

function ensureLocalRoomingAdjustmentSchema() {
  db.run(`
    CREATE TABLE IF NOT EXISTS rooming_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      plan_id INTEGER REFERENCES rooming_plans(id) ON DELETE SET NULL,
      queue_id INTEGER REFERENCES rooming_checkin_queue(id) ON DELETE SET NULL,
      lodger_id INTEGER REFERENCES lodgers(id) ON DELETE SET NULL,
      adjustment_kind TEXT NOT NULL CHECK(adjustment_kind IN ('换床','跳过预分','手动备注','其他')),
      member_name TEXT,
      from_bed_id INTEGER REFERENCES beds(id),
      to_bed_id INTEGER REFERENCES beds(id),
      reason TEXT,
      operator TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function migrateV19toV20() {
  const version =
    db.exec("SELECT MIN(version) as v FROM schema_version")[0]?.values[0][0] ||
    0;
  db.run("BEGIN TRANSACTION;");
  try {
    ensureLocalRoomingAdjustmentSchema();
    if (version < 20) {
      db.run("DELETE FROM schema_version WHERE version < 20");
      db.run("INSERT OR REPLACE INTO schema_version (version) VALUES (20)");
    }
    db.run("COMMIT;");
  } catch (e) {
    try {
      db.run("ROLLBACK;");
    } catch (rollbackErr) {
      /* ignore */
    }
    throw new Error("migrateV19toV20 failed: " + e.message);
  }
}

var ROW_SYNC_TOUCH_TABLES = [
  "rooms",
  "beds",
  "guests",
  "events",
  "lodgers",
  "meals",
  "reservations",
  "payments",
  "housekeeping",
  "rooming_plans",
  "rooming_assignments",
  "rooming_checkin_queue",
  "rooming_adjustments",
];

function migrateV20toV21() {
  const version =
    db.exec("SELECT MIN(version) as v FROM schema_version")[0]?.values[0][0] ||
    0;
  if (version >= 21) return;
  db.run("BEGIN TRANSACTION;");
  try {
    ROW_SYNC_TOUCH_TABLES.forEach(function (table) {
      try {
        db.run(`ALTER TABLE ${table} ADD COLUMN updated_at TEXT`);
      } catch (e) {
        /* column may exist */
      }
    });
    db.run(
      "UPDATE guests SET updated_at = COALESCE(updated_at, created_at, datetime('now')) WHERE updated_at IS NULL OR updated_at = ''",
    );
    db.run(
      "UPDATE rooming_plans SET updated_at = COALESCE(updated_at, created_at, datetime('now')) WHERE updated_at IS NULL OR updated_at = ''",
    );
    ROW_SYNC_TOUCH_TABLES.forEach(function (table) {
      if (table === "guests" || table === "rooming_plans") return;
      var tsCol =
        table === "housekeeping"
          ? "COALESCE(changed_at, datetime('now'))"
          : table === "meals"
            ? "datetime('now')"
            : "COALESCE(created_at, datetime('now'))";
      db.run(
        `UPDATE ${table} SET updated_at = ${tsCol} WHERE updated_at IS NULL OR updated_at = ''`,
      );
      db.run(
        `CREATE INDEX IF NOT EXISTS idx_${table}_updated_at ON ${table}(updated_at)`,
      );
      db.run(
        `CREATE TRIGGER IF NOT EXISTS touch_${table}_updated_at AFTER UPDATE ON ${table} FOR EACH ROW WHEN OLD.updated_at IS NEW.updated_at OR NEW.updated_at IS NULL BEGIN UPDATE ${table} SET updated_at = datetime('now') WHERE id = NEW.id; END`,
      );
    });
    db.run("DELETE FROM schema_version WHERE version < 21");
    db.run("INSERT OR REPLACE INTO schema_version (version) VALUES (21)");
    db.run("COMMIT;");
  } catch (e) {
    try {
      db.run("ROLLBACK;");
    } catch (rollbackErr) {
      /* ignore */
    }
    throw new Error("migrateV20toV21 failed: " + e.message);
  }
}

function migrateV21toV22() {
  const version =
    db.exec("SELECT MIN(version) as v FROM schema_version")[0]?.values[0][0] ||
    0;
  if (version >= 22) return;
  db.run("BEGIN TRANSACTION;");
  try {
    ROW_SYNC_TOUCH_TABLES.forEach(function (table) {
      db.run(
        `UPDATE ${table} SET updated_at = substr(replace(replace(updated_at, 'T', ' '), 'Z', ''), 1, 19) WHERE updated_at LIKE '%T%'`,
      );
      db.run(
        `CREATE TRIGGER IF NOT EXISTS insert_${table}_updated_at AFTER INSERT ON ${table} FOR EACH ROW WHEN NEW.updated_at IS NULL OR NEW.updated_at = '' BEGIN UPDATE ${table} SET updated_at = datetime('now') WHERE id = NEW.id; END`,
      );
    });
    db.run("DELETE FROM schema_version WHERE version < 22");
    db.run("INSERT OR REPLACE INTO schema_version (version) VALUES (22)");
    db.run("COMMIT;");
  } catch (e) {
    try {
      db.run("ROLLBACK;");
    } catch (rollbackErr) {
      /* ignore */
    }
    throw new Error("migrateV21toV22 failed: " + e.message);
  }
}

function createIndexes() {
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_events_name ON events(name);
    CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
    CREATE INDEX IF NOT EXISTS idx_lodgers_guest_id ON lodgers(guest_id);
    CREATE INDEX IF NOT EXISTS idx_lodgers_event_id ON lodgers(event_id);
    CREATE INDEX IF NOT EXISTS idx_rooming_plans_event ON rooming_plans(event_id);
    CREATE INDEX IF NOT EXISTS idx_rooming_assignments_plan ON rooming_assignments(plan_id);
    CREATE INDEX IF NOT EXISTS idx_rooming_checkin_queue_event ON rooming_checkin_queue(event_id);
    CREATE INDEX IF NOT EXISTS idx_rooming_checkin_queue_plan ON rooming_checkin_queue(plan_id);
    CREATE INDEX IF NOT EXISTS idx_rooming_adjustments_event ON rooming_adjustments(event_id);
    CREATE INDEX IF NOT EXISTS idx_lodgers_bed_id ON lodgers(bed_id);
    CREATE INDEX IF NOT EXISTS idx_lodgers_status ON lodgers(status);
    CREATE INDEX IF NOT EXISTS idx_lodgers_dates ON lodgers(check_in_date, expected_check_out, actual_check_out);
    CREATE INDEX IF NOT EXISTS idx_reservations_guest_id ON reservations(guest_id);
    CREATE INDEX IF NOT EXISTS idx_reservations_event_id ON reservations(event_id);
    CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status);
    CREATE INDEX IF NOT EXISTS idx_reservations_checkin ON reservations(expected_check_in);
    CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_logs(target_type, target_id);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
  `);
}

async function seedRooms() {
  if (isRemoteDB()) return;
  const count =
    db.exec("SELECT COUNT(*) as c FROM rooms")[0]?.values[0][0] || 0;
  if (count > 0) return;
  for (let f = 1; f <= 2; f++) {
    for (let r = 1; r <= 6; r++) {
      const id = f * 100 + r;
      const name = `${f}0${r}`;
      const dorm = r <= 3 ? "男寮" : "女寮";
      run(
        "INSERT INTO rooms (id, name, location, floor, dorm_type, notes) VALUES (?, ?, ?, ?, ?, ?)",
        [id, name, "客堂" + f + "楼", f, dorm, ""],
      );
      for (let b = 1; b <= 2; b++) {
        run(
          "INSERT INTO beds (room_id, bed_number, status) VALUES (?, ?, '可用')",
          [id, b + "号床"],
        );
        const bedId = db.exec("SELECT last_insert_rowid() as id")[0]
          .values[0][0];
        run(
          "INSERT INTO housekeeping (bed_id, status, notes) VALUES (?, ?, '新床位初始化')",
          [bedId, "净房"],
        );
      }
    }
  }
  await saveDB();
}

// 将 params 数组中的 undefined 转为 null（sql.js 不接受 undefined）| Convert undefined to null in params (sql.js rejects undefined)
// 返回新数组，不修改原始数组 | Returns new array, does not mutate original

function safeParams(params) {
  if (!params || !Array.isArray(params)) return params;
  let hasUndefined = false;
  for (let i = 0; i < params.length; i++) {
    if (params[i] === undefined) {
      hasUndefined = true;
      break;
    }
  }
  if (!hasUndefined) return params;
  return params.map((p) => (p === undefined ? null : p));
}

function query(sql, params) {
  if (
    typeof useOnlineDataPath === "function" &&
    useOnlineDataPath() &&
    !_remoteHydrating
  ) {
    throw new Error(
      "在线模式不应调用 query()（caller: " +
        inferOnlineQueryCaller() +
        "）。请改用 rc* / read-shim。SQL: " +
        String(sql).slice(0, 120),
    );
  }
  if (!db || typeof db.prepare !== "function") return [];
  const stmt = db.prepare(sql);
  if (params) stmt.bind(safeParams(params));
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function run(sql, params) {
  if (
    typeof useOnlineDataPath === "function" &&
    useOnlineDataPath() &&
    !_remoteHydrating
  ) {
    throw new Error("在线模式请使用业务 API 写入");
  }
  const stmt = db.prepare(sql);
  stmt.run(safeParams(params));
  stmt.free();
  const result = db.exec("SELECT last_insert_rowid() as id");
  return { lastInsertId: result[0]?.values[0]?.[0] || 0 };
}

function summarizeLocalImportCounts() {
  return {
    rooms: query("SELECT COUNT(*) AS c FROM rooms")[0]?.c || 0,
    beds: query("SELECT COUNT(*) AS c FROM beds")[0]?.c || 0,
    lodgers: query("SELECT COUNT(*) AS c FROM lodgers")[0]?.c || 0,
    active_lodgers:
      query("SELECT COUNT(*) AS c FROM lodgers WHERE status = '在住'")[0]?.c ||
      0,
    guests: query("SELECT COUNT(*) AS c FROM guests")[0]?.c || 0,
  };
}

function formatImportSummary(summary) {
  if (!summary) return "数据恢复成功";
  return (
    "恢复成功：" +
    (summary.rooms != null ? `${summary.rooms} 间房间` : "") +
    (summary.beds != null ? `，${summary.beds} 张床位` : "") +
    (summary.active_lodgers != null ? `，${summary.active_lodgers} 人在住` : "")
  );
}

async function exportDB() {
  if (!requireBackupRead()) return;
  if (isRemoteDB()) {
    apiExportJsonBackup()
      .then(function (data) {
        const blob = new Blob([JSON.stringify(data, null, 2)], {
          type: "application/json;charset=utf-8",
        });
        downloadBlob(blob, "ketang-backup-" + todayStr() + ".json");
        localStorage.setItem("ketang_last_backup", todayStr());
        checkBackupReminder();
        showToast("已导出 JSON 备份");
      })
      .catch(async function (e) {
        await uiAlert("导出失败：" + e.message);
      });
    return;
  }
  const data = db.export();
  const blob = new Blob([data], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "ketang.db";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  localStorage.setItem("ketang_last_backup", todayStr());
  checkBackupReminder();
  showToast("已导出 ketang.db");
}

async function importDB(input) {
  if (!requireBackupWrite()) {
    input.value = "";
    return;
  }
  if (isRemoteDB()) {
    const file = input.files[0];
    if (!file) return;
    if (!(await uiConfirm("恢复备份会覆盖当前云端数据，是否继续？"))) {
      input.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data.tables) throw new Error("不是有效的客堂 JSON 备份");
        const result = await apiImportJsonBackup(data.tables);
        resetRemoteReadModelState();
        await syncRemoteReadModel({ force: true });
        await renderAll({ forceSync: true });
        showToast(formatImportSummary(result.summary));
      } catch (err) {
        await uiAlert("恢复失败：" + err.message);
      } finally {
        input.value = "";
      }
    };
    reader.readAsText(file);
    return;
  }
  const file = input.files[0];
  if (!file) return;
  if (!(await uiConfirm("恢复备份会覆盖当前数据，是否继续？"))) {
    input.value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      await ensureLocalSqlite();
      const arr = new Uint8Array(e.target.result);
      // 校验 SQLite 文件头
      const header = new TextDecoder().decode(arr.slice(0, 16));
      if (!header.startsWith("SQLite format 3\u0000")) {
        throw new Error("文件不是有效的 SQLite 数据库");
      }
      db = new SQL.Database(arr);
      // 确保 schema_version 及最新表结构存在（对极旧/损坏备份更健壮）
      initSchema();
      // 恢复旧备份后重新跑迁移，确保数据结构最新
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
      migrateV15toV16();
      migrateV16toV17();
      migrateV17toV18();
      migrateV18toV19();
      migrateV19toV20();
      migrateV20toV21();
      migrateV21toV22();
      createIndexes();
      await seedRooms();
      await saveDB();
      await renderAll();
      showToast(formatImportSummary(summarizeLocalImportCounts()));
    } catch (err) {
      await uiAlert("恢复失败：" + err.message);
    } finally {
      input.value = "";
    }
  };
  reader.readAsArrayBuffer(file);
}

async function confirmResetDatabase() {
  if (
    await uiConfirm({
      title: "重置数据库",
      message: "确定要重置所有数据吗？此操作不可恢复！",
      confirmText: "重置",
      danger: true,
    })
  ) {
    await resetDatabase();
  }
}

async function resetDatabase() {
  if (!requireAdmin()) {
    await uiAlert("需要管理员权限");
    return;
  }
  if (isRemoteDB()) {
    await uiAlert(
      "云端模式不允许从浏览器重置数据库；请在 Cloudflare D1 控制台执行维护操作。",
    );
    return;
  }
  // 彻底删除 IndexedDB 数据库（而非仅删记录）| Delete entire IndexedDB database (not just record)
  try {
    await new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = (e) => reject(e.target.error);
      req.onblocked = () =>
        console.warn(
          "数据库删除被阻塞，请关闭其他标签页 | Database deletion blocked, close other tabs",
        );
    });
  } catch (e) {
    console.warn("清除 IndexedDB 失败 | Clear IndexedDB failed:", e);
  }
  // 重建空数据库 | Recreate empty database
  db = new SQL.Database();
  initSchema();
  seedRooms();
  await saveDB();
  location.reload();
}
