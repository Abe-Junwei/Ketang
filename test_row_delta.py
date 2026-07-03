#!/usr/bin/env python3
"""Phase 12.4 row-level delta schema + patch_mode contract checks."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def static_checks() -> bool:
    row_sync = (ROOT / "functions/_shared/row-sync.js").read_text(encoding="utf-8")
    sync_delta = (ROOT / "functions/_shared/sync-delta.js").read_text(encoding="utf-8")
    db_js = (ROOT / "js/db.js").read_text(encoding="utf-8")
    schema = (ROOT / "functions/_shared/schema.js").read_text(encoding="utf-8")

    required = [
        ("row-sync.js", "tryBuildRowPatches", row_sync),
        ("row-sync.js", "ensureRowSyncSchema", row_sync),
        ("row-sync.js", "SYNC_TOUCH_TABLES", row_sync),
        ("row-sync.js", "rowSyncV22MigrationStatements", row_sync),
        ("row-sync.js", "insertTriggerName", row_sync),
        ("sync-delta.js", "patch_mode", sync_delta),
        ("sync-timestamp.js", "normalizeSyncTimestamp", (ROOT / "functions/_shared/sync-timestamp.js").read_text(encoding="utf-8")),
        ("db.js", "migrateV20toV21", db_js),
        ("db.js", "migrateV21toV22", db_js),
        ("db.js", "upsertOnly", db_js),
        ("db.js", "patch_mode", db_js),
        ("db.js", "invalid payload", db_js),
        ("schema.js", "SELECT 22", schema),
        ("sync-modules.js", 'lodging: ["lodgers_active", "lodgers_lookup"]', (ROOT / "functions/_shared/sync-modules.js").read_text(encoding="utf-8")),
        ("sync-coordinator.js", "refreshViewForScope(getActiveViewId(), options)", (ROOT / "js/sync-coordinator.js").read_text(encoding="utf-8")),
    ]
    ok = True
    for label, needle, text in required:
        if needle not in text:
            print(f"FAIL {label} missing {needle}")
            ok = False
    if ok:
        print("OK Phase 12.4 row delta static contract")
    return ok


def cdp_checks() -> bool:
    from test_cdp import PORT, evaluate, start_server
    from test_file_protocol import chrome_binary

    import json
    import subprocess
    import time
    import websocket

    if not chrome_binary():
        print("SKIP CDP: Chrome not found")
        return True

    server = start_server()
    proc = subprocess.Popen(
        [
            chrome_binary(),
            "--remote-debugging-port=9227",
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
                    ["curl", "-s", "http://127.0.0.1:9227/json"],
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
                ["curl", "-s", "http://127.0.0.1:9227/json"],
                capture_output=True,
                text=True,
                check=True,
            ).stdout
        )
        ws_url = next(
            (
                p.get("webSocketDebuggerUrl")
                for p in pages
                if p.get("type") == "page" and str(PORT) in p.get("url", "")
            ),
            None,
        )
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
            (function () {
              var cols = db.exec("PRAGMA table_info(lodgers)")[0].values.map(function (r) { return r[1]; });
              var ver = db.exec("SELECT MIN(version) as v FROM schema_version")[0].values[0][0];
              run("INSERT INTO lodgers (name, status, check_in_date) VALUES (?, ?, ?)", ['__v22_probe', '在住', '2026-07-01']);
              var id = db.exec("SELECT last_insert_rowid() as id")[0].values[0][0];
              var row = db.exec("SELECT updated_at FROM lodgers WHERE id = " + id)[0].values[0][0];
              run("DELETE FROM lodgers WHERE id = ?", [id]);
              return {
                hasUpdatedAt: cols.indexOf('updated_at') !== -1,
                schemaV22: ver >= 22,
                upsertPath: typeof applyRemoteDelta === 'function',
                insertTriggerSetsTs: !!(row && String(row).length >= 10),
              };
            })()
            """,
        ).get("value") or {}
        ws.close()
        if not probe.get("hasUpdatedAt") or not probe.get("schemaV22"):
            print("FAIL local v22 migration:", probe)
            return False
        if not probe.get("insertTriggerSetsTs"):
            print("FAIL INSERT trigger did not set updated_at:", probe)
            return False
        print("OK local v22 migration:", probe)
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
    print("PASS row delta regression")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
