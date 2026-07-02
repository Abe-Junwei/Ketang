export const SCHEMA_SQL = `
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
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
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
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
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
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
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
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS meals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lodger_id INTEGER NOT NULL REFERENCES lodgers(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  breakfast INTEGER DEFAULT 0 CHECK(breakfast IN (0,1)),
  lunch INTEGER DEFAULT 0 CHECK(lunch IN (0,1)),
  dinner INTEGER DEFAULT 0 CHECK(dinner IN (0,1)),
  notes TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
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
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
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
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS rooming_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
  name TEXT,
  status TEXT DEFAULT '未确认' CHECK(status IN ('未确认','待调整','已确认')),
  notes TEXT,
  published_at TEXT,
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
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
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
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
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
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS housekeeping (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bed_id INTEGER NOT NULL REFERENCES beds(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('脏房','净房','查房','可用','占用','维修')),
  operator TEXT,
  changed_at TEXT DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
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
INSERT INTO schema_version (version) SELECT 21 WHERE NOT EXISTS (SELECT 1 FROM schema_version);
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
