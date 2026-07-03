#!/usr/bin/env python3
"""排房写路径：返回行级 patches，避免写后整包重拉。"""
import sys
from pathlib import Path


def read(path):
    return Path(path).read_text(encoding="utf-8")


def function_slice(src, name):
    marker = f"export async function {name}"
    start = src.find(marker)
    if start == -1:
        return ""
    next_export = src.find("\nexport async function ", start + len(marker))
    return src[start:] if next_export == -1 else src[start:next_export]


def main():
    plans = read("functions/_shared/rooming-plans.js")
    publish = read("functions/_shared/rooming-publish.js")
    rr = read("js/rooming-read.js")

    checks = [
        ("rooming-plans imports enrich", "enrichWriteResponse" in plans),
        ("rooming-publish imports enrich", "enrichWriteResponse" in publish),
        (
            "generate patches plan assignments",
            "roomingWritePatches" in function_slice(plans, "generateRoomingPlanAssignments")
            and "rooming_plans" in function_slice(plans, "generateRoomingPlanAssignments")
            and "rooming_assignments" in function_slice(plans, "generateRoomingPlanAssignments"),
        ),
        (
            "save patches plan assignments",
            "roomingWritePatches" in function_slice(plans, "saveRoomingPlan")
            and "rooming_plans" in function_slice(plans, "saveRoomingPlan")
            and "rooming_assignments" in function_slice(plans, "saveRoomingPlan"),
        ),
        (
            "publish patches plan queue",
            "roomingPublishPatches" in function_slice(publish, "publishRoomingPlan")
            and "rooming_plans" in function_slice(publish, "publishRoomingPlan")
            and "rooming_checkin_queue" in function_slice(publish, "publishRoomingPlan"),
        ),
        (
            "republish patches plan queue",
            "roomingPublishPatches" in function_slice(publish, "republishRoomingPlan")
            and "rooming_plans" in function_slice(publish, "republishRoomingPlan")
            and "rooming_checkin_queue" in function_slice(publish, "republishRoomingPlan"),
        ),
        (
            "queue update patches queue",
            "roomingQueuePatches" in function_slice(publish, "updateRoomingQueueItem")
            and "rooming_checkin_queue" in function_slice(publish, "updateRoomingQueueItem"),
        ),
        (
            "queue process patches queue",
            "roomingQueuePatches" in function_slice(publish, "processRoomingQueueCheckin")
            and "rooming_checkin_queue" in function_slice(publish, "processRoomingQueueCheckin"),
        ),
        (
            "adjustment patches adjustment",
            "roomingAdjustmentPatches" in function_slice(publish, "logRoomingAdjustment")
            and "rooming_adjustments" in function_slice(publish, "logRoomingAdjustment"),
        ),
        (
            "frontend skips force refetch when patched",
            "roomingWriteHasPatches" in rr
            and "if (!hasPatches && eventId && roomingReadReady())" in rr,
        ),
    ]
    failed = [name for name, ok in checks if not ok]
    if failed:
        print("FAIL rooming write patches:")
        for item in failed:
            print(" ", item)
        sys.exit(1)
    print("PASS: rooming write paths return patches and skip forced refetch")


if __name__ == "__main__":
    main()