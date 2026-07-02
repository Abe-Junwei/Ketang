function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** 展示用姓名（合并 name + dharma_name）| Display name from lodger/guest row */
function personDisplayName(row) {
  if (!row) return "";
  const name = (row.name || "").trim();
  const dharma = (row.dharma_name || "").trim();
  if (name && dharma && name !== dharma) return name + " " + dharma;
  return name || dharma || "";
}

/** 表单回填：单字段显示 | Single input value for edit forms */
function personNameInputValue(row) {
  return personDisplayName(row);
}

/** 单字段录入 → 存 name，dharma_name 置空 | Parse single name field for storage */
function parsePersonNameInput(value) {
  const v = (value || "").trim();
  return { name: v, dharma_name: null };
}

/** CSV 等仍分列时合并 | Merge legacy CSV name + dharma columns */
function mergePersonNameFields(name, dharma) {
  const parts = [(name || "").trim(), (dharma || "").trim()].filter(Boolean);
  const unique = [];
  parts.forEach(function (p) {
    if (unique.indexOf(p) < 0) unique.push(p);
  });
  return parsePersonNameInput(unique.join(" "));
}

function infoEscape(s) {
  return escapeHtml(s || "");
}

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.style.display = "block";
  setTimeout(() => (t.style.display = "none"), 2500);
}

// 主题切换 | Theme toggle

function getTheme() {
  return document.documentElement.getAttribute("data-theme") || "light";
}
function setTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  try {
    localStorage.setItem("ketang-theme", t);
  } catch (e) {
    /* ignore */
  }
}
function toggleTheme() {
  setTheme(getTheme() === "dark" ? "light" : "dark");
}
// 初始化主题 | Init theme — 默认亮色（宣纸墨韵），仅用户手动切换后才记暗色
(function initTheme() {
  try {
    const saved = localStorage.getItem("ketang-theme");
    if (saved === "dark") setTheme("dark");
  } catch (e) {
    /* ignore */
  }
})();

function formatLocalDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}

function todayStr() {
  return formatLocalDate(new Date());
}

function dateStr(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return formatLocalDate(d);
}

