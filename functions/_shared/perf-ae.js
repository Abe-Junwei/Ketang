/** CF Analytics Engine + D1 探针观测 | Non-blocking perf probe observations (Phase G-4) */

import { storeProbeSample } from "./perf-probe-store.js";

function aeDataPoint(env, payload) {
  const ae = env.KETANG_AE || env.ANALYTICS;
  if (!ae || typeof ae.writeDataPoint !== "function") return null;
  return ae.writeDataPoint({
    blobs: [
      payload.endpoint || "unknown",
      payload.cf_colo || "",
      payload.request_id || "",
    ],
    doubles: [
      payload.external_ms || 0,
      payload.server_ms || 0,
      payload.network_gap_ms || 0,
      payload.bytes || 0,
    ],
    indexes: [payload.endpoint || "unknown"],
  });
}

/** 异步写入探针/服务端耗时 | Fire-and-forget probe timing (D1 + optional AE) */
export function recordPerfObservation(env, request, observation, waitUntil) {
  if (!observation || typeof observation !== "object") return;
  const payload = {
    endpoint: String(observation.endpoint || "unknown").slice(0, 64),
    external_ms:
      typeof observation.external_ms === "number"
        ? Math.round(observation.external_ms)
        : null,
    server_ms:
      typeof observation.server_ms === "number"
        ? Math.round(observation.server_ms)
        : null,
    network_gap_ms:
      typeof observation.network_gap_ms === "number"
        ? Math.round(observation.network_gap_ms)
        : null,
    bytes:
      typeof observation.bytes === "number" ? Math.round(observation.bytes) : null,
    cf_colo: request.cf?.colo || null,
    cf_ray: request.headers.get("cf-ray") || null,
    request_id: observation.request_id || null,
    server_timing: observation.server_timing || null,
    source: String(observation.source || "server").slice(0, 32),
  };

  const tasks = [];
  if (env.KETANG_DB) {
    tasks.push(storeProbeSample(env, payload));
  }
  const aeWrite = aeDataPoint(env, payload);
  if (aeWrite && typeof aeWrite.catch === "function") {
    tasks.push(aeWrite);
  }

  if (!tasks.length) return;
  const run = Promise.allSettled(tasks).then(function () {
    return undefined;
  });
  if (typeof waitUntil === "function") {
    waitUntil(run);
  } else {
    void run;
  }
}
