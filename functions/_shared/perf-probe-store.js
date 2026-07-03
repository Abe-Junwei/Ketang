import { checkMemoryRateLimit, clientIp } from "./http.js";
import { runD1 } from "./d1.js";

const PERF_PROBE_DDL = `
CREATE TABLE IF NOT EXISTS perf_probe_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  endpoint TEXT NOT NULL,
  source TEXT,
  cf_colo TEXT,
  cf_ray TEXT,
  request_id TEXT,
  external_ms INTEGER,
  server_ms INTEGER,
  network_gap_ms INTEGER,
  bytes INTEGER,
  timing_json TEXT
)`;

let _probeTableReady = false;

async function ensureProbeTable(env) {
  if (_probeTableReady) return;
  await runD1(env, PERF_PROBE_DDL.trim());
  _probeTableReady = true;
}

/** 写入合成探针/服务端观测 | Persist probe timing sample */
export async function storeProbeSample(env, payload) {
  if (!env.KETANG_DB) return { ok: false };
  await ensureProbeTable(env);
  await runD1(
    env,
    `INSERT INTO perf_probe_samples
      (endpoint, source, cf_colo, cf_ray, request_id, external_ms, server_ms, network_gap_ms, bytes, timing_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.endpoint,
      payload.source || null,
      payload.cf_colo || null,
      payload.cf_ray || null,
      payload.request_id || null,
      payload.external_ms,
      payload.server_ms,
      payload.network_gap_ms,
      payload.bytes,
      payload.server_timing ? JSON.stringify(payload.server_timing) : null,
    ],
  );
  return { ok: true };
}

/** 批量写入探针结果 | Batch ingest from test_prod_latency.py */
export async function storeProbeBatch(env, request, body) {
  const ip = clientIp(request);
  checkMemoryRateLimit(ip, "perf_probe", 30, 60 * 1000);
  const rows = Array.isArray(body?.samples) ? body.samples : [];
  if (!rows.length) throw new Error("samples 为空");
  await ensureProbeTable(env);
  for (const row of rows.slice(0, 50)) {
    if (!row || !row.endpoint) continue;
    await storeProbeSample(env, row);
  }
  return { ok: true, count: Math.min(rows.length, 50) };
}
