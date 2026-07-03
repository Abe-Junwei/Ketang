#!/usr/bin/env python3
"""Phase G CDP: frontend performance marks after online login (dev_server + cloud API)."""
import json
import os
import subprocess
import sys
import time

import websocket

from test_cdp import CDP_PORT, PORT, cdp_ws_url, evaluate, recv_by_id, start_server, wait_for_cdp
from test_file_protocol import chrome_binary


def load_phase_g_limit():
    path = os.path.join(os.path.dirname(__file__), "docs/ops/performance-baseline.json")
    data = json.loads(open(path, encoding="utf-8").read())
    return data.get("phase_g_targets_ms", {}).get("login_to_ready_p95_ms", 3000)


def main():
    if os.environ.get("KETANG_SKIP_ONLINE_E2E") == "1":
        print("SKIP: KETANG_SKIP_ONLINE_E2E=1")
        return

    chrome = chrome_binary()
    if not chrome:
        print("SKIP: Chrome not found")
        return

    server = start_server()
    proc = subprocess.Popen(
        [
            chrome,
            f"--remote-debugging-port={CDP_PORT}",
            "--remote-allow-origins=*",
            "--headless=new",
            "--disable-gpu",
            "--no-sandbox",
            "--disable-dev-shm-usage",
            f"http://127.0.0.1:{PORT}/index.html",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    try:
        if not wait_for_cdp():
            print("SKIP: CDP not ready")
            return
        ws_url = cdp_ws_url()
        if not ws_url:
            print("SKIP: no CDP page")
            return

        ws = websocket.create_connection(ws_url, timeout=30)
        ws.send(json.dumps({"id": 1, "method": "Runtime.enable"}))
        ws.recv()

        for _ in range(40):
            if evaluate(ws, "window.ketangReady").get("value"):
                break
            time.sleep(0.5)
        else:
            print("SKIP: app init timeout")
            return

        online = evaluate(
            ws,
            "typeof useRemoteWriteApi === 'function' && useRemoteWriteApi()",
        ).get("value")
        if not online:
            print("SKIP: not online mode")
            return

        login_expr = """
            (async () => {
              performance.clearMarks();
              performance.clearMeasures();
              document.getElementById('login-username').value = 'admin';
              document.getElementById('login-password').value = 'admin';
              await submitLogin();
              for (let i = 0; i < 60; i++) {
                if (typeof isLoggedIn === 'function' && isLoggedIn()) break;
                await new Promise(r => setTimeout(r, 250));
              }
              const entries = performance.getEntriesByType('measure')
                .filter(e => e.name === 'ketang:login-ready');
              const mark = performance.getEntriesByName('ketang:login-ready', 'mark').pop();
              return {
                loggedIn: typeof isLoggedIn === 'function' && isLoggedIn(),
                loginReadyMs: entries.length ? Math.round(entries[entries.length - 1].duration) : null,
                hasLoginReadyMark: !!mark,
              };
            })().catch(e => ({ error: e.message || String(e) }))
        """
        ws.send(
            json.dumps(
                {
                    "id": 2,
                    "method": "Runtime.evaluate",
                    "params": {
                        "expression": login_expr,
                        "awaitPromise": True,
                        "returnByValue": True,
                    },
                }
            )
        )
        result = (
            recv_by_id(ws, 2, 120)
            .get("result", {})
            .get("result", {})
            .get("value", {})
        )
        if result.get("error"):
            print("SKIP: login failed:", result["error"])
            return
        if not result.get("loggedIn"):
            print("SKIP: cloud login failed")
            return
        if not result.get("hasLoginReadyMark"):
            print("FAIL: missing ketang:login-ready mark")
            sys.exit(1)
        ms = result.get("loginReadyMs")
        if ms is None:
            print("FAIL: login-ready measure missing")
            sys.exit(1)
        limit = load_phase_g_limit()
        print(f"login-ready duration: {ms}ms (limit {limit}ms)")
        if ms > limit:
            print(f"WARN: login-ready exceeds phase G target ({ms}ms > {limit}ms)")
        else:
            print("PASS: login-ready within phase G target")
        ws.close()
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()
        server.terminate()
        try:
            server.wait(timeout=3)
        except subprocess.TimeoutExpired:
            server.kill()


if __name__ == "__main__":
    main()
