#!/usr/bin/env python3
"""Phase C-L2：禅营成员批量取消/No-show 局部乐观更新与失败回滚。"""
import sys
from pathlib import Path


def read(path):
    return Path(path).read_text(encoding="utf-8")


def main():
    events = read("js/events.js")
    checks = [
        ("buttons pass source", "batchNoShowEventMembers(event.currentTarget)" in events and "batchCancelEventMembers(event.currentTarget)" in events),
        ("batch functions accept source", "async function batchCancelEventMembers(source)" in events and "async function batchNoShowEventMembers(source)" in events),
        ("member pending state", "EVENT_MEMBER_BATCH_PENDING" in events and "disabled>保存中" in events),
        ("optimistic helper", "function applyEventMembersOptimistic" in events),
        ("rollback helper", "function rollbackEventMembersOptimistic" in events),
        ("optimistic patches reservations", "rcApplyDeltaPatches" in events and "reservations" in events),
        ("optimistic patches lodgers", "rcApplyDeltaPatches" in events and "lodgers" in events),
        ("renders member page immediately", "renderEventMembers(eventId);" in events),
        ("success skip view refresh", "rcRefreshAfterWrite(writeResult, { skipViewRefresh: true })" in events),
        ("local write result", events.count("writeResult = { ok: true, local: true };") >= 2),
        ("failure force fetches events", "rcEnsureEvents(true)" in events),
        ("rollback failure surfaced", "无法恢复最新成员数据" in events),
    ]
    failed = [name for name, ok in checks if not ok]
    if failed:
        print("FAIL event members optimistic:")
        for item in failed:
            print(" ", item)
        sys.exit(1)
    print("PASS: event members optimistic batch update and rollback wired")


if __name__ == "__main__":
    main()