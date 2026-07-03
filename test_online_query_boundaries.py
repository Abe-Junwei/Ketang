#!/usr/bin/env python3
"""在线主路径不得裸 query()：reports/forecast/meals 须走 rc* 或 isLocalForceDb 分支。"""
import re
import sys


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def main():
    reports = read("js/reports.js")
    forecast = read("js/forecast.js")
    meals = read("js/meals.js")

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
        ("forecast flex local only", "isLocalForceDb()" in forecast and "rcFlexEmptyRooms" in forecast),
        ("forecast loading guard", "数据加载中，请稍候" in forecast),
        ("meals day detail rc", "rcAllLodgersMerged()" in meals),
        ("meals day by room rc", "getMealDayByRoom" in meals and meals.count("rcAllLodgersMerged()") >= 2),
        ("meals day by room reservations rc", "dayReservations" in meals),
    ]

    # 在线导出/渲染函数内不应出现未守卫的 query( —— 允许 isLocalForceDb / else 本地分支
    for label, src in [("reports", reports), ("forecast", forecast)]:
        for fn in re.findall(r"function (export\w+|render\w+)\(", src):
            if fn in ("renderReportTable", "renderTodayForecastCharts", "renderFlowForecastCharts"):
                continue
            m = re.search(rf"function {re.escape(fn)}\([^)]*\)\s*\{{", src)
            if not m:
                continue
            start = m.start()
            depth = 0
            i = m.end() - 1
            while i < len(src):
                if src[i] == "{":
                    depth += 1
                elif src[i] == "}":
                    depth -= 1
                    if depth == 0:
                        body = src[start:i + 1]
                        if "query(" in body and "!isLocalForceDb()" not in body and "isLocalForceDb()" not in body:
                            if fn not in (
                                "renderTodayForecastCharts",
                                "renderFlowForecastCharts",
                                "accumulateRole",
                            ):
                                checks.append((f"{label} {fn} unguarded query", False))
                        break
                i += 1

    failed = [name for name, ok in checks if not ok]
    if failed:
        print("FAIL online query boundaries:", ", ".join(failed))
        sys.exit(1)
    print("PASS: reports/forecast/meals online paths avoid bare query()")


if __name__ == "__main__":
    main()
