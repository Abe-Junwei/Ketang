#!/usr/bin/env python3
"""Phase 9 排房：在线读路径 rooming-read.js 与 API 接线。"""
import sys
from pathlib import Path


def read(path):
    return Path(path).read_text(encoding="utf-8")


def main():
    rr = read("js/rooming-read.js")
    api = read("js/api-client.js")
    plans = read("js/rooming-plans.js")
    publish = read("js/rooming-publish.js")
    html = read("index.html")

    checks = [
        ("rooming-read.js loaded", "rooming-read.js" in html),
        ("apiReadEventDetail", "function apiReadEventDetail" in api),
        ("rcEnsureEventRooming", "async function rcEnsureEventRooming" in rr),
        ("roomingGetEvent", "function roomingGetEvent" in rr),
        ("roomingListAssignableBeds", "function roomingListAssignableBeds" in rr),
        ("roomingRefreshAfterWrite", "async function roomingRefreshAfterWrite" in rr),
        ("renderRoomingPlan ensure", "roomingEnsureEvent" in plans),
        ("publish queue rc", "roomingGetEvent" in publish),
        ("capacity rc", "roomingReadReady" in read("js/rooming-capacity.js")),
        ("events suggestion rc", "roomingAvailRoomsGrouped" in read("js/events.js")),
        ("RC_VIEW_MODULES rooming", "rooming:" in read("js/read-cache.js")),
        ("rooming loads event_rooming", "event_rooming" in rr),
        ("rooming uses lodgers_active", "lodgers_active" in rr),
        (
            "event conflicts read api",
            "apiReadEventConflicts" in api and "view=conflicts" in api,
        ),
        (
            "event members read api",
            "apiReadEventMembers" in api and "view=members" in api,
        ),
        (
            "conflict report prefers GET",
            "apiReadEventConflicts" in read("js/rooming-conflicts.js"),
        ),
    ]
    failed = [name for name, ok in checks if not ok]
    if failed:
        print("FAIL rooming online read:", ", ".join(failed))
        sys.exit(1)
    print("PASS: Phase 9 rooming online read wiring present")


if __name__ == "__main__":
    main()
