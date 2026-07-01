#!/usr/bin/env python3
"""CDP smoke test: check all views render without console errors."""
import http.server
import socketserver
import subprocess
import sys
import threading
import time
import json
import websocket

PORT = 8125
CDP_PORT = 9224

def curl_get(url, timeout=5):
    r = subprocess.run(['curl', '-s', url], capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError(r.stderr)
    return r.stdout

def start_server():
    proc = subprocess.Popen(['python3', '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    for _ in range(20):
        try:
            curl_get(f"http://127.0.0.1:{PORT}/index.html", timeout=1)
            return proc
        except Exception:
            time.sleep(0.5)
    raise RuntimeError('server failed to start')

def wait_for_cdp():
    for _ in range(30):
        try:
            curl_get(f"http://127.0.0.1:{CDP_PORT}/json", timeout=1)
            return True
        except Exception:
            time.sleep(0.5)
    return False

def cdp_ws_url():
    data = curl_get(f"http://127.0.0.1:{CDP_PORT}/json", timeout=2)
    pages = json.loads(data)
    for p in pages:
        url = p.get('url', '')
        if p.get('type') == 'page' and url.startswith('http') and 'webSocketDebuggerUrl' in p and (str(PORT) in url or 'index.html' in url):
            return p['webSocketDebuggerUrl']
    for p in pages:
        if p.get('type') == 'page' and p.get('url', '').startswith('http') and 'webSocketDebuggerUrl' in p:
            return p['webSocketDebuggerUrl']
    return None

def evaluate(ws, expr, timeout=30):
    req_id = int(time.time() * 1000) % 1000000 + 100
    ws.send(json.dumps({'id': req_id, 'method': 'Runtime.evaluate', 'params': {'expression': expr, 'awaitPromise': True, 'returnByValue': True}}))
    deadline = time.time() + timeout
    while time.time() < deadline:
        ws.settimeout(max(0.1, deadline - time.time()))
        try:
            resp = json.loads(ws.recv())
        except websocket.WebSocketTimeoutException:
            continue
        if resp.get('id') == req_id:
            return resp.get('result', {}).get('result', {})
    return {}

def recv_by_id(ws, req_id, timeout=60):
    deadline = time.time() + timeout
    while time.time() < deadline:
        ws.settimeout(max(0.1, deadline - time.time()))
        try:
            resp = json.loads(ws.recv())
        except websocket.WebSocketTimeoutException:
            continue
        if resp.get('id') == req_id:
            return resp
    return {}

def collect_errors(ws, duration):
    errors = []
    ws.settimeout(duration)
    start = time.time()
    while time.time() - start < duration:
        try:
            msg = json.loads(ws.recv())
            if msg.get('method') == 'Runtime.consoleAPICalled':
                entry = msg['params']
                if entry.get('type') == 'error':
                    text = ' '.join(str(x.get('value', x.get('description', ''))) for x in entry.get('args', []))
                    errors.append(text)
        except websocket.WebSocketTimeoutException:
            break
    return errors

def main():
    server = start_server()
    chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
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

        # Wait for init
        for _ in range(30):
            res = evaluate(ws, 'window.ketangReady')
            if res.get('value') is True:
                break
            time.sleep(0.5)
        else:
            print("FAIL: app did not initialize")
            sys.exit(1)

        # Sanity-check that main stylesheet parsed (guards against fatal CSS syntax errors)
        res = evaluate(ws, 'Array.from(document.querySelectorAll(\'link[rel="stylesheet"]\')).reduce((n,l)=>n+(l.sheet?l.sheet.cssRules.length:0),0)')
        rule_count = res.get('value', 0)
        if not isinstance(rule_count, int) or rule_count < 50:
            print(f"FAIL: stylesheets parsed only {rule_count} rules, likely fatal CSS syntax error")
            sys.exit(1)

        errors = collect_errors(ws, 1.5)

        # Login as admin so that restricted views (info/backup) can render
        evaluate(ws, "login('admin','admin')")
        time.sleep(0.5)

        # Switch views and check no errors
        views = ['board', 'lodging', 'lodgers', 'stay', 'forecast', 'housekeeping', 'reports', 'history', 'info', 'backup']
        for view in views:
            evaluate(ws, f"showView('{view}')")
            time.sleep(0.6)
            errors.extend([f"[{view}] {e}" for e in collect_errors(ws, 1.0)])

        # Business path smoke tests
        event_expr = """
            (() => {
                run("INSERT INTO events (name, event_type, gender_type, expected_count, start_date, end_date, status) VALUES (?, ?, ?, ?, ?, ?, ?)", ['测试营期', '禅营', '男众', 10, '2026-07-01', '2026-07-07', '招生中']);
                const eventId = db.exec("SELECT last_insert_rowid() as id")[0].values[0][0];
                const plan = generateRoomingSuggestion(eventId);
                showView('forecast');
                initForecastDates();
                renderForecastTab('today');
                renderForecastTab('flow');
                return { eventId, hasMalePlan: !!plan.malePlan, hasFemalePlan: !!plan.femalePlan };
            })()
        """
        ws.send(json.dumps({'id': 4, 'method': 'Runtime.evaluate', 'params': {'expression': event_expr, 'returnByValue': True}}))
        resp = recv_by_id(ws, 4, 30)
        biz = resp.get('result', {}).get('result', {}).get('value', {})
        print('Business path result:', biz)
        if not biz.get('hasMalePlan') and not biz.get('hasFemalePlan'):
            print("WARN: rooming suggestion returned empty plan (may be due to no matching rooms)")
        errors.extend([f"[business] {e}" for e in collect_errors(ws, 1.0)])

        # Full business journey: checkin -> extend -> change bed -> meals -> checkout -> history
        journey_expr = """
            (async () => {
                window.__journeyLog = [];
                const log = (msg) => { window.__journeyLog.push(msg); console.log(msg); };
                const today = new Date().toISOString().slice(0, 10);
                const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
                const dayAfter = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);

                // Cleanup previous test data
                run("DELETE FROM meals WHERE lodger_id IN (SELECT id FROM lodgers WHERE name='CDP旅客')");
                run("DELETE FROM payments WHERE lodger_id IN (SELECT id FROM lodgers WHERE name='CDP旅客')");
                run("DELETE FROM lodgers WHERE name='CDP旅客'");
                run("DELETE FROM guests WHERE name='CDP旅客'");
                run("DELETE FROM audit_logs WHERE detail LIKE '%CDP旅客%'");
                run("DELETE FROM beds WHERE bed_number LIKE 'CDP-%'");
                run("DELETE FROM rooms WHERE name LIKE 'CDP-%'");
                await saveDB();

                // Create a male room with two beds
                run("INSERT INTO rooms (name, location, floor, dorm_type) VALUES (?, ?, ?, ?)", ['CDP-测试房', '东楼', 1, '男寮']);
                const roomId = db.exec("SELECT last_insert_rowid() as id")[0].values[0][0];
                run("INSERT INTO beds (room_id, bed_number, status) VALUES (?, ?, ?)", [roomId, 'CDP-1', '可用']);
                run("INSERT INTO beds (room_id, bed_number, status) VALUES (?, ?, ?)", [roomId, 'CDP-2', '可用']);
                const bedRows = db.exec("SELECT id FROM beds WHERE room_id=? ORDER BY id", [roomId])[0].values;
                const bed1Id = bedRows[0][0];
                const bed2Id = bedRows[1][0];

                // Check-in
                showView('checkin');
                document.getElementById('ci-name').value = 'CDP旅客';
                document.getElementById('ci-phone').value = '13800138000';
                document.getElementById('ci-idcard').value = '110101199001011234';
                document.getElementById('ci-gender').value = '男';
                document.getElementById('ci-in').value = today;
                document.getElementById('ci-out').value = tomorrow;
                document.getElementById('ci-bed').value = bed1Id;
                if (!document.querySelector('#ci-meal-need input[data-meal="breakfast"]')) {
                    if (typeof mountFormMealNeedPickers === 'function') mountFormMealNeedPickers();
                }
                setMealNeedPicker('ci-meal-need', 1, 1, 0);
                document.getElementById('ci-deposit').value = '100';
                document.getElementById('ci-room-fee').value = '50';
                document.getElementById('ci-pay-method').value = '现金';
                document.getElementById('ci-pay-remark').value = 'CDP测试';

                const form = document.getElementById('checkin-form');
                form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

                let lodgerId = null;
                for (let i = 0; i < 30; i++) {
                    const rows = db.exec("SELECT id FROM lodgers WHERE name='CDP旅客' AND status='在住' ORDER BY id DESC LIMIT 1")[0];
                    if (rows && rows.values.length) { lodgerId = rows.values[0][0]; break; }
                    await new Promise(r => setTimeout(r, 100));
                }
                if (!lodgerId) throw new Error('checkin failed');
                log('journey: checkin ok, lodgerId=' + lodgerId);

                // Extend stay
                openExtendModal(lodgerId);
                document.getElementById('ext-date').value = dayAfter;
                await submitExtend(lodgerId);
                log('journey: extend ok');

                // Change bed
                openChangeBedModal(lodgerId);
                selectChangeBed({ stopPropagation: () => {} }, bed2Id);
                await submitChangeBed(lodgerId, '男');
                log('journey: change bed ok');

                // Meals
                openMealModal(lodgerId);
                await submitMeals(lodgerId);
                log('journey: meals ok');

                // Checkout
                openCheckoutModal(lodgerId);
                await submitCheckout(lodgerId);
                log('journey: checkout ok');

                // History query
                showView('history');
                if (typeof renderHistory === 'function') renderHistory();

                const rows = db.exec("SELECT status, bed_id FROM lodgers WHERE id=?", [lodgerId])[0].values;
                const final = rows[0];
                return {
                    checkedOut: final[0] === '已退',
                    finalBed: final[1],
                    changedBed: bed2Id,
                    logs: window.__journeyLog
                };
            })().catch(err => {
                console.error('journey error:', err && err.message ? err.message : err);
                return { error: err && err.message ? err.message : String(err) };
            })
        """
        ws.send(json.dumps({'id': 5, 'method': 'Runtime.evaluate', 'params': {'expression': journey_expr, 'awaitPromise': True, 'returnByValue': True}}))
        resp = recv_by_id(ws, 5, 120)
        journey = resp.get('result', {}).get('result', {}).get('value', {})
        print('Full journey result:', journey)
        if not journey.get('checkedOut'):
            print("FAIL: full business journey did not checkout")
            sys.exit(1)
        if journey.get('finalBed') is not None:
            print("FAIL: final bed should be null after checkout")
            sys.exit(1)
        errors.extend([f"[journey] {e}" for e in collect_errors(ws, 1.0)])

        # Permission negative test: zhike should not access info/backup
        evaluate(ws, "logout()")
        time.sleep(0.3)
        login_ok = evaluate(ws, "login('zhike','zhike')").get('value')
        if not login_ok:
            print("FAIL: zhike login failed")
            sys.exit(1)
        evaluate(ws, "showView('info')")
        time.sleep(0.3)
        active_view = evaluate(ws, "document.querySelector('.view.active')?.id")
        if active_view.get('value') in ('view-info', 'view-backup'):
            print("FAIL: zhike was able to access admin view")
            sys.exit(1)

        ws.close()

        if errors:
            print("FAIL: console errors detected")
            for e in errors[:30]:
                print('  ', e)
            sys.exit(1)
        print("PASS: all views rendered without console errors")
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
