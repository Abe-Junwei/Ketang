#!/usr/bin/env python3
"""Board chart render perf: mobile viewport must skip ECharts inits."""
import json
import subprocess
import sys
import time

import websocket

from test_cdp import (
    CDP_PORT,
    PORT,
    cdp_ws_url,
    evaluate,
    recv_by_id,
    start_server,
    wait_for_cdp,
)
from test_file_protocol import chrome_binary


def run_case(ws, viewport_width, label):
    ws.send(
        json.dumps(
            {
                "id": 10,
                "method": "Emulation.setDeviceMetricsOverride",
                "params": {
                    "width": viewport_width,
                    "height": 900,
                    "deviceScaleFactor": 1,
                    "mobile": viewport_width <= 768,
                },
            }
        )
    )
    ws.recv()

    expr = """
      (async () => {
        const before = typeof getKetangChartPerfSummary === 'function'
          ? getKetangChartPerfSummary()
          : {};
        const t0 = performance.now();
        if (typeof renderBoard === 'function') {
          renderBoard();
        }
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const after = typeof getKetangChartPerfSummary === 'function'
          ? getKetangChartPerfSummary()
          : {};
        const boardKeys = Object.keys(
          typeof ketangEcharts !== 'undefined' ? ketangEcharts : {}
        ).filter(k => k.indexOf('board-') === 0 || k.indexOf('meals-panel-') === 0);
        return {
          viewport: window.innerWidth,
          mobile: typeof isMobileLayout === 'function' ? isMobileLayout() : null,
          renderMs: Math.round(performance.now() - t0),
          initDelta: (after.initCount || 0) - (before.initCount || 0),
          deferDelta: (after.deferCount || 0) - (before.deferCount || 0),
          boardChartKeys: boardKeys,
          deferredKeys: typeof ketangChartDeferred !== 'undefined'
            ? Object.keys(ketangChartDeferred)
            : [],
        };
      })()
    """
    result = evaluate(ws, expr, timeout=30).get("value") or {}
    print(f"{label}: {json.dumps(result, ensure_ascii=False)}")
    return result


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

        mobile = run_case(ws, 390, "mobile")
        desktop = run_case(ws, 1280, "desktop")

        if not mobile.get("mobile"):
            print("FAIL: mobile viewport did not match isMobileLayout()")
            sys.exit(1)
        if mobile.get("initDelta", 0) > 0:
            print("FAIL: mobile renderBoard should not init board/meals ECharts")
            sys.exit(1)
        if mobile.get("boardChartKeys"):
            print("FAIL: mobile should not keep board/meals ECharts keys:", mobile["boardChartKeys"])
            sys.exit(1)
        if desktop.get("initDelta", 0) < 1:
            print("FAIL: desktop renderBoard should init at least one chart")
            sys.exit(1)

        print(
            "OK chart render perf: mobile initDelta=0 renderMs=%s; desktop initDelta=%s renderMs=%s"
            % (mobile.get("renderMs"), desktop.get("initDelta"), desktop.get("renderMs"))
        )
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
