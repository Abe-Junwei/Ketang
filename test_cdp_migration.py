#!/usr/bin/env python3
"""CDP test: import a V3 DB and verify V10 migration applied."""
import subprocess
import sys
import time
import json
import websocket
from test_cdp import start_server, wait_for_cdp, cdp_ws_url, evaluate, collect_errors
from test_file_protocol import chrome_binary

PORT = 8125
CDP_PORT = 9224

def main():
    server = start_server()
    chrome = chrome_binary()
    if not chrome:
        print("SKIP: Chrome not found")
        sys.exit(0)
    proc = subprocess.Popen([
        chrome,
        f"--remote-debugging-port={CDP_PORT}",
        "--remote-allow-origins=*",
        "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
        f"http://127.0.0.1:{PORT}/index.html"
    ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    try:
        if not wait_for_cdp():
            print("FAIL: CDP not ready")
            sys.exit(1)
        ws_url = cdp_ws_url()
        if not ws_url:
            print("FAIL: no CDP page")
            sys.exit(1)

        ws = websocket.create_connection(ws_url, timeout=10)
        ws.send(json.dumps({'id': 2, 'method': 'Runtime.enable'}))
        ws.recv()

        for _ in range(30):
            res = evaluate(ws, 'window.ketangReady')
            if res.get('value') is True:
                break
            time.sleep(0.5)
        else:
            print("FAIL: app did not initialize")
            sys.exit(1)

        # Fetch V3 DB and import via JS (same migration chain as importDB)
        import_expr = """
            (async () => {
                const r = await fetch('test_v3.db');
                const buf = await r.arrayBuffer();
                const arr = new Uint8Array(buf);
                db = new SQL.Database(arr);
                initSchema();
                migrateV1toV2();
                migrateV2toV3();
                migrateV3toV4();
                migrateV4toV5();
                migrateV5toV6();
                migrateV6toV7();
                migrateV7toV8();
                migrateV8toV9();
                migrateV9toV10();
                migrateV10toV11();
                migrateV11toV12();
                migrateV12toV13();
                migrateV13toV14();
                migrateV14toV15();
                createIndexes();
                seedRooms();
                await saveDB();
                const version = db.exec('SELECT version FROM schema_version')[0].values[0][0];
                const roleCheck = db.exec("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'")[0].values[0][0];
                const advancedCol = db.exec("PRAGMA table_info(users)")[0].values.some(c => c[1] === 'is_advanced');
                const permissionsCol = db.exec("PRAGMA table_info(users)")[0].values.some(c => c[1] === 'permissions');
                const dormCol = db.exec("PRAGMA table_info(rooms)")[0].values.some(c => c[1] === 'dorm_type');
                const mealCol = db.exec("PRAGMA table_info(reservations)")[0].values.some(c => c[1] === 'meal_breakfast');
                const lodgerMealCol = db.exec("PRAGMA table_info(lodgers)")[0].values.some(c => c[1] === 'meal_default_breakfast');
                const eventsExists = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='events'").length > 0;
                const usersExists = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").length > 0;
                const users = db.exec("SELECT COUNT(*) FROM users WHERE username IN ('admin','zhike')")[0].values[0][0];
                const eventCount = db.exec('SELECT COUNT(*) FROM events')[0].values[0][0];
                const guests = db.exec('SELECT COUNT(*) FROM guests')[0].values[0][0];
                const lodgers = db.exec('SELECT COUNT(*) FROM lodgers WHERE guest_id IS NOT NULL')[0].values[0][0];
                const hk = db.exec('SELECT COUNT(*) FROM housekeeping')[0].values[0][0];
                return { version, roleCheck, advancedCol, permissionsCol, dormCol, mealCol, lodgerMealCol, eventsExists, usersExists, users, eventCount, guests, lodgers, hk };
            })()
        """
        ws.send(json.dumps({'id': 3, 'method': 'Runtime.evaluate', 'params': {'expression': import_expr, 'awaitPromise': True, 'returnByValue': True}}))
        resp = json.loads(ws.recv())
        result = resp.get('result', {}).get('result', {})
        if result.get('type') == 'object' and 'value' in result:
            values = result['value']
            print('Migration result:', values)
            if values.get('version') != 15:
                print("FAIL: schema version not migrated to 15")
                sys.exit(1)
            if not values.get('advancedCol'):
                print("FAIL: users.is_advanced column missing after V14→V15 migration")
                sys.exit(1)
            if not values.get('permissionsCol'):
                print("FAIL: users.permissions column missing after V14→V15 migration")
                sys.exit(1)
            if 'viewer' not in values.get('roleCheck', ''):
                print("FAIL: users role CHECK not expanded to include new roles")
                sys.exit(1)
            if not values.get('dormCol'):
                print("FAIL: rooms.dorm_type column missing after migration")
                sys.exit(1)
            if not values.get('mealCol'):
                print("FAIL: reservations.meal_breakfast column missing after V10→V11 migration")
                sys.exit(1)
            if not values.get('lodgerMealCol'):
                print("FAIL: lodgers.meal_default_breakfast column missing after V11→V12 migration")
                sys.exit(1)
            if not values.get('eventsExists'):
                print("FAIL: events table missing after V5→V6 migration")
                sys.exit(1)
            if not values.get('usersExists'):
                print("FAIL: users table missing after V6→V7 migration")
                sys.exit(1)
            if values.get('users', 0) < 2:
                print("FAIL: default admin/zhike users missing")
                sys.exit(1)
            if values.get('lodgers', 0) < 1:
                print("FAIL: lodgers not linked to guests")
                sys.exit(1)
            print("PASS: V3→V15 migration via app succeeded")
        else:
            print("FAIL: unexpected result", resp)
            sys.exit(1)

        errors = collect_errors(ws, 1)
        if errors:
            print("WARN: console errors after migration:", errors)

        ws.close()
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
