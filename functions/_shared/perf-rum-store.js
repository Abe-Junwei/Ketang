import { checkMemoryRateLimit, clientIp } from "./http.js";
import { queryD1, runD1 } from "./d1.js";

const PERF_RUM_DDL = `
CREATE TABLE IF NOT EXISTS perf_rum_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  role TEXT,
  page TEXT,
  app_version TEXT,
  reason TEXT,
  cf_colo TEXT,
  metrics_json TEXT NOT NULL,
  network_json TEXT,
  resources_json TEXT
)`;

const ALLOWED_METRIC_KEYS = new Set([
  "first_view_ready_ms",
  "login_ready_ms",
  "login_ms",
  "read_board_ms",
  "rc_bootstrap_ms",
  "rc_deferred_ms",
  "write_refresh_ms",
  "render_board_ms",
  "render_rooms_ms",
  "render_all_ms",
  "app_ready_ms",
  "long_task_max_ms",
  "lcp_ms",
  "fcp_ms",
  "dom_content_loaded_ms",
  "load_event_ms",
]);

let _perfRumTableReady = false;

async function ensurePerfRumTable(env) {
  if (_perfRumTableReady) return;
  await runD1(env, PERF_RUM_DDL.trim());
  _perfRumTableReady = true;
}

function sanitizeMetrics(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  Object.keys(raw).forEach(function (key) {
    if (!ALLOWED_METRIC_KEYS.has(key)) return;
    const val = raw[key];
    if (typeof val === "number" && Number.isFinite(val) && val >= 0 && val <= 600000) {
      out[key] = Math.round(val);
    }
  });
  return out;
}

function sanitizeNetwork(raw) {
  if (!raw || typeof raw !== "object") return null;
  const out = {};
  ["effectiveType", "rtt", "downlink", "saveData"].forEach(function (key) {
    if (raw[key] != null) out[key] = raw[key];
  });
  return Object.keys(out).length ? out : null;
}

function sanitizeResources(raw) {
  if (!Array.isArray(raw)) return null;
  return raw
    .slice(0, 30)
    .map(function (item) {
      if (!item || typeof item !== "object") return null;
      const name = String(item.name || "").slice(0, 200);
      if (!name.startsWith("/api/v1/")) return null;
      return {
        name,
        duration_ms: Math.min(600000, Math.max(0, Math.round(Number(item.duration_ms) || 0))),
        transfer_size: Math.max(0, Math.round(Number(item.transfer_size) || 0)),
        ttfb_ms: Math.min(600000, Math.max(0, Math.round(Number(item.ttfb_ms) || 0))),
        download_ms: Math.min(
          600000,
          Math.max(0, Math.round(Number(item.download_ms) || 0)),
        ),
      };
    })
    .filter(Boolean);
}

/** 写入 RUM 样本 | Persist browser perf sample (no PII) */
export async function storePerfRumSample(env, request, body, session) {
  if (!env.KETANG_DB) throw new Error("缺少 D1 绑定 KETANG_DB");
  const ip = clientIp(request);
  checkMemoryRateLimit(ip, "perf_rum", 120, 60 * 1000);

  const metrics = sanitizeMetrics(body.metrics);
  if (!Object.keys(metrics).length) {
    throw new Error("metrics 为空或无效");
  }

  const role =
    session?.role ||
    (body.role && /^[a-z_]+$/.test(String(body.role)) ? String(body.role) : null);
  const page = String(body.page || "board").slice(0, 40);
  const appVersion = String(body.appVersion || body.app_version || "unknown").slice(0, 64);
  const reason = String(body.reason || "report").slice(0, 40);
  const cfColo = request.cf?.colo || request.headers.get("cf-ray")?.split("-").pop() || null;

  await ensurePerfRumTable(env);
  await runD1(
    env,
    `INSERT INTO perf_rum_samples
      (role, page, app_version, reason, cf_colo, metrics_json, network_json, resources_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      role,
      page,
      appVersion,
      reason,
      cfColo,
      JSON.stringify(metrics),
      sanitizeNetwork(body.network) ? JSON.stringify(sanitizeNetwork(body.network)) : null,
      sanitizeResources(body.resources)
        ? JSON.stringify(sanitizeResources(body.resources))
        : null,
    ],
  );
  return { ok: true };
}

/** 聚合最近样本 | Aggregate recent RUM samples (ops/debug) */
export async function aggregatePerfRum(env, metricKey, limit) {
  await ensurePerfRumTable(env);
  const rows = await queryD1(
    env,
    `SELECT metrics_json FROM perf_rum_samples
     ORDER BY id DESC LIMIT ?`,
    [Math.min(Math.max(limit || 100, 1), 500)],
  );
  const values = [];
  rows.forEach(function (row) {
    try {
      const metrics = JSON.parse(row.metrics_json || "{}");
      const val = metrics[metricKey];
      if (typeof val === "number") values.push(val);
    } catch (e) {
      /* skip */
    }
  });
  return values;
}
