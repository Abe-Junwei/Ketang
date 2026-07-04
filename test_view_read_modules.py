#!/usr/bin/env python3
"""视图级读模块：history/forecast/reports 应走 rcEnsureViewModules。"""
import sys


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def main():
    rc = read("js/read-cache.js")
    checks = [
        ("RC_VIEW_MODULES", "var RC_VIEW_MODULES" in rc),
        ("rcEnsureViewModules", "async function rcEnsureViewModules" in rc),
        ("history view key", "history:" in rc and "lodgers" in rc),
        ("reports view key", "reports:" in rc and "meals" in rc),
        ("historyLoadAndRender", "async function historyLoadAndRender" in read("js/history.js")),
        ("forecastLoadTab", "async function forecastLoadTab" in read("js/forecast.js")),
        ("reportsInitAndLoad", "async function reportsInitAndLoad" in read("js/reports.js")),
        ("prefetchViewData", "async function prefetchViewData" in read("js/app.js")),
        ("checkin rc picker", "rcBoardRoomsWithStats" in read("js/checkin.js")),
        ("board rc stats", "rcGetBoardBedStats" in rc),
        ("boardReadCacheReady", "function boardReadCacheReady" in rc),
        ("app uses rc lodgers", "rcActiveLodgersEnriched" in read("js/app.js")),
        ("rcOpsNoticeData", "function rcOpsNoticeData" in rc),
        ("rcCheckoutReminders", "function rcCheckoutReminders" in rc),
        ("rcReadReady", "function rcReadReady" in rc),
        ("RC_BOOTSTRAP_MODULES", "RC_BOOTSTRAP_MODULES" in rc),
        ("RC_DEFERRED_MODULES", "RC_DEFERRED_MODULES" in rc),
        ("rcEventListWithStats", "function rcEventListWithStats" in rc),
        ("rcEventMembers", "function rcEventMembers" in rc),
        ("rcForecastTodayData", "function rcForecastTodayData" in rc),
        ("rcForecastFlowWeeks", "function rcForecastFlowWeeks" in rc),
        ("info_events module", "info_events:" in rc),
        (
            "info_events lodgers_active",
            "lodgers_active" in rc.split("info_events:")[1].split("]")[0],
        ),
        (
            "event_rooming module",
            "event_rooming:" in read("functions/_shared/read-modules.js")
            or 'event_rooming: [' in read("functions/_shared/read-modules.js"),
        ),
        (
            "events module slim",
            'events: ["events"]' in read("functions/_shared/read-modules.js"),
        ),
        ("rcApplyWriteResult touches version", "touchBoardVersionFromWrite" in rc),
        ("rcEventRoomingRows", "function rcEventRoomingRows" in rc),
        ("meals rc read", "rcReadReady" in read("js/meals.js")),
        ("forecast rc today", "rcForecastTodayData" in read("js/forecast.js")),
        ("forecast rc flow", "rcForecastFlowWeeks" in read("js/forecast.js")),
        ("events rc list", "rcEventListWithStats" in read("js/events.js")),
        ("events rc members", "rcEventMembers" in read("js/events.js")),
        ("info events loader", "info_events" in read("js/info.js")),
        ("rcModulesForInfoTab", "function rcModulesForInfoTab" in rc),
        ("resolveScopedModuleKeys", "function resolveScopedModuleKeys" in read("js/sync-coordinator.js")),
        (
            "event detail assignments join plan",
            "FROM rooming_assignments ra" in read("functions/_shared/read-modules.js")
            and "JOIN rooming_plans rp ON rp.id = ra.plan_id" in read("functions/_shared/read-modules.js")
            and "SELECT * FROM ${table} WHERE event_id = ?" not in read("functions/_shared/read-modules.js"),
        ),
    ]
    failed = [name for name, ok in checks if not ok]
    if failed:
        print("FAIL view read modules:", ", ".join(failed))
        sys.exit(1)
    print("PASS: view-scoped read module loaders present")


if __name__ == "__main__":
    main()
