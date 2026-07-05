#!/usr/bin/env python3
"""Phase B 排房写后刷新旅程：写 patches → 局部刷新，无 patch 时才全量对账。"""
import sys
from pathlib import Path


def read(path):
    return Path(path).read_text(encoding="utf-8")


def main():
    plans = read("js/rooming-plans.js")
    publish = read("js/rooming-publish.js")
    adjustments = read("js/rooming-adjustments.js")
    rr = read("js/rooming-read.js")
    api_route = read("functions/api/v1/admin/rooming-plans.js")
    shared_plans = read("functions/_shared/rooming-plans.js")
    shared_publish = read("functions/_shared/rooming-publish.js")

    checks = [
        ("api rooming route", "handleRoomingPlanAction" in api_route and "handleRoomingPublishAction" in api_route),
        ("ensure write patches", "roomingWritePatches" in shared_plans and "action === \"ensure\"" in shared_plans),
        ("generate write patches", "roomingWritePatches" in shared_plans and "generateRoomingPlanAssignments" in shared_plans),
        ("save write patches", "roomingWritePatches" in shared_plans and "saveRoomingPlan" in shared_plans),
        ("publish write patches", "roomingPublishPatches" in shared_publish),
        ("queue process patches", "roomingQueuePatches" in shared_publish and "processRoomingQueueCheckin" in shared_publish),
        ("generate refreshes", "roomingRefreshAfterWrite(eventId, genResult)" in plans),
        ("save refreshes", "roomingRefreshAfterWrite(eventId, saveResult)" in plans),
        ("publish refreshes", "roomingRefreshAfterWrite(eventId, publishResult)" in publish),
        ("republish refreshes", "roomingRefreshAfterWrite(eventId, republishResult)" in publish),
        ("queue update refreshes", "roomingRefreshAfterWrite(eventId, queueResult)" in publish),
        ("adjustment refreshes", "roomingRefreshAfterWrite(eventId, writeResult)" in adjustments),
        ("rooming reads event detail", 'apiRoomingPlanAction("get"' not in plans and 'apiRoomingPlanAction("queue"' not in publish and 'apiRoomingPlanAction("retrospective"' not in adjustments),
        ("patch detector", "function roomingWriteHasPatches" in rr),
        ("skip force refetch when patched", "if (!hasPatches && eventId && roomingReadReady())" in rr),
        ("queue checkin uses assign bed", "assignExistingLodgerToBed" in publish or "assignExistingLodgerToBed" in read("js/rooming-publish.js")),
        ("pending guards on rooming writes", ("withActionPending(source" in plans or "safeWithActionPending(source" in plans) and ("withActionPending(source" in publish or "safeWithActionPending(source" in publish)),
    ]
    failed = [name for name, ok in checks if not ok]
    if failed:
        print("FAIL rooming online journey:")
        for item in failed:
            print(" ", item)
        sys.exit(1)
    print("PASS: rooming write→patch→refresh journey wired")


if __name__ == "__main__":
    main()
