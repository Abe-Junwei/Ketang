#!/usr/bin/env python3
"""Phase E 公开预约闭环静态契约 | Public reservation closed-loop contracts."""
import re
import sys
from pathlib import Path


def read(path):
    return Path(path).read_text(encoding="utf-8")


def main():
    reserve_html = read("reserve.html")
    public_js = read("js/public-reserve.js")
    api = read("functions/api/public/reservations.js")
    lodgers = read("functions/_shared/lodgers.js")
    notify = read("functions/_shared/public-reservation-notify.js")
    rate = read("functions/_shared/rate-limit.js")
    sync = read("js/sync-coordinator.js")
    resv = read("js/reservations.js")

    checks = [
        ("reserve page exists", "reserve-form" in reserve_html and "rv-name" in reserve_html),
        ("reserve loads public script", "public-reserve.js" in reserve_html),
        ("no sql on reserve page", "sql-wasm" not in reserve_html and "db.js" not in reserve_html),
        ("public POST only", "/api/public/reservations" in public_js and "method: \"POST\"" in public_js or "method: 'POST'" in public_js),
        ("public source tag", "公开预约" in public_js),
        ("inline validation", "showReserveError" in public_js),
        ("success state", "showReserveSuccess" in public_js or "预约已提交" in public_js),
        ("date order guard", "预离日期不能早于入住日期" in public_js),
        ("switch off guard", 'KETANG_PUBLIC_RESERVATIONS === "false"' in api),
        ("403 message", "线上预约未开放" in api),
        ("rate limit check", "checkRateLimit" in api and "public_resv" in api),
        ("rate limit record", "recordRateLimitHit" in api),
        ("429 mapping", "429" in api and "过于频繁" in api),
        ("api handler POST only", "onRequestPost" in api and "onRequestGet" not in api),
        ("public write api", "apiPublicReservation" in lodgers),
        ("reservations domain", '["reservations"]' in lodgers and "apiPublicReservation" in lodgers),
        ("notify adapter", "notifyPublicReservationSubmitted" in notify),
        ("notify non-blocking", "console.warn" in notify),
        ("notify wired", "notifyPublicReservationSubmitted" in lodgers),
        ("rate limit module", "fail_count" in rate and "window_start" in rate),
        ("sync reservations domain", 'registerViewRefresh("domain:reservations"' in sync),
        ("sync reservations module", 'registerViewRefresh("module:reservations"' in sync),
        ("backend confirm", "updateResvStatus" in resv and "已确认" in resv),
        ("backend checkin", "checkInFromResv" in resv),
        ("backend cancel", "已取消" in resv and "renderReservations" in resv),
        ("backend rc read", "reservationRowsForRender" in resv and "rcRows(\"reservations\"" in resv),
        ("no public list API", not Path("functions/api/public/reservations/list.js").exists()),
    ]

    # 公开页不得引用 admin/read API
    for label, src in [("public-reserve.js", public_js), ("reserve.html", reserve_html)]:
        if "apiReadModule" in src or "apiAdmin" in src:
            checks.append((f"{label} no admin read", False))

    failed = [name for name, ok in checks if not ok]
    if failed:
        print("FAIL public reservations:", ", ".join(failed))
        sys.exit(1)
    print("PASS: Phase E public reservation contracts")


if __name__ == "__main__":
    main()
