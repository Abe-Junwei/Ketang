#!/usr/bin/env python3
"""在线主路径不得裸 query()：Phase D 模块须走 rc* 或 useOnlineDataPath 分支。"""
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
    if (
        "isLocalForceDb()" in body
        or "useOnlineDataPath()" in body
        or "guestUseLocalDb()" in body
    ):
        return True, None
    if "readLodger(" in body or "readUseRc()" in body or "readGuest(" in body:
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
    app = read("js/app.js")
    rooming_read = read("js/rooming-read.js")
    rooming_capacity = read("js/rooming-capacity.js")
    rooming_plans = read("js/rooming-plans.js")
    rooming_publish = read("js/rooming-publish.js")
    rooming_adjustments = read("js/rooming-adjustments.js")
    rooming_conflicts = read("js/rooming-conflicts.js")
    read_modules = read("functions/_shared/read-modules.js")
    auth = read("js/auth.js")
    guests = read("js/guests.js")
    checkin = read("js/checkin.js")
    resv = read("js/reservations.js")
    validation = read("js/validation.js")
    mobile_ui = read("js/mobile-ui.js")

    checks = [
        ("reports daily rc", "rcDailyReportData" in reports),
        ("reports monthly rc", "rcMonthlyReportData" in reports),
        ("reports event rc", "rcEventReportMembers" in reports),
        ("reports export daily rc", "rcDailyReportExportRows" in reports),
        ("reports event select rc", "rcEventsForSelect" in reports),
        ("reports guarded render", reports.count("useOnlineDataPath()") >= 5),
        ("forecast today rc", "rcForecastTodayData" in forecast),
        ("forecast flow rc", "rcForecastFlowWeeks" in forecast),
        ("forecast export rc", "rcForecastTodayData(date)" in forecast),
        ("forecast flow events rc", "rcEventListWithStats()" in forecast),
        (
            "forecast flex local only",
            "isLocalForceDb()" in forecast and "rcFlexEmptyRooms" in forecast,
        ),
        ("forecast loading guard", "数据加载中，请稍候" in forecast),
        ("meals day detail rc", "readLodgersInHouseUpToDate" in meals),
        (
            "meals day by room rc",
            "getMealDayByRoom" in meals and "readLodgersInHouseUpToDateEnriched" in meals,
        ),
        ("meals day by room reservations rc", "readReservationsCheckInOn" in meals),
        ("meals summary rc", "readMealsForLodger" in meals and "getMealSummary" in meals),
        ("meals lodger enriched", "readLodgerEnriched" in meals),
        ("meals modal rc", "mealLodgerEnrichedById(lodgerId)" in meals),
        ("history search rc", "rcFetchHistoryRows" in history),
        ("history export rc", "rcLodgerPaymentTotals" in history),
        ("history local guard", history.count("isLocalForceDb()") >= 3),
        ("events read ready", "eventReadReady" in events),
        ("events get by id guard", "eventGetById" in events and "readEventById" in events),
        ("events list loading", "数据加载中，请稍候" in events),
        ("events find by name rc", "readFindEventByName" in events),
        ("events export members rc", "readEventMemberLodgers" in events),
        ("events export reservations", "readEventMemberReservationsForExport" in events),
        (
            "app checkout reminders online rc",
            "function renderCheckoutReminders" in app
            and "isRemoteDB()" in fn_body(app, "appUseOnlineReadPath")
            and "readUseOnlineDataPath()" in fn_body(app, "appUseOnlineReadPath")
            and "appUseOnlineReadPath()" in fn_body(app, "renderCheckoutReminders")
            and "readLocalQuery" in fn_body(app, "renderCheckoutReminders")
            and "rcCheckoutReminders" in fn_body(app, "renderCheckoutReminders"),
        ),
        (
            "app ops notice online rc",
            "function renderOpsNotice" in app
            and "appUseOnlineReadPath()" in fn_body(app, "renderOpsNotice")
            and "rcOpsNoticeData" in fn_body(app, "renderOpsNotice"),
        ),
        (
            "app board stats online rc",
            "function getBoardBedStats" in app
            and "appUseOnlineReadPath()" in fn_body(app, "getBoardBedStats")
            and "rcGetBoardBedStats" in fn_body(app, "getBoardBedStats"),
        ),
        (
            "app board charts online rc",
            "function renderBoardCharts" in app
            and fn_body(app, "renderBoardCharts").count("appUseOnlineReadPath()") >= 2
            and "rcGetBoardFlowStats" in fn_body(app, "renderBoardCharts")
            and "rcGetDormBedStats" in fn_body(app, "renderBoardCharts"),
        ),
        (
            "app room detail online rc",
            "function renderRoomDetailPanel" in app
            and "appUseOnlineReadPath()" in fn_body(app, "renderRoomDetailPanel")
            and "rcBedsForRoomEnriched" in fn_body(app, "renderRoomDetailPanel"),
        ),
        (
            "app rooms online loading guard",
            "function renderRooms" in app
            and "appUseOnlineReadPath()" in fn_body(app, "renderRooms")
            and "正在加载房态数据" in fn_body(app, "renderRooms"),
        ),
        ("rooming read helper", "roomingUseLocalRead" in rooming_read),
        ("rooming plan rc", "rcRoomingPlanByEventId" in rooming_read),
        ("rooming assignments guard", "if (!roomingUseLocalRead()) return [];" in rooming_read),
        ("rooming capacity guard", "roomingUseLocalRead()" in rooming_capacity),
        (
            "rooming event detail assignments join plan",
            "FROM rooming_assignments ra" in read_modules
            and "JOIN rooming_plans rp ON rp.id = ra.plan_id" in read_modules
            and "SELECT * FROM ${table} WHERE event_id = ?" not in read_modules,
        ),
        ("auth remote users", "useRemoteAdminUsers" in auth),
        ("auth list api", "apiAdminListUsers" in auth),
        ("auth lookup remote", "findAdminUserById" in auth),
        ("resv event guard", "eventGetById(eventId)" in resv),
        ("validation duplicate rc", "readUseRc()" in validation and "checkDuplicate" in validation),
        (
            "mobile hero flow rc",
            "rcGetBoardFlowStats" in mobile_ui and "useOnlineDataPath()" in mobile_ui,
        ),
        ("guests phone lookup rc", "rcFindGuestByPhoneOrIdCard" in guests),
        ("guests name lookup rc", "rcFindGuestByDisplayName" in guests),
        ("guests local write guard", "guestUseLocalDb" in guests),
        (
            "checkin csv online api",
            "apiBatchCheckIn" in checkin and "importBatchCSV" in checkin,
        ),
        (
            "checkin csv local branch",
            checkin.count("isLocalForceDb()") >= 3
            and "findOrCreateGuest" in checkin,
        ),
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
    failed += scan_render_exports("rooming plans", rooming_plans)
    failed += scan_render_exports("rooming publish", rooming_publish)
    failed += scan_render_exports("rooming adjustments", rooming_adjustments)
    failed += scan_render_exports("rooming conflicts", rooming_conflicts)

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
        "fetchRoomingPlanBundle",
        "generateRoomingPlanDraft",
        "saveRoomingPlanDraft",
        "renderRoomingPlan",
        "handleRefreshRoomingConflicts",
        "handleSaveRoomingPlan",
        "fetchRoomingConflictReport",
        "fetchRoomingQueueBundle",
        "findRoomingQueueItem",
        "markRoomingQueueItemStatus",
        "renderRoomingCheckinQueue",
        "exportRoomingCheckinListCSV",
        "exportRoomingRoomTableCSV",
        "loadRoomingPrintQueue",
        "fetchRoomingRetrospective",
        "renderRoomingRetrospective",
        "exportRoomingRetrospectiveCSV",
        "logRoomingAdjustment",
    ]:
        src = {
            "fetchRoomingPlanBundle": rooming_plans,
            "generateRoomingPlanDraft": rooming_plans,
            "saveRoomingPlanDraft": rooming_plans,
            "renderRoomingPlan": rooming_plans,
            "handleRefreshRoomingConflicts": rooming_plans,
            "handleSaveRoomingPlan": rooming_plans,
            "fetchRoomingConflictReport": rooming_conflicts,
            "fetchRoomingQueueBundle": rooming_publish,
            "findRoomingQueueItem": rooming_publish,
            "markRoomingQueueItemStatus": rooming_publish,
            "renderRoomingCheckinQueue": rooming_publish,
            "exportRoomingCheckinListCSV": rooming_publish,
            "exportRoomingRoomTableCSV": rooming_publish,
            "loadRoomingPrintQueue": rooming_publish,
            "fetchRoomingRetrospective": rooming_adjustments,
            "renderRoomingRetrospective": rooming_adjustments,
            "exportRoomingRetrospectiveCSV": rooming_adjustments,
            "logRoomingAdjustment": rooming_adjustments,
        }[fn]
        body = fn_body(src, fn)
        ok, name = assert_no_unguarded_query(f"rooming {fn}", body)
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

    for fn in [
        "findGuestByPhoneOrIdCard",
        "findGuestByDisplayName",
        "findOrCreateGuest",
        "incrementGuestVisit",
    ]:
        body = fn_body(guests, fn)
        ok, name = assert_no_unguarded_query(f"guests {fn}", body)
        if not ok:
            failed.append(name)

    for fn in [
        "assignReservationToBed",
        "assignExistingLodgerToBed",
        "importBatchCSV",
        "findAssignableBed",
    ]:
        body = fn_body(checkin, fn)
        ok, name = assert_no_unguarded_query(f"checkin {fn}", body)
        if not ok:
            failed.append(name)

    for fn in ["checkInFromResv", "editResv", "guestEmergencyFields"]:
        body = fn_body(resv, fn)
        ok, name = assert_no_unguarded_query(f"reservations {fn}", body)
        if not ok:
            failed.append(name)

    for fn in ["validateEditLodgerContact", "checkDuplicate"]:
        body = fn_body(validation, fn)
        ok, name = assert_no_unguarded_query(f"validation {fn}", body)
        if not ok:
            failed.append(name)

    body = fn_body(mobile_ui, "renderMobileBoardHero")
    ok, name = assert_no_unguarded_query("mobile-ui renderMobileBoardHero", body)
    if not ok:
        failed.append(name)

    if failed:
        print("FAIL online query boundaries:", ", ".join(failed))
        sys.exit(1)
    print("PASS: Phase D online paths avoid bare query()")


if __name__ == "__main__":
    main()
