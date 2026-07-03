/** Phase E: rate-limit.js integration (mock D1) | Run: node test_rate_limit_runner.mjs */
import { checkRateLimit, recordRateLimitHit } from "./functions/_shared/rate-limit.js";

const store = new Map();

async function queryD1(sql, params) {
  const key = params[0];
  if (sql.includes("SELECT")) {
    const row = store.get(key);
    return row ? [{ fail_count: row.fail_count, window_start: row.window_start }] : [];
  }
  return [];
}

async function runD1(sql, params) {
  const key = params[0];
  if (sql.includes("DELETE")) {
    store.delete(key);
    return;
  }
  if (sql.includes("INSERT")) {
    store.set(key, { fail_count: 1, window_start: params[1] });
    return;
  }
  if (sql.includes("UPDATE")) {
    const row = store.get(key);
    if (row) row.fail_count += 1;
  }
}

const env = {};
const ip = "203.0.113.10";
const bucket = "public_resv";
const max = 20;
const windowSec = 900;
const key = `${bucket}:${ip}`;

for (let i = 0; i < max; i++) {
  await checkRateLimit(env, ip, bucket, max, queryD1, runD1, windowSec);
  await recordRateLimitHit(env, ip, bucket, queryD1, runD1, windowSec);
}

const countAfterMax = store.get(key)?.fail_count;
if (countAfterMax !== max) {
  console.error("FAIL: expected fail_count", max, "got", countAfterMax);
  process.exit(1);
}

try {
  await checkRateLimit(env, ip, bucket, max, queryD1, runD1, windowSec);
  console.error("FAIL: 21st checkRateLimit should throw");
  process.exit(1);
} catch (e) {
  if (!/过于频繁/.test(e.message)) {
    console.error("FAIL: unexpected error:", e.message);
    process.exit(1);
  }
}

store.clear();
await checkRateLimit(env, ip, bucket, max, queryD1, runD1, windowSec);
await recordRateLimitHit(env, ip, bucket, queryD1, runD1, windowSec);
if ((store.get(key)?.fail_count || 0) !== 1) {
  console.error("FAIL: fresh window should start at 1");
  process.exit(1);
}

console.log("PASS: rate limit blocks after max hits and resets window");
