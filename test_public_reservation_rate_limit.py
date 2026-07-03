#!/usr/bin/env python3
"""Phase E: public reservation rate limit — API order + rate-limit.js mock D1."""
import subprocess
import sys
from pathlib import Path


def read(path):
    return Path(path).read_text(encoding="utf-8")


def main():
    api = read("functions/api/public/reservations.js")

    handler = api[api.find("export async function onRequestPost") :]
    body_idx = handler.find("const body = await readJson(request)")
    off_idx = handler.find('KETANG_PUBLIC_RESERVATIONS === "false"')
    record_idx = handler.find("await recordRateLimitHit")
    check_idx = handler.find("await checkRateLimit")

    checks = [
        ("check before record", check_idx >= 0 and record_idx > check_idx),
        ("body before record", body_idx >= 0 and record_idx > body_idx),
        ("403 before record", off_idx >= 0 and record_idx > off_idx),
        ("record before write", record_idx >= 0 and handler.find("await apiPublicReservation") > record_idx),
    ]

    failed = [name for name, ok in checks if not ok]
    if failed:
        print("FAIL public reservation API rate limit order:", ", ".join(failed))
        sys.exit(1)

    # Disabled/invalid requests must not call recordRateLimitHit (403/400 return early)
    early_400 = handler.find('return json({ error: "请求格式错误" }, 400)')
    early_403 = handler.find('return json({ error: "线上预约未开放" }, 403)')
    record_in_handler = handler.find("await recordRateLimitHit")
    if not (early_400 < record_in_handler and early_403 < record_in_handler):
        print("FAIL: recordRateLimitHit must follow 400/403 guards")
        sys.exit(1)

    proc = subprocess.run(
        ["node", "test_rate_limit_runner.mjs"],
        capture_output=True,
        text=True,
        timeout=30,
    )
    if proc.returncode != 0:
        print("FAIL: rate limit runner:", proc.stdout or proc.stderr)
        sys.exit(1)
    if "PASS:" not in (proc.stdout or ""):
        print("FAIL: rate limit runner missing PASS:", proc.stdout, proc.stderr)
        sys.exit(1)

    print("PASS: public reservation rate limit API order + D1 mock")


if __name__ == "__main__":
    main()
