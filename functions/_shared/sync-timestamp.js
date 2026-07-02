/** 同步时间戳：统一 SQLite TEXT 字典序格式 | Sync timestamps for row-level delta */

/** 当前时刻，格式 YYYY-MM-DD HH:MM:SS（与 datetime('now') 一致） */
export function nowIso() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

/** 将 ISO / SQLite 时间戳规范为可比格式 | Normalize for updated_at comparison */
export function normalizeSyncTimestamp(value) {
  if (value == null || value === "") return nowIso();
  const text = String(value).trim();
  if (text.includes("T")) {
    return text.slice(0, 19).replace("T", " ").replace("Z", "");
  }
  return text.length >= 19 ? text.slice(0, 19) : text;
}
