#!/usr/bin/env python3
"""Phase C-L2：预约状态局部乐观更新与失败回滚。"""
import sys
from pathlib import Path


def read(path):
    return Path(path).read_text(encoding="utf-8")


def main():
    resv = read("js/reservations.js")
    checks = [
        ("render uses rc rows", "function reservationRowsForRender" in resv and "rcRows(\"reservations\", \"reservations\")" in resv),
        ("buttons pass source", "updateResvStatus(event.currentTarget" in resv),
        ("status function accepts source", "async function updateResvStatus(source, id, status)" in resv),
        ("pending guard", "if (RESERVATION_STATUS_PENDING[id]) return" in resv),
        ("pending survives render", "RESERVATION_STATUS_PENDING" in resv and "disabled>保存中" in resv),
        ("optimistic helper", "function applyReservationStatusOptimistic" in resv),
        ("optimistic patches rc", "rcApplyDeltaPatches" in resv and "reservations" in resv),
        ("success skip view refresh", "rcRefreshAfterWrite(writeResult, { skipViewRefresh: true })" in resv),
        ("success checks rollback", "if (!rollbackOk) await forceRefreshReservations()" in resv),
        ("failure force fetches reservations", "rcEnsureReservations(true)" in resv),
        ("rollback reports unrecovered failure", "无法恢复最新数据" in resv),
    ]
    failed = [name for name, ok in checks if not ok]
    if failed:
        print("FAIL reservation status optimistic:")
        for item in failed:
            print(" ", item)
        sys.exit(1)
    print("PASS: reservation status optimistic update and rollback wired")


if __name__ == "__main__":
    main()