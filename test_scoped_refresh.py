#!/usr/bin/env python3
"""Phase 12 视图级写后刷新回归 | View-scoped refresh smoke test."""
from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SYNC = ROOT / "js" / "sync-coordinator.js"

REQUIRED_SNIPPETS = [
    "VIEW_SYNC_SCOPES",
    "refreshViewForScope",
    "resolveScopeModuleKey",
    "lodgingModuleForView",
    "domainsToModules(domains, options)",
    'module: "board"',
    "lodgers_active",
]


def static_checks() -> bool:
    text = SYNC.read_text(encoding="utf-8")
    missing = [s for s in REQUIRED_SNIPPETS if s not in text]
    if missing:
        print("FAIL sync-coordinator.js missing:", ", ".join(missing))
        return False
    print("OK static VIEW_SYNC_SCOPES contract")
    return True


def cdp_checks() -> bool:
    from test_cdp import PORT, cdp_ws_url, evaluate, start_server, wait_for_cdp
    from test_file_protocol import chrome_binary

    import json
    import websocket

    chrome = chrome_binary()
    if not chrome:
        print("SKIP CDP: Chrome not found")
        return True

    server = start_server()
    proc = subprocess.Popen(
        [
            chrome,
            "--remote-debugging-port=9225",
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
                    ["curl", "-s", "http://127.0.0.1:9225/json"],
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

        pages = subprocess.run(
            ["curl", "-s", "http://127.0.0.1:9225/json"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout
        import json as _json

        ws_url = None
        for page in _json.loads(pages):
            url = page.get("url", "")
            if page.get("type") == "page" and str(PORT) in url:
                ws_url = page.get("webSocketDebuggerUrl")
                break
        if not ws_url:
            print("FAIL no CDP page")
            return False

        ws = websocket.create_connection(ws_url, timeout=10)
        ws.send(_json.dumps({"id": 1, "method": "Runtime.enable"}))
        ws.recv()

        for _ in range(30):
            ready = evaluate(ws, "window.ketangReady").get("value")
            if ready is True:
                break
            time.sleep(0.5)
        else:
            print("FAIL app init timeout")
            return False

        probe = evaluate(
            ws,
            """
            ({
              scopes: typeof VIEW_SYNC_SCOPES === 'object' && !!VIEW_SYNC_SCOPES.board,
              refresh: typeof refreshViewForScope === 'function',
              active: typeof getActiveViewId === 'function',
              lodgingBoard: typeof lodgingModuleForView === 'function'
                && lodgingModuleForView('board') === 'board',
              stayModule: !!(VIEW_SYNC_SCOPES.stay && VIEW_SYNC_SCOPES.stay.module === 'board'),
              domainsFn: typeof domainsToModules === 'function'
                && domainsToModules(['lodging','board'], null).indexOf('board') !== -1
                && domainsToModules(['lodging','board'], null).indexOf('lodgers') === -1,
            })
            """,
        ).get("value") or {}

        ws.close()
        failures = [k for k, ok in probe.items() if not ok]
        if failures:
            print("FAIL CDP probe:", probe)
            return False
        print("OK CDP scoped refresh API:", probe)
        return True
    finally:
        proc.kill()
        proc.wait(timeout=5)
        server.kill()
        server.wait(timeout=5)


def main() -> int:
    if not static_checks():
        return 1
    if not cdp_checks():
        return 1
    print("PASS scoped refresh regression")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