function csvCell(v) {
  let s = String(v == null ? "" : v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

/** 挂单身份规范名（统计排序 / 表单 / 展示统一） */
const LODGER_ROLE_OPTIONS = [
  "法师",
  "沙弥",
  "行者",
  "老师",
  "管理员",
  "义工",
  "营务",
  "学员",
  "客人",
  "工人",
];

const LODGER_ROLE_ALIASES = {
  沙弥师: "沙弥",
  师资: "老师",
  后勤义工: "义工",
  项目义工: "营务",
  禅营: "学员",
  修道班: "学员",
  访客: "客人",
};

function lodgerRoleCanon(role) {
  const raw = (role || "").trim();
  if (!raw) return "未分类";
  const mapped = LODGER_ROLE_ALIASES[raw] || raw;
  return LODGER_ROLE_OPTIONS.indexOf(mapped) >= 0 ? mapped : raw;
}

function lodgerRoleDisplayName(role) {
  return lodgerRoleCanon(role);
}

function lodgerRoleSortIndex(role) {
  const canon = lodgerRoleCanon(role);
  const idx = LODGER_ROLE_OPTIONS.indexOf(canon);
  if (idx >= 0) return idx;
  return canon === "未分类"
    ? LODGER_ROLE_OPTIONS.length + 1
    : LODGER_ROLE_OPTIONS.length;
}

function compareLodgerRoles(a, b) {
  const roleA = typeof a === "string" ? a : a.role || "未分类";
  const roleB = typeof b === "string" ? b : b.role || "未分类";
  const diff = lodgerRoleSortIndex(roleA) - lodgerRoleSortIndex(roleB);
  if (diff !== 0) return diff;
  return lodgerRoleDisplayName(roleA).localeCompare(
    lodgerRoleDisplayName(roleB),
    "zh-CN",
  );
}

function lodgerRoleMatchValues(filterRole) {
  if (!filterRole) return [];
  const canon = lodgerRoleCanon(filterRole);
  const vals = [canon, filterRole];
  Object.keys(LODGER_ROLE_ALIASES).forEach(function (k) {
    if (LODGER_ROLE_ALIASES[k] === canon) vals.push(k);
  });
  return [...new Set(vals)];
}

function roleSelectOptionsHtml(selectedValue, emptyLabel) {
  const showEmpty = emptyLabel !== false;
  const label = showEmpty ? emptyLabel || "请选择" : "";
  let html = showEmpty
    ? '<option value="">' + escapeHtml(label) + "</option>"
    : "";
  const canon = selectedValue ? lodgerRoleCanon(selectedValue) : "";
  LODGER_ROLE_OPTIONS.forEach(function (role) {
    const sel = selectedValue === role || canon === role ? " selected" : "";
    html +=
      '<option value="' +
      escapeHtml(role) +
      '"' +
      sel +
      ">" +
      escapeHtml(role) +
      "</option>";
  });
  if (
    selectedValue &&
    !LODGER_ROLE_OPTIONS.includes(selectedValue) &&
    lodgerRoleCanon(selectedValue) === selectedValue
  ) {
    html +=
      '<option value="' +
      escapeHtml(selectedValue) +
      '" selected>' +
      escapeHtml(selectedValue) +
      "（旧）</option>";
  }
  return html;
}

function mountLodgerRoleSelects(root) {
  root = root || document;
  root.querySelectorAll(".lodger-role-select").forEach(function (sel) {
    const attr = sel.getAttribute("data-empty-label");
    const emptyLabel = attr === "none" ? false : attr != null ? attr : "请选择";
    const selected = sel.value || sel.getAttribute("data-selected") || "";
    sel.innerHTML = roleSelectOptionsHtml(selected, emptyLabel);
    if (typeof rebuildSelectPicker === "function") rebuildSelectPicker(sel);
  });
}

function readLodgerRoleInput(elementId) {
  const raw = document.getElementById(elementId)?.value?.trim();
  if (!raw) return null;
  const canon = lodgerRoleCanon(raw);
  return canon === "未分类" ? null : canon;
}

function dormMatchGender(dormType, gender) {
  if (!dormType || dormType === "不限") return true;
  if (!gender) return true;
  const maleTypes = ["男", "男众"];
  const femaleTypes = ["女", "女众"];
  if (dormType === "男寮" && !maleTypes.includes(gender)) return false;
  if (dormType === "女寮" && !femaleTypes.includes(gender)) return false;
  return true;
}

/** 备用床房间（不参与房态展示与床位统计）| Spare room — excluded from board/lodging */
function isSpareRoom(room) {
  if (!room) return false;
  const loc = String(room.location || "").trim();
  let name = String(room.name || "").trim();
  if (loc.indexOf("备用") === 0 || loc.indexOf("备用床") >= 0) return true;
  if (name.indexOf("备用") === 0 || name.indexOf("备用床") >= 0) return true;
  return false;
}

/** SQL 片段：排除备用床房间 | SQL fragment to exclude spare rooms */
function spareRoomExcludeClause(alias) {
  alias = alias || "r";
  return (
    "(COALESCE(" +
    alias +
    ".location, '') NOT LIKE '备用%' AND COALESCE(" +
    alias +
    ".location, '') NOT LIKE '%备用床%' AND COALESCE(" +
    alias +
    ".name, '') NOT LIKE '备用%')"
  );
}

function sanitizeFilename(name) {
  return (
    String(name == null ? "" : name)
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/[\r\n\t]/g, " ")
      .trim() || "untitled"
  );
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ============================================================
   密码哈希 | Password hashing
   使用 SHA-256 + 随机盐。本地 file:// 部署下 Web Crypto 的
   SubtleCrypto 通常不可用，因此提供纯 JS 实现。
   ============================================================ */

function sha256(message) {
  const encoder = new TextEncoder();
  const data = encoder.encode(String(message));

  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  const rotr = (n, x) => (x >>> n) | (x << (32 - n));
  const toHex = (n) => ("00000000" + n.toString(16)).slice(-8);

  const bitLen = data.length * 8;
  const padLen = Math.ceil((data.length + 9) / 64) * 64;
  const padded = new Uint8Array(padLen);
  padded.set(data);
  padded[data.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padLen - 4, bitLen, false);

  let h0 = 0x6a09e667,
    h1 = 0xbb67ae85,
    h2 = 0x3c6ef372,
    h3 = 0xa54ff53a;
  let h4 = 0x510e527f,
    h5 = 0x9b05688c,
    h6 = 0x1f83d9ab,
    h7 = 0x5be0cd19;

  for (let i = 0; i < padLen; i += 64) {
    const w = new Uint32Array(64);
    for (let t = 0; t < 16; t++) w[t] = dv.getUint32(i + t * 4, false);
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(7, w[t - 15]) ^ rotr(18, w[t - 15]) ^ (w[t - 15] >>> 3);
      const s1 = rotr(17, w[t - 2]) ^ rotr(19, w[t - 2]) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let a = h0,
      b = h1,
      c = h2,
      d = h3,
      e = h4,
      f = h5,
      g = h6,
      h = h7;
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
      const S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }
  return (
    toHex(h0) +
    toHex(h1) +
    toHex(h2) +
    toHex(h3) +
    toHex(h4) +
    toHex(h5) +
    toHex(h6) +
    toHex(h7)
  );
}

function generateSalt(len) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let salt = "";
  const cryptoObj = window.crypto || window.msCrypto;
  if (cryptoObj && cryptoObj.getRandomValues) {
    const buf = new Uint32Array(len);
    cryptoObj.getRandomValues(buf);
    for (let i = 0; i < len; i++) salt += chars[buf[i] % chars.length];
  } else {
    for (let i = 0; i < len; i++)
      salt += chars[Math.floor(Math.random() * chars.length)];
  }
  return salt;
}

const PBKDF2_ITERATIONS = 600000;

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex) {
  const value = String(hex || "");
  const out = new Uint8Array(value.length / 2);
  for (let i = 0; i < out.length; i++)
    out[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function pbkdf2Sha256(password, saltBytes, iterations) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations: iterations,
      hash: "SHA-256",
    },
    key,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

function hashPassword(password) {
  const salt = generateSalt(16);
  const hash = sha256(salt + password);
  return `sha256$${salt}$${hash}`;
}

async function hashPasswordAsync(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2Sha256(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToHex(salt)}$${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  if (stored.startsWith("sha256$")) {
    const parts = stored.split("$");
    if (parts.length !== 3) return false;
    const [, salt, hash] = parts;
    return sha256(salt + password) === hash;
  }
  return stored === password;
}

async function verifyPasswordAsync(password, stored) {
  if (!stored) return false;
  const parts = String(stored).split("$");
  if (parts[0] === "pbkdf2" && parts.length === 4) {
    const iterations = parseInt(parts[1], 10);
    if (!iterations || iterations < 100000) return false;
    const hash = await pbkdf2Sha256(password, hexToBytes(parts[2]), iterations);
    return hash === parts[3];
  }
  return verifyPassword(password, stored);
}

function isLegacySha256Hash(stored) {
  return String(stored || "").startsWith("sha256$");
}

async function upgradePasswordHashIfLegacy(userId, password, storedHash) {
  if (!isLegacySha256Hash(storedHash)) return storedHash;
  const hash = await hashPasswordAsync(password);
  run("UPDATE users SET password = ? WHERE id = ?", [hash, userId]);
  return hash;
}

function bumpLocalAuthVersion(userId) {
  run(
    "UPDATE users SET auth_version = COALESCE(auth_version, 1) + 1 WHERE id = ?",
    [userId],
  );
  return (
    query("SELECT auth_version FROM users WHERE id = ?", [userId])[0]
      ?.auth_version || 1
  );
}

function validateUsername(username) {
  const value = String(username || "").trim();
  if (!/^[a-zA-Z][a-zA-Z0-9_]{2,19}$/.test(value)) {
    throw new Error("账号须 3-20 位，字母开头，仅含字母、数字、下划线");
  }
  return value;
}

function validateNewPassword(password, oldPassword) {
  const value = String(password || "");
  if (value.length < 6) throw new Error("密码至少 6 位");
  if (oldPassword != null && value === String(oldPassword))
    throw new Error("新密码不能与原密码相同");
  if (["admin", "zhike", "123456", "password", "111111"].includes(value)) {
    throw new Error("不能使用过于简单的密码");
  }
  return value;
}

function countActiveAdmins(excludeId) {
  const excluded = parseInt(excludeId || 0, 10);
  if (typeof useRemoteAdminUsers === "function" && useRemoteAdminUsers()) {
    return (
      (typeof cachedAdminUsers !== "undefined" ? cachedAdminUsers : []).filter(
        function (u) {
          return u.role === "admin" && u.is_active !== 0 && u.id !== excluded;
        },
      ).length || 0
    );
  }
  return (
    query(
      "SELECT COUNT(*) as c FROM users WHERE role='admin' AND (is_active IS NULL OR is_active = 1) AND id != ?",
      [excludeId || 0],
    )[0]?.c || 0
  );
}
