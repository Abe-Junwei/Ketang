#!/usr/bin/env python3
"""Write response + client sync module contract regression."""
from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def static_server_checks() -> bool:
    write_resp = (ROOT / "functions/_shared/write-response.js").read_text(
        encoding="utf-8"
    )
    sync_mod = (ROOT / "functions/_shared/sync-modules.js").read_text(
        encoding="utf-8"
    )
    client = (ROOT / "js/sync-coordinator.js").read_text(encoding="utf-8")
    required = [
        ("write-response.js", "changed_modules", write_resp),
        ("sync-modules.js", "resolveChangedModules", sync_mod),
        ("sync-modules.js", 'lodging: ["lodgers_records"]', sync_mod),
        ("sync-coordinator.js", "writeResultToModules", client),
        ("sync-coordinator.js", "syncRemoteByModules", client),
    ]
    dedupe_needles = ['k !== "lodgers_records"', 'k !== "lodgers"', 'k !== "settings"']
    ok = True
    for label, needle, text in required:
        if needle not in text:
            print(f"FAIL {label} missing {needle}")
            ok = False
    for needle in dedupe_needles:
        if needle not in sync_mod or needle not in client:
            print(f"FAIL dedupe rule missing in server/client: {needle}")
            ok = False
    if ok:
        print("OK static write/sync module contract")
    return ok


def cdp_checks() -> bool:
    from test_cdp import PORT, evaluate, start_server
    from test_file_protocol import chrome_binary

    import json
    import websocket

    if not chrome_binary():
        print("SKIP CDP: Chrome not found")
        return True

    server = start_server()
    proc = subprocess.Popen(
        [
            chrome_binary(),
            "--remote-debugging-port=9226",
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
        for _ in range(30):
            try:
                subprocess.run(
                    ["curl", "-s", "http://127.0.0.1:9226/json"],
                    capture_output=True,
                    check=True,
                    timeout=1,
                )
                break
            except Exception:
                time.sleep(0.5)
        else:
            print("FAIL CDP not ready")
            return False

        pages = json.loads(
            subprocess.run(
                ["curl", "-s", "http://127.0.0.1:9226/json"],
                capture_output=True,
                text=True,
                check=True,
            ).stdout
        )
        ws_url = None
        for page in pages:
            if page.get("type") == "page" and str(PORT) in page.get("url", ""):
                ws_url = page.get("webSocketDebuggerUrl")
                break
        if not ws_url:
            print("FAIL no CDP page")
            return False

        ws = websocket.create_connection(ws_url, timeout=10)
        ws.send(json.dumps({"id": 1, "method": "Runtime.enable"}))
        ws.recv()
        for _ in range(30):
            if evaluate(ws, "window.ketangReady").get("value") is True:
                break
            time.sleep(0.5)
        else:
            print("FAIL app init timeout")
            return False

        probe = evaluate(
            ws,
            """
            ({
              serverHint: writeResultToModules({
                changed_domains: ['lodging', 'board', 'housekeeping'],
                changed_modules: ['board'],
              }).join(','),
              domainFallback: writeResultToModules({
                changed_domains: ['settings'],
              }).indexOf('settings') !== -1,
              dedupe: writeResultToModules({
                changed_modules: ['board', 'lodgers_records'],
              }).join(',') === 'board',
            })
            """,
        ).get("value") or {}
        ws.close()
        if probe.get("serverHint") != "board":
            print("FAIL server changed_modules not preferred:", probe)
            return False
        if not probe.get("domainFallback"):
            print("FAIL domain fallback:", probe)
            return False
        if not probe.get("dedupe"):
            print("FAIL module dedupe:", probe)
            return False
        print("OK CDP writeResultToModules:", probe)
        return True
    finally:
        proc.kill()
        proc.wait(timeout=5)
        server.kill()
        server.wait(timeout=5)


def main() -> int:
    if not static_server_checks():
        return 1
    if not cdp_checks():
        return 1
    print("PASS write/sync module contract")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
