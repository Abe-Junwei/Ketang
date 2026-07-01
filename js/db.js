let SQL, db;
const DB_NAME = "ketang";
const STORE_NAME = "db";
const KEY = "main";
const REMOTE_SESSION_KEY = "ketang_remote_session_token";
const REMOTE_DB_ENABLED = (() => {
  if (typeof window === "undefined" || !window.location) return false;
  if (window.KETANG_FORCE_LOCAL_DB === true) return false;
  if (window.KETANG_REMOTE_DB === true) return true;
  const host = window.location.hostname;
  return (
    window.location.protocol === "https:" &&
    host !== "localhost" &&
    host !== "127.0.0.1"
  );
})();

let remoteLastInsertId = 0;

function isRemoteDB() {
  return REMOTE_DB_ENABLED;
}

function getRemoteSessionToken() {
  return localStorage.getItem(REMOTE_SESSION_KEY) || "";
}

function setRemoteSessionToken(token) {
  if (token) localStorage.setItem(REMOTE_SESSION_KEY, token);
  else localStorage.removeItem(REMOTE_SESSION_KEY);
}

function remoteDBRequest(payload, options) {
  const xhr = new XMLHttpRequest();
  xhr.open("POST", "/api/db", false);
  xhr.setRequestHeader("Content-Type", "application/json");
  const token = getRemoteSessionToken();
  if (token) xhr.setRequestHeader("Authorization", "Bearer " + token);
  xhr.send(JSON.stringify(payload));
  let body = {};
  try {
    body = JSON.parse(xhr.responseText || "{}");
  } catch (e) {
    body = {};
  }
  if (xhr.status < 200 || xhr.status >= 300) {
    if (xhr.status === 401 && typeof handleApiUnauthorized === "function")
      handleApiUnauthorized();
    throw new Error(body.error || "云端数据库请求失败");
  }
  return body;
}

function remoteQuery(sql, params) {
  return remoteDBRequest({ action: "query", sql, params }).rows || [];
}

function remoteRun(sql, params) {
  const meta = remoteDBRequest({ action: "run", sql, params }).meta || {};
  remoteLastInsertId = meta.last_row_id || meta.lastRowId || remoteLastInsertId;
  return { lastInsertId: remoteLastInsertId, meta };
}

function remoteExec(sql) {
  if (/last_insert_rowid\s*\(/i.test(sql)) {
    return [{ columns: ["id"], values: [[remoteLastInsertId]] }];
  }
  return remoteDBRequest({ action: "exec", sql }).result || [];
}

function remoteLogin(username, password) {
  const result = remoteDBRequest({ action: "login", username, password });
  setRemoteSessionToken(result.token);
  return {
    user: result.user,
    must_change_password: !!result.must_change_password,
  };
}

async function remoteLoginAsync(username, password) {
  const result = await remoteDBRequestAsync({
    action: "login",
    username,
    password,
  });
  setRemoteSessionToken(result.token);
  return {
    user: result.user,
    must_change_password: !!result.must_change_password,
  };
}

function remoteLogout() {
  setRemoteSessionToken("");
}

function remoteListLoginUsers() {
  return remoteDBRequest({ action: "users" }).rows || [];
}

async function initSqlite() {
  if (isRemoteDB()) return;
  const wasmPath = "./lib/sql-wasm.wasm";
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

async function loadDB() {
  if (isRemoteDB()) {
    try {
      remoteDBRequest({ action: "init" });
    } catch (e) {
      // 兼容旧版后端：已初始化时 init 可能返回 403 | tolerate legacy init 403
      if (!/已初始化|403/.test(String(e.message))) throw e;
    }
    db = { remote: true, exec: remoteExec, run: remoteRun };
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
    alert(
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
  if (isRemoteDB()) return;
  db.run(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      location TEXT,
      floor INTEGER DEFAULT 1,
      dorm_type TEXT DEFAULT '不限' CHECK(dorm_type IN ('男寮','女寮','不限')),
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS beds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      bed_number TEXT NOT NULL,
      status TEXT DEFAULT '可用' CHECK(status IN ('可用','占用','维修','备用')),
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

function createIndexes() {
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_events_name ON events(name);
    CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
    CREATE INDEX IF NOT EXISTS idx_lodgers_guest_id ON lodgers(guest_id);
    CREATE INDEX IF NOT EXISTS idx_lodgers_event_id ON lodgers(event_id);
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
  if (isRemoteDB()) return remoteQuery(sql, params);
  const stmt = db.prepare(sql);
  if (params) stmt.bind(safeParams(params));
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function run(sql, params) {
  if (isRemoteDB()) return remoteRun(sql, params);
  const stmt = db.prepare(sql);
  stmt.run(safeParams(params));
  stmt.free();
  const result = db.exec("SELECT last_insert_rowid() as id");
  return { lastInsertId: result[0]?.values[0]?.[0] || 0 };
}

function exportDB() {
  if (!requireAdmin()) {
    alert("需要管理员权限");
    return;
  }
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
      .catch(function (e) {
        alert("导出失败：" + e.message);
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
  if (!requireAdmin()) {
    alert("需要管理员权限");
    input.value = "";
    return;
  }
  if (isRemoteDB()) {
    const file = input.files[0];
    if (!file) return;
    if (!confirm("恢复备份会覆盖当前云端数据，是否继续？")) {
      input.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data.tables) throw new Error("不是有效的客堂 JSON 备份");
        await apiImportJsonBackup(data.tables);
        showToast("云端数据恢复成功");
        renderAll();
      } catch (err) {
        alert("恢复失败：" + err.message);
      } finally {
        input.value = "";
      }
    };
    reader.readAsText(file);
    return;
  }
  const file = input.files[0];
  if (!file) return;
  if (!confirm("恢复备份会覆盖当前数据，是否继续？")) {
    input.value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
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
      createIndexes();
      await seedRooms();
      await saveDB();
      renderAll();
      showToast("数据恢复成功");
    } catch (err) {
      alert("恢复失败：" + err.message);
    } finally {
      input.value = "";
    }
  };
  reader.readAsArrayBuffer(file);
}

async function resetDatabase() {
  if (!requireAdmin()) {
    alert("需要管理员权限");
    return;
  }
  if (isRemoteDB()) {
    alert(
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
