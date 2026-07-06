from pathlib import Path

ROOT = Path(__file__).parent


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def main():
    chart_theme = read("js/chart-theme.js")
    index = read("index.html")
    sw = read("sw.js")

    required = [
        "ketangChartMeta",
        "ketangEcharts",
        "ketangChartDeferred",
        "mountKetangChartsInRoot",
        "isKetangChartElementVisible",
        "resolveKetangEchartHost",
        "releaseKetangEchartHost",
        "chartJsDatasetColor",
        "applyKetangEchartsDataZoom",
        "getKetangEchartsGroupId",
        "connectKetangEchartsGroup",
        "isKetangChartRuntimeReady",
        'indexAxis === "y"',
        'ds.stack || "total"',
        'type: "line"',
        "getKetangChartPerfSummary",
        "ketangChartPerf",
        "KETANG_CHART_ENGINE_STORAGE_KEY",
        "resolveKetangChartEngine",
        "setKetangChartEngine",
        "KETANG_ECHARTS_PILOT_KEYS",
        "chart_pilot_keys",
        "shouldUseKetangEchartsForKey",
        "ketangChartUpdateQueue",
        "ketangEchartUpdateQueue",
        "scheduleKetangChartUpdate",
        "scheduleKetangEchartUpdate",
        "canReuseKetangChart",
        "isKetangChartMountReady",
        "isKetangChartPresentationHidden",
        "syncKetangEchartHostLayout",
        "scheduleKetangEchartsConnect",
        'label: { show: false }',
        "observeKetangEchartHost",
        "scheduleKetangEchartLayoutRefresh",
        "ResizeObserver",
        "ketang-echart-host--pie",
        "ketang-echart-host--doughnut",
        "chartJsConfigToEchartsOption",
        "upsertKetangChart",
        "requestAnimationFrame",
        'chart.update("none")',
        "assignKetangEchartsGroup",
        "chart.group = groupId",
        "yAxisIndex: 0",
        "role",
        "aria-label",
        'return "echarts"',
    ]
    for token in required:
        if token not in chart_theme:
            print(f"FAIL chart-theme.js missing chart reuse/update token: {token}")
            raise SystemExit(1)

    if "destroyKetangChart(key);\n  var merged" in chart_theme:
        print("FAIL chart helpers must not destroy and recreate on every render")
        raise SystemExit(1)
    if 'chart-theme.js?v=15' not in index:
        print("FAIL index.html must bump chart-theme asset version")
        raise SystemExit(1)
    if 'events.js?v=28' not in index:
        print("FAIL index.html must bump events.js for chart PoC guard")
        raise SystemExit(1)
    events_js = read("js/events.js")
    if 'createKetangChart("events-progress"' not in events_js:
        print("FAIL events.js must keep events-progress PoC chart key")
        raise SystemExit(1)
    if "isKetangChartRuntimeReady()" not in read("js/app.js"):
        print("FAIL app.js must use isKetangChartRuntimeReady chart guard")
        raise SystemExit(1)
    if 'echarts.min.js?v=1' not in index:
        print("FAIL index.html must include vendored echarts runtime")
        raise SystemExit(1)
    if "./lib/echarts.min.js" not in sw:
        print("FAIL sw.js must precache echarts runtime")
        raise SystemExit(1)
    if "ketang-shell-v36" not in sw:
        print("FAIL sw.js must bump cache version after chart runtime change")
        raise SystemExit(1)
    if "renderBoardCoreCharts" not in read("js/app.js"):
        print("FAIL app.js must render board charts immediately after bootstrap")
        raise SystemExit(1)
    if "board-cap-chart-wrap" not in chart_theme:
        print("FAIL chart-theme.js must sync board-cap-chart-wrap host layout")
        raise SystemExit(1)

    print("OK chart infrastructure checks passed")


if __name__ == "__main__":
    main()
