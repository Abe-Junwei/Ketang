#!/usr/bin/env python3
"""CDP test: import a V3 DB and verify migration chain through V20."""
import subprocess
import sys
import time
import json
import websocket
from test_cdp import start_server, wait_for_cdp, evaluate, collect_errors, recv_by_id, curl_get
from test_file_protocol import chrome_binary

PORT = 8125
CDP_PORT = 9224


def cdp_ws_any_page():
    data = json.loads(curl_get(f"http://127.0.0.1:{CDP_PORT}/json", timeout=2))
    for p in data:
        if p.get("type") == "page" and "webSocketDebuggerUrl" in p:
            return p["webSocketDebuggerUrl"]
    return None


def cdp_navigate_force_local(ws, port):
    """Inject KETANG_FORCE_LOCAL_DB before first navigation (online-only default)."""
    ws.send(json.dumps({"id": 100, "method": "Page.enable"}))
    ws.recv()
    ws.send(
        json.dumps(
            {
                "id": 101,
                "method": "Page.addScriptToEvaluateOnNewDocument",
                "params": {"source": "window.KETANG_FORCE_LOCAL_DB = true;"},
            }
        )
    )
    ws.recv()
    ws.send(
        json.dumps(
            {
                "id": 102,
                "method": "Page.navigate",
                "params": {"url": f"http://127.0.0.1:{port}/index.html"},
            }
        )
    )
    ws.recv()


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
        "about:blank"
    ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    try:
        if not wait_for_cdp():
            print("FAIL: CDP not ready")
            sys.exit(1)
        ws_url = cdp_ws_any_page()
        if not ws_url:
            print("FAIL: no CDP page")
            sys.exit(1)

        ws = websocket.create_connection(ws_url, timeout=10)
        ws.send(json.dumps({'id': 2, 'method': 'Runtime.enable'}))
        ws.recv()
        cdp_navigate_force_local(ws, PORT)

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
                migrateV15toV16();
                migrateV16toV17();
                migrateV17toV18();
                migrateV18toV19();
                migrateV19toV20();
                migrateV20toV21();
                createIndexes();
                seedRooms();
                await saveDB();
                const version = db.exec('SELECT version FROM schema_version')[0].values[0][0];
                const roleCheck = db.exec("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'")[0].values[0][0];
                const advancedCol = db.exec("PRAGMA table_info(users)")[0].values.some(c => c[1] === 'is_advanced');
                const permissionsCol = db.exec("PRAGMA table_info(users)")[0].values.some(c => c[1] === 'permissions');
                const dormCol = db.exec("PRAGMA table_info(rooms)")[0].values.some(c => c[1] === 'dorm_type');
                const roomTypeCol = db.exec("PRAGMA table_info(rooms)")[0].values.some(c => c[1] === 'room_type');
                const bedTypeCol = db.exec("PRAGMA table_info(beds)")[0].values.some(c => c[1] === 'bed_type');
                const eventRoomingCol = db.exec("PRAGMA table_info(events)")[0].values.some(c => c[1] === 'activity_target');
                const includeSpareCol = db.exec("PRAGMA table_info(events)")[0].values.some(c => c[1] === 'include_spare_beds');
                const participantCol = db.exec("PRAGMA table_info(lodgers)")[0].values.some(c => c[1] === 'participant_identity');
                const mealCol = db.exec("PRAGMA table_info(reservations)")[0].values.some(c => c[1] === 'meal_breakfast');
                const lodgerMealCol = db.exec("PRAGMA table_info(lodgers)")[0].values.some(c => c[1] === 'meal_default_breakfast');
                const roomingPlansTable = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='rooming_plans'").length > 0;
                const roomingAssignTable = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='rooming_assignments'").length > 0;
                const roomingQueueTable = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='rooming_checkin_queue'").length > 0;
                const publishedAtCol = db.exec("PRAGMA table_info(rooming_plans)")[0].values.some(c => c[1] === 'published_at');
                const updatedAtCol = db.exec("PRAGMA table_info(lodgers)")[0].values.some(c => c[1] === 'updated_at');
                const roomingAdjustTable = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='rooming_adjustments'").length > 0;
                const eventsExists = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='events'").length > 0;
                const usersExists = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").length > 0;
                const users = db.exec("SELECT COUNT(*) FROM users WHERE username IN ('admin','zhike')")[0].values[0][0];
                const eventCount = db.exec('SELECT COUNT(*) FROM events')[0].values[0][0];
                const guests = db.exec('SELECT COUNT(*) FROM guests')[0].values[0][0];
                const lodgers = db.exec('SELECT COUNT(*) FROM lodgers WHERE guest_id IS NOT NULL')[0].values[0][0];
                const hk = db.exec('SELECT COUNT(*) FROM housekeeping')[0].values[0][0];
                return {
                    version, roleCheck, advancedCol, permissionsCol, dormCol, roomTypeCol,
                    bedTypeCol, eventRoomingCol, includeSpareCol, participantCol,
                    mealCol, lodgerMealCol, roomingPlansTable, roomingAssignTable,
                    roomingQueueTable, publishedAtCol, roomingAdjustTable, updatedAtCol,
                    eventsExists, usersExists, users,
                    eventCount, guests, lodgers, hk
                };
            })()
        """
        ws.send(json.dumps({'id': 3, 'method': 'Runtime.evaluate', 'params': {'expression': import_expr, 'awaitPromise': True, 'returnByValue': True}}))
        resp = recv_by_id(ws, 3, 120)
        result = resp.get('result', {}).get('result', {})
        if result.get('type') == 'object' and 'value' in result:
            values = result['value']
            print('Migration result:', values)
            if values.get('version') != 21:
                print("FAIL: schema version not migrated to 21")
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
            if not values.get('roomTypeCol'):
                print("FAIL: rooms.room_type column missing after V16→V17 migration")
                sys.exit(1)
            if not values.get('bedTypeCol'):
                print("FAIL: beds.bed_type column missing after V16→V17 migration")
                sys.exit(1)
            if not values.get('eventRoomingCol'):
                print("FAIL: events.activity_target column missing after V16→V17 migration")
                sys.exit(1)
            if not values.get('includeSpareCol'):
                print("FAIL: events.include_spare_beds column missing after V15→V16 migration")
                sys.exit(1)
            if not values.get('participantCol'):
                print("FAIL: lodgers.participant_identity column missing after V16→V17 migration")
                sys.exit(1)
            if not values.get('mealCol'):
                print("FAIL: reservations.meal_breakfast column missing after V10→V11 migration")
                sys.exit(1)
            if not values.get('lodgerMealCol'):
                print("FAIL: lodgers.meal_default_breakfast column missing after V11→V12 migration")
                sys.exit(1)
            if not values.get('roomingPlansTable'):
                print("FAIL: rooming_plans table missing after V17→V18 migration")
                sys.exit(1)
            if not values.get('roomingAssignTable'):
                print("FAIL: rooming_assignments table missing after V17→V18 migration")
                sys.exit(1)
            if not values.get('roomingQueueTable'):
                print("FAIL: rooming_checkin_queue table missing after V18→V19 migration")
                sys.exit(1)
            if not values.get('publishedAtCol'):
                print("FAIL: rooming_plans.published_at column missing after V18→V19 migration")
                sys.exit(1)
            if not values.get('roomingAdjustTable'):
                print("FAIL: rooming_adjustments table missing after V19→V20 migration")
                sys.exit(1)
            if not values.get('updatedAtCol'):
                print("FAIL: lodgers.updated_at column missing after V20→V21 migration")
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
            print("PASS: V3→V21 migration via app succeeded")
        elif resp.get('result', {}).get('exceptionDetails'):
            print("FAIL: migration threw", resp['result']['exceptionDetails'].get('text'))
            sys.exit(1)
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
