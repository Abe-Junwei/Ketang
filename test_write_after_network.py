#!/usr/bin/env python3
"""Write-after network contract on production (CDP Network domain)."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time

BASE = os.environ.get("KETANG_BASE_URL", "https://wulingkt.net").rstrip("/")
CDP_PORT = int(os.environ.get("KETANG_CDP_PORT", "9228"))
PASSWORD = os.environ.get("KETANG_ADMIN_PASSWORD", "admin")


def cdp_evaluate(ws, expression, timeout=60):
    req_id = int(time.time() * 1000) % 1000000 + 100
    ws.send(
        json.dumps(
            {
                "id": req_id,
                "method": "Runtime.evaluate",
                "params": {
                    "expression": expression,
                    "awaitPromise": True,
                    "returnByValue": True,
                },
            },
        ),
    )
    deadline = time.time() + timeout
    while time.time() < deadline:
        ws.settimeout(max(0.1, deadline - time.time()))
        msg = json.loads(ws.recv())
        if msg.get("id") == req_id:
            return msg.get("result", {}).get("result", {})
    return {}


def main() -> int:
    if os.environ.get("KETANG_NETWORK_E2E") != "1":
        print("SKIP network E2E (set KETANG_NETWORK_E2E=1 to enable)")
        return 0

    from test_file_protocol import chrome_binary

    import websocket

    chrome = chrome_binary()
    if not chrome:
        print("SKIP network E2E: Chrome not found")
        return 0

    proc = subprocess.Popen(
        [
            chrome,
            f"--remote-debugging-port={CDP_PORT}",
            "--remote-allow-origins=*",
            "--headless=new",
            "--disable-gpu",
            "--no-sandbox",
            "--disable-dev-shm-usage",
            f"{BASE}/index.html",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    ws = None
    try:
        for _ in range(40):
            try:
                subprocess.run(
                    ["curl", "-s", f"http://127.0.0.1:{CDP_PORT}/json"],
                    capture_output=True,
                    check=True,
                    timeout=1,
                )
                break
            except Exception:
                time.sleep(0.5)
        else:
            print("FAIL CDP not ready")
            return 1

        pages = json.loads(
            subprocess.run(
                ["curl", "-s", f"http://127.0.0.1:{CDP_PORT}/json"],
                capture_output=True,
                text=True,
                check=True,
            ).stdout
        )
        page = next((p for p in pages if p.get("type") == "page"), None)
        if not page:
            print("FAIL no CDP page")
            return 1

        ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=30)
        req_id = 0
        urls: list[str] = []

        def send(method, params=None):
            nonlocal req_id
            req_id += 1
            ws.send(
                json.dumps({"id": req_id, "method": method, "params": params or {}}),
            )
            return req_id

        def recv_id(target_id, timeout=90):
            deadline = time.time() + timeout
            while time.time() < deadline:
                ws.settimeout(max(0.1, deadline - time.time()))
                msg = json.loads(ws.recv())
                if msg.get("method") == "Network.requestWillBeSent":
                    url = msg.get("params", {}).get("request", {}).get("url", "")
                    if url:
                        urls.append(url)
                if msg.get("id") == target_id:
                    return msg
            return {}

        send("Network.enable")
        recv_id(send("Runtime.enable"), 10)

        for _ in range(60):
            if cdp_evaluate(ws, "window.ketangReady === true").get("value"):
                break
            time.sleep(0.5)
        else:
            print("FAIL app did not initialize")
            return 1

        login_expr = f"""
        (async function () {{
          if (typeof isRemoteDB === 'function' && isRemoteDB()) {{
            document.getElementById('login-username').value = 'admin';
            document.getElementById('login-password').value = '{PASSWORD}';
            await submitLogin();
            return !!(getCurrentUser && getCurrentUser());
          }}
          document.getElementById('login-username').value = 'admin';
          document.getElementById('login-password').value = '{PASSWORD}';
          await submitLogin();
          return !!(getCurrentUser && getCurrentUser());
        }})()
        """
        lid = send(
            "Runtime.evaluate",
            {"expression": login_expr, "awaitPromise": True, "returnByValue": True},
        )
        login = recv_id(lid).get("result", {}).get("result", {}).get("value")
        if not login:
            print("FAIL login on production")
            return 1

        # Pause background SSE/polling so we only measure write-after sync.
        pause_expr = """
        (function () {
          if (typeof stopBoardPolling === 'function') stopBoardPolling();
          if (typeof stopBoardStream === 'function') stopBoardStream(false);
          return true;
        })()
        """
        cdp_evaluate(ws, pause_expr, 10)
        time.sleep(0.5)

        urls.clear()
        room_name = f"__e2e_room_{int(time.time())}"
        write_expr = f"""
        (async function () {{
          const res = await fetch('/api/v1/admin/records', {{
            method: 'POST',
            credentials: 'include',
            headers: {{ 'Content-Type': 'application/json' }},
            body: JSON.stringify({{
              resource: 'room',
              action: 'create',
              name: '{room_name}',
              dorm_type: '不限',
              floor: 1,
            }}),
          }});
          const data = await res.json();
          if (!data.ok) throw new Error(JSON.stringify(data));
          if (typeof syncAfterRemoteWrite === 'function') {{
            await syncAfterRemoteWrite(data, {{ infoOnly: true, infoTab: 'rooms' }});
          }}
          return data;
        }})()
        """
        wid = send(
            "Runtime.evaluate",
            {"expression": write_expr, "awaitPromise": True, "returnByValue": True},
        )
        write_result = recv_id(wid).get("result", {}).get("result", {}).get("value")
        if not write_result or not write_result.get("ok"):
            print("FAIL room create:", write_result)
            return 1

        api_urls = [u for u in urls if "/api/" in u]
        read_model = [u for u in api_urls if "/read-model" in u]
        read_modules = [u for u in api_urls if "/read/" in u or "/sync/delta" in u]

        print("Captured API URLs during write-after:")
        for u in api_urls:
            print(" ", u)

        if read_model:
            print("FAIL write-after triggered read-model:", read_model)
            return 1
        if len(read_modules) > 1:
            print(f"FAIL too many module/delta requests during write-after: {len(read_modules)}")
            return 1
        if read_modules and not any("/read/settings_rooms" in u for u in read_modules):
            print("FAIL expected settings_rooms read, got:", read_modules)
            return 1

        modules = write_result.get("changed_modules") or []
        if modules and modules != ["settings_rooms"]:
            print("WARN changed_modules:", modules)

        room_id = write_result.get("room_id")
        if room_id:
            cleanup_expr = f"""
            (async function () {{
              const res = await fetch('/api/v1/admin/records', {{
                method: 'POST',
                credentials: 'include',
                headers: {{ 'Content-Type': 'application/json' }},
                body: JSON.stringify({{ resource: 'room', action: 'delete', room_id: {room_id} }}),
              }});
              return await res.json();
            }})()
            """
            cid = send(
                "Runtime.evaluate",
                {
                    "expression": cleanup_expr,
                    "awaitPromise": True,
                    "returnByValue": True,
                },
            )
            recv_id(cid, 30)

        print(
            f"OK write-after network contract: read-model=0 module/delta={len(read_modules)}"
        )
        return 0
    finally:
        if ws:
            try:
                ws.close()
            except Exception:
                pass
        proc.kill()
        proc.wait(timeout=5)


if __name__ == "__main__":
    raise SystemExit(main())
