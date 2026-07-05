#!/usr/bin/env python3
"""ECharts runtime regression: hidden-view refresh must mount a real chart host."""
import json
import subprocess
import sys
import time

import websocket

from test_cdp import (
    CDP_PORT,
    PORT,
    cdp_ws_url,
    collect_errors,
    evaluate,
    recv_by_id,
    start_server,
    wait_for_cdp,
)
from test_file_protocol import chrome_binary


def main():
    server = start_server()
    chrome = chrome_binary()
    if not chrome:
        print("SKIP: Chrome not found")
        server.terminate()
        return

    proc = subprocess.Popen(
        [
            chrome,
            f"--remote-debugging-port={CDP_PORT}",
            "--remote-allow-origins=*",
            "--headless=new",
            "--disable-gpu",
            "--no-sandbox",
            "--disable-dev-shm-usage",
            f"http://127.0.0.1:{PORT}/index.html?chart_engine=echarts",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    try:
        if not wait_for_cdp():
            print("FAIL: CDP not ready")
            sys.exit(1)
        ws_url = cdp_ws_url()
        if not ws_url:
            print("FAIL: no CDP page")
            sys.exit(1)

        ws = websocket.create_connection(ws_url, timeout=10)
        ws.send(json.dumps({"id": 2, "method": "Runtime.enable"}))
        ws.recv()

        for _ in range(30):
            if evaluate(ws, "window.ketangReady").get("value") is True:
                break
            time.sleep(0.5)
        else:
            print("FAIL: app did not initialize")
            sys.exit(1)

        login_expr = """
          (async () => {
            document.getElementById('login-username').value = 'admin';
            document.getElementById('login-password').value = 'admin';
            await submitLogin();
            for (let i = 0; i < 40; i++) {
              if (typeof isLoggedIn === 'function' && isLoggedIn()) break;
              await new Promise(r => setTimeout(r, 250));
            }
            return typeof getCurrentUser === 'function' && getCurrentUser()
              ? getCurrentUser().role
              : null;
          })()
        """
        ws.send(
            json.dumps(
                {
                    "id": 3,
                    "method": "Runtime.evaluate",
                    "params": {
                        "expression": login_expr,
                        "awaitPromise": True,
                        "returnByValue": True,
                    },
                }
            )
        )
        role = recv_by_id(ws, 3, 90).get("result", {}).get("result", {}).get("value")
        if role != "admin":
            print("FAIL: admin identity login failed, role=", role)
            sys.exit(1)

        expr = """
          (async () => {
            try {
              document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
              document.getElementById('view-reports').classList.add('active');
              destroyKetangChartsByPrefix('board-');
              // Force a board refresh while the board view is hidden. This catches
              // visibility checks that accidentally inspect the hidden canvas
              // instead of the live ECharts host.
              renderBoardRingChart('board-occ', 'chart-board-occ', 'board-occ-pct', {
                total: 10,
                occupied: 4,
                cleanEmpty: 5,
                dirty: 1,
                lodgerCount: 4,
                resvToday: 0,
                occPct: 40,
              });
              await new Promise(r => setTimeout(r, 100));
              document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
              const board = document.getElementById('view-board');
              board.classList.add('active');
              const ringWrap = document.getElementById('chart-board-occ').closest('.chart-ring-wrap');
              ringWrap.style.width = '132px';
              ringWrap.style.height = '132px';
              mountKetangChartsInRoot(board);
              if (typeof resizeKetangChart === 'function') {
                resizeKetangChart('board-occ');
              }
              if (typeof scheduleKetangEchartLayoutRefresh === 'function') {
                scheduleKetangEchartLayoutRefresh('board-occ');
              }
              await new Promise(r => setTimeout(r, 200));
              await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
              const host = document.getElementById('chart-board-occ-echart');
              const canvas = document.getElementById('chart-board-occ');
              const innerCanvas = host ? host.querySelector('canvas') : null;
              const sizeEl = innerCanvas || host;
              const rect = sizeEl ? sizeEl.getBoundingClientRect() : null;
              const hostRect = host ? host.getBoundingClientRect() : null;
              const pixelWidth = innerCanvas ? innerCanvas.width : 0;
              const pixelHeight = innerCanvas ? innerCanvas.height : 0;
              return {
                engine: typeof getKetangChartEngine === 'function'
                  ? getKetangChartEngine()
                  : null,
                hasHost: !!host,
                hasCanvas: !!innerCanvas,
                deferredKeys: typeof ketangChartDeferred !== 'undefined'
                  ? Object.keys(ketangChartDeferred)
                  : [],
                boardActive: document.getElementById('view-board').classList.contains('active'),
                hostRole: host ? host.getAttribute('role') : null,
                hostLabel: host ? host.getAttribute('aria-label') : null,
                group: typeof ketangEcharts !== 'undefined' && ketangEcharts['board-occ']
                  ? ketangEcharts['board-occ'].group
                  : null,
                width: rect ? Math.round(rect.width) : 0,
                height: rect ? Math.round(rect.height) : 0,
                hostWidth: hostRect ? Math.round(hostRect.width) : (host ? host.offsetWidth : 0),
                hostHeight: hostRect ? Math.round(hostRect.height) : (host ? host.offsetHeight : 0),
                pixelWidth: pixelWidth,
                pixelHeight: pixelHeight,
              };
            } catch (err) {
              return { error: err && (err.stack || err.message || String(err)) };
            }
          })()
        """
        result = evaluate(ws, expr, timeout=30).get("value") or {}
        errors = collect_errors(ws, 1.0)
        if errors:
            print("FAIL: console errors during ECharts runtime test")
            print(errors)
            sys.exit(1)
        expected = {
            "engine": "echarts",
            "hasHost": True,
            "hasCanvas": True,
            "hostRole": "img",
            "hostLabel": "床位概览",
            "group": "ketang-board",
        }
        for key, value in expected.items():
            if result.get(key) != value:
                print(f"FAIL: {key} expected {value!r}, got {result.get(key)!r}")
                print(result)
                sys.exit(1)
        if result.get("width", 0) <= 0 and result.get("height", 0) <= 0:
            if result.get("pixelWidth", 0) <= 0 or result.get("pixelHeight", 0) <= 0:
                print("FAIL: ECharts ring host has no rendered size")
                print(result)
                sys.exit(1)
        layout_ok = (
            result.get("hostWidth", 0) > 0 and result.get("hostHeight", 0) > 0
        ) or (
            result.get("pixelWidth", 0) >= 120 and result.get("pixelHeight", 0) >= 120
        )
        if not layout_ok:
            print("FAIL: ECharts ring host has no CSS layout size")
            print(result)
            sys.exit(1)

        pie_expr = """
          (async () => {
            try {
              document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
              document.getElementById('view-board').classList.add('active');
              if (typeof renderTodayMealsPanel === 'function') {
                renderTodayMealsPanel();
              }
              mountKetangChartsInRoot(document.getElementById('view-board'));
              if (typeof resizeKetangChart === 'function') {
                resizeKetangChart('meals-panel-bf');
              }
              await new Promise(r => setTimeout(r, 120));
              await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
              const host = document.getElementById('chart-meals-bf-echart');
              const innerCanvas = host ? host.querySelector('canvas') : null;
              const sizeEl = innerCanvas || host;
              const rect = sizeEl ? sizeEl.getBoundingClientRect() : null;
              return {
                hasHost: !!host,
                hasPieClass: host ? host.classList.contains('ketang-echart-host--pie') : false,
                hasCanvas: !!innerCanvas,
                width: rect ? Math.round(rect.width) : 0,
                height: rect ? Math.round(rect.height) : 0,
                pixelWidth: innerCanvas ? innerCanvas.width : 0,
                pixelHeight: innerCanvas ? innerCanvas.height : 0,
                engine: typeof ketangEcharts !== 'undefined' && ketangEcharts['meals-panel-bf']
                  ? 'echarts'
                  : null,
              };
            } catch (err) {
              return { error: err && (err.stack || err.message || String(err)) };
            }
          })()
        """
        pie_result = evaluate(ws, pie_expr, timeout=30).get("value") or {}
        if pie_result.get("error"):
            print("FAIL: meals pie runtime error")
            print(pie_result)
            sys.exit(1)
        pie_expected = {
            "hasHost": True,
            "hasPieClass": True,
            "hasCanvas": True,
            "engine": "echarts",
        }
        for key, value in pie_expected.items():
            if pie_result.get(key) != value:
                print(f"FAIL: meals pie {key} expected {value!r}, got {pie_result.get(key)!r}")
                print(pie_result)
                sys.exit(1)
        if pie_result.get("width", 0) <= 0 or pie_result.get("height", 0) <= 0:
            if pie_result.get("pixelWidth", 0) <= 0 or pie_result.get("pixelHeight", 0) <= 0:
                print("FAIL: meals pie ECharts host has no rendered size")
                print(pie_result)
                sys.exit(1)

        print("OK ECharts runtime checks passed")
    finally:
        proc.terminate()
        server.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()
        try:
            server.wait(timeout=3)
        except subprocess.TimeoutExpired:
            server.kill()


if __name__ == "__main__":
    main()
