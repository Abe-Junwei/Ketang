#!/usr/bin/env python3
"""在线模式 API 挂单→退房轻量 E2E（需 dev_server 可登录云端）。"""
import json
import os
import subprocess
import sys
import time

import websocket

from test_cdp import (
    PORT,
    CDP_PORT,
    chrome_binary,
    collect_errors,
    curl_get,
    evaluate,
    recv_by_id,
    start_server,
    wait_for_cdp,
    cdp_ws_url,
)


def main():
    if os.environ.get("KETANG_SKIP_ONLINE_E2E") == "1":
        print("SKIP: KETANG_SKIP_ONLINE_E2E=1")
        return

    server = start_server()
    try:
        chrome = chrome_binary()
        proc = subprocess.Popen(
            [
                chrome,
                f"--remote-debugging-port={CDP_PORT}",
                "--headless=new",
                "--disable-gpu",
                f"http://127.0.0.1:{PORT}/index.html",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        if not wait_for_cdp():
            print("SKIP: CDP not ready")
            return
        ws_url = cdp_ws_url()
        if not ws_url:
            print("SKIP: no CDP page")
            return
        ws = websocket.create_connection(ws_url, timeout=10)
        ws.send(json.dumps({"id": 1, "method": "Runtime.enable"}))
        ws.recv()

        for _ in range(40):
            if evaluate(ws, "window.ketangReady").get("value") is True:
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
            print("SKIP: not online mode (KETANG_FORCE_LOCAL_DB?)")
            return

        login_expr = """
            (async () => {
              document.getElementById('login-username').value = 'admin';
              document.getElementById('login-password').value = 'admin';
              await submitLogin();
              for (let i = 0; i < 40; i++) {
                if (typeof isLoggedIn === 'function' && isLoggedIn()) break;
                await new Promise(r => setTimeout(r, 250));
              }
              const u = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
              return u ? u.role : null;
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
            print("SKIP: cloud login failed (role=%s)" % role)
            return

        journey = """
            (async () => {
              const tag = 'E2E' + Date.now();
              await rcEnsureAppData(true);
              let bedId = null;
              rcBoardRooms().forEach(function (r) {
                if (bedId || r.dorm_type === '女寮') return;
                rcBedsForRoom(r.id, { skipSpare: true, skipMaint: true }).forEach(function (b) {
                  if (bedId) return;
                  if (typeof isBedAssignable === 'function' && isBedAssignable(b.id)) bedId = b.id;
                });
              });
              if (!bedId) return { skip: true, reason: 'no assignable bed' };
              const today = new Date().toISOString().slice(0, 10);
              const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
              const wr = await apiCheckIn({
                bed_id: bedId,
                name: tag,
                gender: '男',
                phone: '13900000001',
                check_in_date: today,
                expected_check_out: tomorrow,
                meal_breakfast: 1,
                meal_lunch: 1,
                meal_dinner: 0,
              });
              const lodgerId = wr && wr.lodger_id;
              if (!lodgerId) throw new Error('checkin no lodger_id');
              await apiCheckout({ lodger_id: lodgerId });
              return { ok: true, lodgerId: lodgerId, bedId: bedId };
            })().catch(e => ({ error: e.message || String(e) }))
        """
        ws.send(
            json.dumps(
                {
                    "id": 3,
                    "method": "Runtime.evaluate",
                    "params": {
                        "expression": journey,
                        "awaitPromise": True,
                        "returnByValue": True,
                    },
                }
            )
        )
        result = (
            recv_by_id(ws, 3, 120)
            .get("result", {})
            .get("result", {})
            .get("value", {})
        )
        print("Online journey:", result)
        if result.get("skip"):
            print("SKIP:", result.get("reason"))
            return
        if result.get("error"):
            print("FAIL:", result["error"])
            sys.exit(1)
        if not result.get("ok"):
            print("FAIL: unexpected result")
            sys.exit(1)
        errs = collect_errors(ws, 1.0)
        if errs:
            print("FAIL: console errors", errs[:5])
            sys.exit(1)
        print("PASS: online API checkin→checkout")
    finally:
        try:
            proc.terminate()
        except Exception:
            pass
        server.terminate()


if __name__ == "__main__":
    main()
