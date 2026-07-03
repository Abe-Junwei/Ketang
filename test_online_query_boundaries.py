#!/usr/bin/env python3
"""在线主路径不得裸 query()：Phase D 模块须走 rc* 或 isLocalForceDb 分支。"""
import re
import sys


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def fn_body(src, fn_name):
    m = re.search(rf"function {re.escape(fn_name)}\([^)]*\)\s*\{{", src)
    if not m:
        return None
    start = m.start()
    depth = 0
    i = m.end() - 1
    while i < len(src):
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth == 0:
                return src[start : i + 1]
        i += 1
    return None


def assert_no_unguarded_query(label, body, allow_local=True):
    if not body or "query(" not in body:
        return True, None
    if "isLocalForceDb()" in body:
        return True, None
    if "useRemoteAdminUsers()" in body:
        return True, None
    if allow_local and "roomingUseLocalRead()" in body:
        return True, None
    return False, label


def scan_render_exports(label, src, skip_fns=None):
    skip = set(skip_fns or [])
    failed = []
    for fn in re.findall(r"function (export\w+|render\w+)\(", src):
        if fn in skip:
            continue
        body = fn_body(src, fn)
        ok, name = assert_no_unguarded_query(f"{label} {fn}", body)
        if not ok:
            failed.append(name)
    return failed


def main():
    reports = read("js/reports.js")
    forecast = read("js/forecast.js")
    meals = read("js/meals.js")
    history = read("js/history.js")
    events = read("js/events.js")
    rooming_read = read("js/rooming-read.js")
    rooming_capacity = read("js/rooming-capacity.js")
    auth = read("js/auth.js")

    checks = [
        ("reports daily rc", "rcDailyReportData" in reports),
        ("reports monthly rc", "rcMonthlyReportData" in reports),
        ("reports event rc", "rcEventReportMembers" in reports),
        ("reports export daily rc", "rcDailyReportExportRows" in reports),
        ("reports event select rc", "rcEventsForSelect" in reports),
        ("reports guarded render", reports.count("!isLocalForceDb()") >= 5),
        ("forecast today rc", "rcForecastTodayData" in forecast),
        ("forecast flow rc", "rcForecastFlowWeeks" in forecast),
        ("forecast export rc", "rcForecastTodayData(date)" in forecast),
        ("forecast flow events rc", "rcEventListWithStats()" in forecast),
        (
            "forecast flex local only",
            "isLocalForceDb()" in forecast and "rcFlexEmptyRooms" in forecast,
        ),
        ("forecast loading guard", "数据加载中，请稍候" in forecast),
        ("meals day detail rc", "rcAllLodgersMerged()" in meals),
        (
            "meals day by room rc",
            "getMealDayByRoom" in meals and meals.count("rcAllLodgersMerged()") >= 2,
        ),
        ("meals day by room reservations rc", "dayReservations" in meals),
        ("meals summary rc", "rcMealsForLodger" in meals and "getMealSummary" in meals),
        ("meals lodger enriched", "mealLodgerEnrichedById" in meals),
        ("meals modal rc", "mealLodgerEnrichedById(lodgerId)" in meals),
        ("history search rc", "rcHistorySearch" in history),
        ("history export rc", "rcLodgerPaymentTotals" in history),
        ("history local guard", history.count("isLocalForceDb()") >= 3),
        ("events read ready", "eventReadReady" in events),
        ("events get by id guard", "eventGetById" in events and "if (!isLocalForceDb()) return null" in events),
        ("events list loading", "数据加载中，请稍候" in events),
        ("events find by name rc", "rcFindEventByName" in events),
        ("events export members rc", "rcEventMembers" in events),
        ("rooming read helper", "roomingUseLocalRead" in rooming_read),
        ("rooming plan rc", "rcRoomingPlanByEventId" in rooming_read),
        ("rooming assignments guard", "if (!roomingUseLocalRead()) return [];" in rooming_read),
        ("rooming capacity guard", "roomingUseLocalRead()" in rooming_capacity),
        ("auth remote users", "useRemoteAdminUsers" in auth),
        ("auth list api", "apiAdminListUsers" in auth),
        ("auth lookup remote", "findAdminUserById" in auth),
    ]

    failed = [name for name, ok in checks if not ok]

    failed += scan_render_exports(
        "reports",
        reports,
        skip_fns={"renderReportTable", "renderTodayForecastCharts", "renderFlowForecastCharts"},
    )
    failed += scan_render_exports(
        "forecast",
        forecast,
        skip_fns={"renderTodayForecastCharts", "renderFlowForecastCharts", "accumulateRole"},
    )
    failed += scan_render_exports("history", history)
    failed += scan_render_exports("events", events, skip_fns={"renderEventProgressChart"})

    for fn in [
        "roomingGetPlan",
        "roomingAssignmentsForEvent",
        "roomingCheckinQueueForEvent",
        "roomingAdjustmentsForEvent",
        "roomingListEventMembersForPlan",
        "roomingListDraftReservedBedIds",
        "roomingListAssignableBeds",
        "roomingLodgerEventRow",
        "getCapacityBedTotals",
        "loadCapacityActiveEvents",
        "capacityRegisteredOnDay",
    ]:
        src = rooming_read if fn.startswith("rooming") else rooming_capacity
        body = fn_body(src, fn)
        ok, name = assert_no_unguarded_query(fn, body)
        if not ok:
            failed.append(name)

    for fn in [
        "renderHistory",
        "exportCSV",
        "getMealSummary",
        "getLodgerMealDefaults",
        "getMealFlagsForDate",
        "mealLodgerEnrichedById",
        "mealRowsForLodgerRender",
        "openMealModal",
        "renderMealGrid",
        "getMealDayDetail",
        "getMealDayByRoom",
        "submitMeals",
        "renderUserList",
        "lookupAdminUser",
    ]:
        src = {
            "renderHistory": history,
            "exportCSV": history,
            "getMealSummary": meals,
            "getLodgerMealDefaults": meals,
            "getMealFlagsForDate": meals,
            "mealLodgerEnrichedById": meals,
            "mealRowsForLodgerRender": meals,
            "openMealModal": meals,
            "renderMealGrid": meals,
            "getMealDayDetail": meals,
            "getMealDayByRoom": meals,
            "submitMeals": meals,
            "renderUserList": auth,
            "lookupAdminUser": auth,
        }[fn]
        body = fn_body(src, fn)
        ok, name = assert_no_unguarded_query(fn, body, allow_local=fn != "lookupAdminUser")
        if not ok:
            failed.append(name)

    if failed:
        print("FAIL online query boundaries:", ", ".join(failed))
        sys.exit(1)
    print("PASS: Phase D online paths avoid bare query()")


if __name__ == "__main__":
    main()
