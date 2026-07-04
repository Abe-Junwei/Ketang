#!/usr/bin/env python3
"""营期增删改：在线乐观列表更新与失败回滚。"""
import sys
from pathlib import Path


def read(path):
    return Path(path).read_text(encoding="utf-8")


def main():
    events = read("js/events.js")
    checks = [
        ("event use api helper", "function eventUseApiData" in events),
        ("optimistic row builder", "function eventBuildOptimisticRow" in events),
        ("optimistic apply helper", "function eventApplyOptimistic" in events),
        ("create temp id cleanup", "function eventFinalizeWriteResult" in events),
        ("failure revert helper", "function eventRevertAfterWriteFailure" in events),
        ("submit closes before api", "closeEventModal();" in events and "apiAdminRecord" in events),
        ("submit optimistic patch", "eventApplyOptimistic({" in events),
        ("submit finalize temp id", "eventFinalizeWriteResult(writeResult, optimisticTempId)" in events),
        ("submit failure revert", "eventRevertAfterWriteFailure()" in events),
        ("delete optimistic tombstone", 'deletions: [{ table_name: "events", row_id: id }]' in events),
        ("delete failure revert", events.count("eventRevertAfterWriteFailure()") >= 2),
    ]
    failed = [name for name, ok in checks if not ok]
    if failed:
        print("FAIL event save optimistic:")
        for item in failed:
            print(" ", item)
        sys.exit(1)
    print("PASS: event save optimistic update and rollback wired")


if __name__ == "__main__":
    main()
