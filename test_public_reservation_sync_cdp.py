#!/usr/bin/env python3
"""Phase E: 公开预约 delta 同步后后台列表无刷新可见（CDP 模拟 delta + notify）。"""
import json
import subprocess
import sys
import time

import websocket

from test_cdp import CDP_PORT, PORT, cdp_ws_url, evaluate, recv_by_id, start_server, wait_for_cdp
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

        login_expr = """
            (async () => {
              document.getElementById('login-username').value = 'admin';
              document.getElementById('login-password').value = 'admin';
              await submitLogin();
              for (let i = 0; i < 40; i++) {
                if (typeof isLoggedIn === 'function' && isLoggedIn()) break;
                await new Promise(r => setTimeout(r, 250));
              }
              return typeof getCurrentUser === 'function' && getCurrentUser() ? getCurrentUser().role : null;
            })()
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
        role = (
            recv_by_id(ws, 2, 90)
            .get("result", {})
            .get("result", {})
            .get("value")
        )
        if role != "admin":
            print("FAIL: login failed, role=", role)
            sys.exit(1)

        sync_expr = """
            (async () => {
              if (typeof setStayMode === 'function') setStayMode('reservation');
              showView('stay');
              await new Promise(r => setTimeout(r, 400));
              const stamp = 'E2E同步' + Date.now();
              const id = 990000 + (Date.now() % 10000);
              const row = {
                id: id,
                name: stamp,
                gender: '男',
                phone: '13800138999',
                id_card: '110101199001011299',
                expected_check_in: '2026-09-15',
                expected_check_out: null,
                status: '预约',
                source: '公开预约',
                role: '学员',
                meal_breakfast: 1,
                meal_lunch: 1,
                meal_dinner: 1,
                room_preference: null,
                notes: null,
              };
              const tbody = document.getElementById('resv-table');
              const before = tbody && tbody.innerHTML.includes(stamp);
              if (typeof rcApplyDeltaPatches !== 'function' || typeof notifyViewsForDomains !== 'function') {
                return { error: 'missing sync helpers' };
              }
              if (typeof rcStorePayload === 'function' && !rcModuleCached('reservations')) {
                rcStorePayload('reservations', { tables: { reservations: [] } });
              }
              if (typeof remoteReadModelReady !== 'undefined') remoteReadModelReady = true;
              rcApplyDeltaPatches({ reservations: [row] }, []);
              notifyViewsForDomains(['reservations']);
              await new Promise(r => setTimeout(r, 350));
              const after = tbody && tbody.innerHTML.includes(stamp);
              const checkinOk = (function () {
                if (typeof checkInFromResv !== 'function') return { skip: true };
                const src = checkInFromResv.toString();
                if (!src.includes('reservationForStatus')) return { error: 'checkInFromResv not rc-aware' };
                checkInFromResv(id);
                const ciName = document.getElementById('ci-name') && document.getElementById('ci-name').value;
                return { ciName: ciName || '', matches: ciName === stamp };
              })();
              return {
                before: !!before,
                after: !!after,
                rcReady: typeof rcReadReady === 'function' && rcReadReady(),
                mode: typeof _pendingStayMode !== 'undefined' ? _pendingStayMode : null,
                checkinOk,
              };
            })().catch(e => ({ error: e.message || String(e) }))
        """
        ws.send(
            json.dumps(
                {
                    "id": 3,
                    "method": "Runtime.evaluate",
                    "params": {
                        "expression": sync_expr,
                        "awaitPromise": True,
                        "returnByValue": True,
                    },
                }
            )
        )
        result = (
            recv_by_id(ws, 3, 90)
            .get("result", {})
            .get("result", {})
            .get("value", {})
        )
        if result.get("error"):
            print("FAIL:", result["error"])
            sys.exit(1)
        if result.get("before"):
            print("FAIL: row visible before delta")
            sys.exit(1)
        if not result.get("after"):
            print("FAIL: reservation row not visible after notifyViewsForDomains:", result)
            sys.exit(1)
        checkin = result.get("checkinOk") or {}
        if checkin.get("error"):
            print("FAIL:", checkin["error"])
            sys.exit(1)
        if not checkin.get("skip") and not checkin.get("matches"):
            print("FAIL: checkInFromResv did not populate form:", checkin)
            sys.exit(1)

        ws.close()
        print("PASS: reservation delta sync refreshes list and checkInFromResv reads rc row")
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
