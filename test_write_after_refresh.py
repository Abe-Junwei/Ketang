#!/usr/bin/env python3
"""写后即时刷新：rcRefreshAfterWrite 必须 patch 缓存并重绘 DOM（非轮询兜底）。"""
import json
import subprocess
import sys
import time
import websocket

from test_cdp import start_server, wait_for_cdp, cdp_ws_url, evaluate, recv_by_id, CDP_PORT
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
            f"http://127.0.0.1:8125/index.html",
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

        for _ in range(40):
            if evaluate(ws, "window.ketangReady").get("value"):
                break
            time.sleep(0.5)
        else:
            print("FAIL: app did not initialize")
            sys.exit(1)

        probe = evaluate(
            ws,
            """(() => {
              const src = rcRefreshAfterWrite.toString();
              return {
                isAsync: rcRefreshAfterWrite.constructor.name === 'AsyncFunction',
                hasApply: src.includes('rcApplyWriteResult'),
                hasInvalidate: src.includes('rcInvalidateMany'),
                preTouchesVersion: src.includes('touchBoardVersionFromWrite'),
              };
            })()""",
        ).get("value", {})
        if (
            probe.get("isAsync")
            or not probe.get("hasApply")
            or probe.get("hasInvalidate")
            or probe.get("preTouchesVersion")
        ):
            print("FAIL: rcRefreshAfterWrite wrong implementation:", probe)
            sys.exit(1)

        evaluate(
            ws,
            """(async()=>{
              document.getElementById('login-username').value='admin';
              document.getElementById('login-password').value='admin';
              await submitLogin();
            })()""",
        )
        time.sleep(4)
        evaluate(ws, "showView('info'); renderInfo('rooms')")
        time.sleep(2)

        stamp = int(time.time() * 1000) % 1000000
        expr = f"""(async () => {{
          const name = 'E2E房间{stamp}';
          const wr = await apiAdminRecord('room', 'create', {{
            name, location: '测试', floor: 1, dorm_type: '男寮', notes: ''
          }});
          infoRefreshAfterWrite(wr, 'rooms');
          await new Promise(r => setTimeout(r, 300));
          const inCache = (rcTables('settings_beds').rooms || []).some(r => r.name === name);
          const inDom = document.body.innerHTML.includes(name);
          let callErr = null;
          try {{
            await rcRefreshAfterWrite(wr, {{ infoTab: 'rooms', skipViewRefresh: true }});
          }} catch (e) {{
            callErr = e.message || String(e);
          }}
          return {{ inCache, inDom, callErr, hasPatches: !!wr.patches }};
        }})()"""

        ws.send(
            json.dumps(
                {
                    "id": 10,
                    "method": "Runtime.evaluate",
                    "params": {
                        "expression": expr,
                        "awaitPromise": True,
                        "returnByValue": True,
                    },
                }
            )
        )
        result = (
            recv_by_id(ws, 10, 90)
            .get("result", {})
            .get("result", {})
            .get("value", {})
        )
        if result.get("callErr"):
            print("FAIL: rcRefreshAfterWrite threw:", result.get("callErr"))
            sys.exit(1)
        if not result.get("hasPatches"):
            print("FAIL: write API missing patches")
            sys.exit(1)
        if not result.get("inCache"):
            print("FAIL: room not in _rcStore after write")
            sys.exit(1)
        if not result.get("inDom"):
            print("FAIL: room not in DOM after write")
            sys.exit(1)
        print("PASS: instant post-write cache + DOM refresh")
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
