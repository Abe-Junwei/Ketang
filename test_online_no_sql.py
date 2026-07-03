#!/usr/bin/env python3
"""Phase F: online boot must not load sql-wasm.js / sql-wasm.wasm."""
import json
import subprocess
import sys
import time
from pathlib import Path

import websocket

from test_cdp import CDP_PORT, PORT, cdp_ws_url, evaluate, start_server, wait_for_cdp
from test_file_protocol import chrome_binary


def read(path):
    return Path(path).read_text(encoding="utf-8")


def static_checks():
    sync = read("js/sync-coordinator.js")
    rc = read("js/read-cache.js")
    fetch_body = sync[sync.find("async function fetchAndApplyModule") :]
    hydrate_body = rc[rc.find("async function rcHydrateLegacyQueries") :]
    checks = [
        ("fetch skips sql online", "shouldSkipSqlDeltaHydrate" in fetch_body),
        ("hydrate skips sql online", "shouldSkipSqlDeltaHydrate" in hydrate_body),
    ]
    failed = [name for name, ok in checks if not ok]
    if failed:
        print("FAIL online no sql static:", ", ".join(failed))
        sys.exit(1)


def main():
    static_checks()
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

        html = open("index.html", encoding="utf-8").read()
        if "sql-wasm.js" in html.split("<script")[1:]:
            print("FAIL: index.html still references sql-wasm.js in script tags")
            sys.exit(1)

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
            ({
              hasSqlScript: !!document.querySelector('script[src*="sql-wasm"]'),
              initSqlJsDefined: typeof initSqlJs !== 'undefined',
              isRemote: typeof isRemoteDB === 'function' && isRemoteDB(),
              needsLocal: typeof needsLocalSqlEngine === 'function' && needsLocalSqlEngine(),
              sqlLoaded: typeof isLocalSqlEngineLoaded === 'function' && isLocalSqlEngineLoaded(),
              resources: performance.getEntriesByType('resource')
                .filter(function (e) { return /sql-wasm/.test(e.name); })
                .map(function (e) { return e.name; })
            })
            """,
        ).get("value", {})

        if probe.get("hasSqlScript"):
            print("FAIL: sql-wasm script tag present:", probe)
            sys.exit(1)
        if probe.get("initSqlJsDefined"):
            print("FAIL: initSqlJs loaded on online boot:", probe)
            sys.exit(1)
        if probe.get("resources"):
            print("FAIL: sql-wasm resources fetched:", probe)
            sys.exit(1)
        if not probe.get("isRemote"):
            print("FAIL: expected online remote DB mode:", probe)
            sys.exit(1)
        if probe.get("needsLocal"):
            print("FAIL: needsLocalSqlEngine true on online boot:", probe)
            sys.exit(1)
        if probe.get("sqlLoaded"):
            print("FAIL: local sql engine loaded on online boot:", probe)
            sys.exit(1)

        ws.close()
        print("PASS: online boot does not load sql-wasm.js / sql-wasm.wasm")
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
