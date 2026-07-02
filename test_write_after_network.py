#!/usr/bin/env python3
"""Write-after network contract on production (CDP Network domain)."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time

BASE = os.environ.get("KETANG_BASE_URL", "https://wulingkt.net").rstrip("/")
APP_URL = os.environ.get("KETANG_APP_URL", f"{BASE}/")
CDP_PORT = int(os.environ.get("KETANG_CDP_PORT", "9228"))
PASSWORD = os.environ.get("KETANG_ADMIN_PASSWORD", "admin")
WRITE_LOOP = max(1, int(os.environ.get("KETANG_WRITE_LOOP", "1")))
BG_SMOKE = os.environ.get("KETANG_NETWORK_E2E_BG") == "1"


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


def assert_write_after_urls(urls: list[str], iteration: int) -> bool:
    api_urls = [u for u in urls if "/api/" in u]
    read_model = [u for u in api_urls if "/read-model" in u]
    read_modules = [u for u in api_urls if "/read/" in u or "/sync/delta" in u]

    if read_model:
        print(f"FAIL iteration {iteration}: write-after triggered read-model:", read_model)
        return False
    if len(read_modules) > 1:
        print(
            f"FAIL iteration {iteration}: too many module/delta requests: {len(read_modules)}",
        )
        return False
    if read_modules and not any("/read/settings_rooms" in u for u in read_modules):
        print(f"FAIL iteration {iteration}: expected settings_rooms read, got:", read_modules)
        return False
    return True


def main() -> int:
    if os.environ.get("KETANG_NETWORK_E2E") != "1":
        print("SKIP network E2E (set KETANG_NETWORK_E2E=1 to enable)")
        return 0

    loop_count = 3 if BG_SMOKE else WRITE_LOOP
    pause_background = not BG_SMOKE

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
            f"{APP_URL}",
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

        for _ in range(120):
            if cdp_evaluate(ws, "window.ketangReady === true").get("value"):
                break
            time.sleep(0.5)
        else:
            diag = cdp_evaluate(
                ws,
                "({ ready: window.ketangReady, title: document.title, href: location.href })",
                10,
            ).get("value")
            print("FAIL app did not initialize:", diag)
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

        if pause_background:
            pause_expr = """
            (function () {
              if (typeof stopBoardPolling === 'function') stopBoardPolling();
              if (typeof stopBoardStream === 'function') stopBoardStream(false);
              return true;
            })()
            """
            cdp_evaluate(ws, pause_expr, 10)
            time.sleep(0.5)

        room_ids: list[int] = []
        read_model_hits = 0

        for iteration in range(1, loop_count + 1):
            urls.clear()
            room_name = f"__e2e_room_{int(time.time())}_{iteration}"
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
                print(f"FAIL iteration {iteration} room create:", write_result)
                return 1

            api_urls = [u for u in urls if "/api/" in u]
            read_model = [u for u in api_urls if "/read-model" in u]
            read_modules = [u for u in api_urls if "/read/" in u or "/sync/delta" in u]
            read_model_hits += len(read_model)

            if WRITE_LOOP == 1 and not BG_SMOKE:
                print("Captured API URLs during write-after:")
                for u in api_urls:
                    print(" ", u)

            if not BG_SMOKE and not assert_write_after_urls(urls, iteration):
                return 1
            if BG_SMOKE and read_model:
                print(f"FAIL bg smoke iteration {iteration}: read-model:", read_model)
                return 1

            modules = write_result.get("changed_modules") or []
            if modules and modules != ["settings_rooms"]:
                print(f"WARN iteration {iteration} changed_modules:", modules)

            room_id = write_result.get("room_id")
            if room_id:
                room_ids.append(int(room_id))

        for room_id in room_ids:
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

        label = "bg smoke" if BG_SMOKE else "write-after"
        print(
            f"OK {label} network contract: loop={loop_count} "
            f"read-model={read_model_hits}"
            + ("" if BG_SMOKE else " module/delta<=1 per write")
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
