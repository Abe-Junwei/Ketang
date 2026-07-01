const DEFAULT_WINDOW_SEC = 15 * 60;

export async function checkRateLimit(
  env,
  ip,
  bucket,
  maxCount,
  queryD1,
  runD1,
  windowSec = DEFAULT_WINDOW_SEC,
) {
  const key = `${bucket}:${ip}`;
  const now = Math.floor(Date.now() / 1000);
  const rows = await queryD1(
    "SELECT fail_count, window_start FROM login_attempts WHERE ip = ?",
    [key],
  );
  const row = rows[0];
  if (!row) return;
  if (now - row.window_start > windowSec) {
    await runD1("DELETE FROM login_attempts WHERE ip = ?", [key]);
    return;
  }
  if (row.fail_count >= maxCount) throw new Error("请求过于频繁，请稍后再试");
}

export async function recordRateLimitHit(
  env,
  ip,
  bucket,
  queryD1,
  runD1,
  windowSec = DEFAULT_WINDOW_SEC,
) {
  const key = `${bucket}:${ip}`;
  const now = Math.floor(Date.now() / 1000);
  const rows = await queryD1(
    "SELECT fail_count, window_start FROM login_attempts WHERE ip = ?",
    [key],
  );
  const row = rows[0];
  if (!row || now - row.window_start > windowSec) {
    await runD1(
      "INSERT INTO login_attempts (ip, fail_count, window_start) VALUES (?, 1, ?) ON CONFLICT(ip) DO UPDATE SET fail_count = 1, window_start = excluded.window_start",
      [key, now],
    );
    return;
  }
  await runD1(
    "UPDATE login_attempts SET fail_count = fail_count + 1 WHERE ip = ?",
    [key],
  );
}
