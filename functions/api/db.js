const SCHEMA_SQL = `
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
  role TEXT NOT NULL CHECK(role IN ('admin','zhike')),
  password TEXT NOT NULL,
  is_active INTEGER DEFAULT 1 CHECK(is_active IN (0,1)),
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
CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);
INSERT INTO schema_version (version) SELECT 13 WHERE NOT EXISTS (SELECT 1 FROM schema_version);
CREATE INDEX IF NOT EXISTS idx_lodgers_status ON lodgers(status);
CREATE INDEX IF NOT EXISTS idx_lodgers_bed ON lodgers(bed_id);
CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status);
CREATE INDEX IF NOT EXISTS idx_meals_date ON meals(date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_lodger_per_bed ON lodgers(bed_id) WHERE status = '在住' AND bed_id IS NOT NULL;
`;

const SEED_ROOMS_SQL = [];
for (let floor = 1; floor <= 2; floor++) {
  for (let room = 1; room <= 6; room++) {
    const id = floor * 100 + room;
    const name = `${floor}0${room}`;
    const dorm = room <= 3 ? '男寮' : '女寮';
    SEED_ROOMS_SQL.push({ sql: 'INSERT INTO rooms (id, name, location, floor, dorm_type, notes) VALUES (?, ?, ?, ?, ?, ?)', params: [id, name, `客堂${floor}楼`, floor, dorm, ''] });
    for (let bed = 1; bed <= 2; bed++) {
      SEED_ROOMS_SQL.push({ sql: 'INSERT INTO beds (room_id, bed_number, status) VALUES (?, ?, ?)', params: [id, `${bed}号床`, '可用'] });
    }
  }
}

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' }
});

const normalizeParams = params => Array.isArray(params) ? params.map(value => value === undefined ? null : value) : [];

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length === 3 && parts[0] === 'sha256') {
    return await sha256Hex(parts[1] + password) === parts[2];
  }
  return stored === password;
}

