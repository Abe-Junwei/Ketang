#!/usr/bin/env python3
"""Phase F: online mode must reject bare query() calls."""
import json
import subprocess
import sys
import time

import websocket

from test_cdp import CDP_PORT, PORT, cdp_ws_url, evaluate, start_server, wait_for_cdp
from test_file_protocol import chrome_binary


def main():
    chrome = chrome_binary()
    if not chrome:
        print("SKIP: Chrome not found")
        sys.exit(0)

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
            print("FAIL: CDP not ready")
            sys.exit(1)
        ws_url = cdp_ws_url()
        if not ws_url:
            print("FAIL: no CDP page")
            sys.exit(1)

        ws = websocket.create_connection(ws_url, timeout=30)
        ws.send(json.dumps({"id": 1, "method": "Runtime.enable"}))
        ws.recv()

        for _ in range(40):
            if evaluate(ws, "window.ketangReady").get("value"):
                break
            time.sleep(0.5)
        else:
            print("FAIL: app did not initialize")
            sys.exit(1)

        probe = evaluate(
            ws,
            """
            (function () {
              try {
                query('SELECT 1');
                return { threw: false };
              } catch (e) {
                return {
                  threw: true,
                  msg: e && e.message ? e.message : String(e),
                };
              }
            })()
            """,
        ).get("value", {})

        if not probe.get("threw"):
            print("FAIL: query() should throw online:", probe)
            sys.exit(1)
        msg = str(probe.get("msg", ""))
        if "在线模式不应调用 query()" not in msg:
            print("FAIL: unexpected error message:", msg)
            sys.exit(1)
        if "caller:" not in msg:
            print("FAIL: missing caller hint:", msg)
            sys.exit(1)

        ws.close()
        print("PASS: online query() guard throws with caller hint")
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
