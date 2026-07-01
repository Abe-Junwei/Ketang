export const SCHEMA_SQL = `
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
CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);
INSERT INTO schema_version (version) SELECT 14 WHERE NOT EXISTS (SELECT 1 FROM schema_version);
CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO app_meta (key, value) VALUES ('board_version', '0');
CREATE TABLE IF NOT EXISTS login_attempts (
  ip TEXT PRIMARY KEY,
  fail_count INTEGER DEFAULT 0,
  window_start INTEGER NOT NULL
);
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
CREATE INDEX IF NOT EXISTS idx_meals_date ON meals(date);
CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_logs(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
`;

/** 部分环境 D1 对 partial unique index 支持不稳定，单独执行 | Apply partial index separately */
export const LODGER_BED_UNIQUE_INDEX_SQL = `CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_lodger_per_bed ON lodgers(bed_id) WHERE status = '在住' AND bed_id IS NOT NULL`;

export const DEFAULT_USER_INSERTS = [
  [
    "admin",
    "管理员",
    "admin",
    "sha256$ketang_default_salt$8d62959035f9b60a02e709f9826f3f996d07a09a4f5091e2884642fa01adf8a3",
  ],
  [
    "zhike",
    "知客师",
    "zhike",
    "sha256$ketang_default_salt$fc286955fb12bec3fb16b4f2619f9b675337b1240537bc21d830b5f495121565",
  ],
];

export const SEED_ROOMS = [];
for (let floor = 1; floor <= 2; floor++) {
  for (let room = 1; room <= 6; room++) {
    const id = floor * 100 + room;
    const name = `${floor}0${room}`;
    const dorm = room <= 3 ? "男寮" : "女寮";
    SEED_ROOMS.push({
      sql: "INSERT INTO rooms (id, name, location, floor, dorm_type, notes) VALUES (?, ?, ?, ?, ?, ?)",
      params: [id, name, `客堂${floor}楼`, floor, dorm, ""],
    });
    for (let bed = 1; bed <= 2; bed++) {
      SEED_ROOMS.push({
        sql: "INSERT INTO beds (room_id, bed_number, status) VALUES (?, ?, ?)",
        params: [id, `${bed}号床`, "可用"],
      });
    }
  }
}

const DEFAULT_PASSWORD_HASHES = new Set([
  "sha256$ketang_default_salt$8d62959035f9b60a02e709f9826f3f996d07a09a4f5091e2884642fa01adf8a3",
  "sha256$ketang_default_salt$fc286955fb12bec3fb16b4f2619f9b675337b1240537bc21d830b5f495121565",
]);

export function isDefaultPasswordHash(hash) {
  return DEFAULT_PASSWORD_HASHES.has(String(hash || ""));
}
