#!/usr/bin/env python3
"""Phase C-L1：高频写操作必须有保存中状态与防重复提交。"""
import sys
from pathlib import Path


def read(path):
    return Path(path).read_text(encoding="utf-8")


def main():
    utils = read("js/utils.js")
    checkin = read("js/checkin.js")
    reservations = read("js/reservations.js")
    lodger = read("js/lodger-actions.js")
    meals = read("js/meals.js")
    events = read("js/events.js")
    info = read("js/info.js")
    rooming_plans = read("js/rooming-plans.js")
    rooming_publish = read("js/rooming-publish.js")

    checks = [
        ("beginActionPending helper", "function beginActionPending" in utils),
        ("withActionPending helper", "function withActionPending" in utils),
        ("helper disables button", ".disabled = true" in utils),
        ("helper restores button", ".disabled = oldDisabled" in utils),
        ("helper uses saving label", "保存中" in utils),
        ("helper restores in finally", "finally" in utils and "finishPending()" in utils),
        ("checkin guarded", "beginActionPending(e" in checkin),
        ("reservation guarded", "beginActionPending(e" in reservations),
        ("extend guarded", "withActionPending(event" in lodger and "submitExtend" in lodger),
        ("edit lodger guarded", "submitEditLodger(event" in lodger),
        ("change bed guarded", "submitChangeBed(event" in lodger),
        ("checkout guarded", "submitCheckout(event" in lodger),
        ("meals guarded", "submitMeals(event" in meals),
        ("event save guarded", "beginActionPending(e" in events),
        ("info room guarded", "submitRoom(event" in info and "withActionPending(event" in info),
        ("info bed guarded", "submitBed(event" in info),
        ("info guest guarded", "submitGuest(event" in info),
        ("info lodger guarded", "submitLodger(event" in info),
        ("rooming generate guarded", "handleGenerateRoomingPlan(event.currentTarget" in rooming_plans),
        ("rooming save guarded", "handleSaveRoomingPlan(event.currentTarget" in rooming_plans),
        ("rooming publish guarded", "handlePublishRoomingPlan(event.currentTarget" in rooming_plans),
        ("rooming republish guarded", "handleRepublishRoomingPlan(event.currentTarget" in rooming_plans + rooming_publish),
        ("rooming queue process guarded", "handleRoomingQueueCheckin(event.currentTarget" in rooming_publish),
        ("rooming queue skip guarded", "handleRoomingQueueSkip(event.currentTarget" in rooming_publish),
    ]
    failed = [name for name, ok in checks if not ok]
    if failed:
        print("FAIL action pending guard:")
        for item in failed:
            print(" ", item)
        sys.exit(1)
    print("PASS: high-frequency writes have pending guards")


if __name__ == "__main__":
    main()