function base64UrlEncode(value) {
  return btoa(typeof value === 'string' ? value : JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return atob(normalized);
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function assertSessionSecret(env) {
  if (!env.KETANG_SESSION_SECRET || env.KETANG_SESSION_SECRET.length < 32) {
    throw new Error('KETANG_SESSION_SECRET 必须至少 32 字符');
  }
}

async function signSession(env, user) {
  assertSessionSecret(env);
  const now = Math.floor(Date.now() / 1000);
  const payload = base64UrlEncode({ sub: user.id, username: user.username, role: user.role, iat: now, exp: now + 60 * 60 * 12 });
  const signature = await hmac(env.KETANG_SESSION_SECRET, payload);
  return `${payload}.${signature}`;
}

async function verifySession(request, env) {
  assertSessionSecret(env);
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = await hmac(env.KETANG_SESSION_SECRET, payload);
  if (signature !== expected) return null;
  const session = JSON.parse(base64UrlDecode(payload));
  if (!session.exp || session.exp < Math.floor(Date.now() / 1000)) return null;
  const users = await queryD1(env, 'SELECT id, username, role FROM users WHERE id = ? AND (is_active IS NULL OR is_active = 1) LIMIT 1', [session.sub]);
  return users[0] ? { ...session, role: users[0].role, username: users[0].username } : null;
}

function normalizeSql(sql) {
  const cleaned = String(sql || '').trim().replace(/;+\s*$/, '');
  if (!cleaned || cleaned.includes(';')) throw new Error('不允许执行多条 SQL');
  return cleaned;
}

function assertAllowedSql(action, sql, session) {
  const cleaned = normalizeSql(sql);
  const isQuery = action === 'query' || action === 'exec';
  const allowedStart = isQuery ? /^(SELECT|PRAGMA)\b/i : /^(INSERT|UPDATE|DELETE)\b/i;
  if (!allowedStart.test(cleaned)) throw new Error('不允许执行该类型 SQL');
  if (/\b(DROP|ALTER|CREATE|ATTACH|DETACH|REINDEX|VACUUM)\b/i.test(cleaned)) throw new Error('不允许执行结构变更 SQL');
  if (/\busers\b/i.test(cleaned) && session.role !== 'admin') throw new Error('需要管理员权限');
  return cleaned;
}

function safeErrorMessage(error) {
  const message = error?.message || String(error);
  if (/登录|权限|KETANG_|不允许|账号或密码|管理员/.test(message)) return message;
  if (/UNIQUE constraint failed: lodgers\.bed_id/.test(message)) return '该床位已有在住挂单，请刷新后重新选择床位';
  return '操作失败，请刷新后重试';
}

async function queryD1(env, sql, params) {
  const result = await env.KETANG_DB.prepare(sql).bind(...normalizeParams(params)).all();
  return result.results || [];
}

async function runD1(env, sql, params) {
  const result = await env.KETANG_DB.prepare(sql).bind(...normalizeParams(params)).run();
  return result.meta || {};
}

async function initRemoteDatabase(env) {
  await env.KETANG_DB.exec(SCHEMA_SQL);
  const count = await queryD1(env, 'SELECT COUNT(*) AS c FROM rooms', []);
  if ((count[0]?.c || 0) > 0) return;
  for (const item of SEED_ROOMS_SQL) await runD1(env, item.sql, item.params);
  const beds = await queryD1(env, 'SELECT id, status FROM beds ORDER BY id', []);
  for (const bed of beds) await runD1(env, 'INSERT INTO housekeeping (bed_id, status, notes) VALUES (?, ?, ?)', [bed.id, bed.status === '维修' ? '维修' : '净房', '云端初始化']);
}

async function requireSession(request, env) {
  const session = await verifySession(request, env);
  if (!session) throw new Error('登录已过期，请重新登录');
  return session;
}

export async function onRequestPost({ request, env }) {
  if (!env.KETANG_DB) return json({ error: '缺少 D1 绑定 KETANG_DB' }, 500);
  let payload;
  try {
    payload = await request.json();
  } catch (error) {
    return json({ error: '请求格式错误' }, 400);
  }

  try {
    if (payload.action === 'init') {
      await initRemoteDatabase(env);
      return json({ ok: true });
    }

    if (payload.action === 'users') {
      await initRemoteDatabase(env);
      const rows = await queryD1(env, 'SELECT id, username, display_name, role FROM users WHERE is_active IS NULL OR is_active = 1 ORDER BY role, username', []);
      return json({ rows });
    }

    if (payload.action === 'login') {
      await initRemoteDatabase(env);
      const rows = await queryD1(env, 'SELECT * FROM users WHERE username = ? AND (is_active IS NULL OR is_active = 1) LIMIT 1', [payload.username]);
      const user = rows[0];
      if (!user || !(await verifyPassword(payload.password || '', user.password))) return json({ error: '账号或密码错误' }, 401);
      const token = await signSession(env, user);
      return json({ token, user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role } });
    }

    const session = await requireSession(request, env);

    if (payload.action === 'query') {
      const sql = assertAllowedSql('query', payload.sql, session);
      const rows = await queryD1(env, sql, payload.params || []);
      return json({ rows });
    }

    if (payload.action === 'run') {
      const sql = assertAllowedSql('run', payload.sql, session);
      const meta = await runD1(env, sql, payload.params || []);
      return json({ meta });
    }

    if (payload.action === 'exec') {
      const sql = assertAllowedSql('exec', payload.sql, session);
      const rows = await queryD1(env, sql, payload.params || []);
      const columns = rows[0] ? Object.keys(rows[0]) : [];
      return json({ result: [{ columns, values: rows.map(row => columns.map(column => row[column])) }] });
    }

    return json({ error: '未知操作' }, 400);
  } catch (error) {
    console.error('Ketang API error:', error);
    return json({ error: safeErrorMessage(error) }, 500);
  }
}