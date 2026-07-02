#!/usr/bin/env python3
"""Mobile viewport smoke test: nav, overflow, and core touch paths."""
import json
import subprocess
import sys
import time
from pathlib import Path

import websocket

from test_cdp import PORT, evaluate, start_server
from test_file_protocol import chrome_binary

ROOT = Path(__file__).resolve().parent
CDP_PORT = 9226


def curl_get(url, timeout=5):
    r = subprocess.run(
        ["curl", "-s", url], capture_output=True, text=True, timeout=timeout
    )
    if r.returncode != 0:
        raise RuntimeError(r.stderr)
    return r.stdout


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
        if p.get("type") == "page" and "webSocketDebuggerUrl" in p:
            return p["webSocketDebuggerUrl"]
    return None


def set_mobile_viewport(ws):
    req_id = 9001
    ws.send(
        json.dumps(
            {
                "id": req_id,
                "method": "Emulation.setDeviceMetricsOverride",
                "params": {
                    "width": 390,
                    "height": 844,
                    "deviceScaleFactor": 2,
                    "mobile": True,
                },
            }
        )
    )
    deadline = time.time() + 5
    while time.time() < deadline:
        resp = json.loads(ws.recv())
        if resp.get("id") == req_id:
            return


def overflow_check_expr():
    return """
    (() => {
      const doc = document.documentElement;
      const body = document.body;
      const overflow = Math.max(
        doc.scrollWidth - doc.clientWidth,
        body ? body.scrollWidth - body.clientWidth : 0
      );
      return {
        ok: overflow <= 2,
        overflow: overflow,
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth
      };
    })()
    """


def main():
    manifest_path = ROOT / "manifest.webmanifest"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    icons = manifest.get("icons") or []
    if len(icons) < 2:
        print("FAIL: manifest.webmanifest must include at least two icons")
        sys.exit(1)
    for name in ("icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"):
        if not (ROOT / name).is_file():
            print(f"FAIL: missing {name}")
            sys.exit(1)

    server = start_server()
    chrome = chrome_binary()
    if not chrome:
        print("SKIP: Chrome not found")
        server.terminate()
        return

    chrome_proc = subprocess.Popen(
        [
            chrome,
            "--headless=new",
            "--disable-gpu",
            "--no-sandbox",
            "--remote-allow-origins=*",
            f"--remote-debugging-port={CDP_PORT}",
            f"http://127.0.0.1:{PORT}/index.html",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        time.sleep(1.5)
        if not wait_for_cdp():
            print("FAIL: CDP not ready")
            sys.exit(1)
        ws_url = cdp_ws_url()
        if not ws_url:
            print("FAIL: no CDP page")
            sys.exit(1)
        ws = websocket.create_connection(ws_url, timeout=10)
        try:
            set_mobile_viewport(ws)

            ready = evaluate(
                ws,
                "(async()=>{for(let i=0;i<40;i++){if(typeof showView==='function'&&typeof loadDB==='function')return true;await new Promise(r=>setTimeout(r,250));}return false;})()",
            ).get("value")
            if not ready:
                print("FAIL: app did not initialize")
                sys.exit(1)

            nav = evaluate(
                ws,
                """
                (() => {
                  const nav = document.querySelector('.mobile-bottom-nav');
                  if (!nav) return { ok: false, reason: 'missing nav' };
                  if (getComputedStyle(nav).display === 'none') return { ok: false, reason: 'nav hidden' };
                  const sidebar = document.querySelector('.sidebar');
                  if (sidebar && getComputedStyle(sidebar).display !== 'none') {
                    return { ok: false, reason: 'sidebar still visible on mobile' };
                  }
                  const buttons = nav.querySelectorAll('.mobile-nav-btn');
                  if (buttons.length < 5) return { ok: false, reason: 'too few buttons' };
                  return { ok: true, buttons: buttons.length };
                })()
                """,
            ).get("value") or {}
            if not nav.get("ok"):
                print(f"FAIL: mobile nav check: {nav.get('reason', nav)}")
                sys.exit(1)

            r = subprocess.run(
                [
                    "curl",
                    "-s",
                    "-o",
                    "/dev/null",
                    "-w",
                    "%{http_code}",
                    f"http://127.0.0.1:{PORT}/manifest.webmanifest",
                ],
                capture_output=True,
                text=True,
                timeout=10,
            )
            if r.stdout.strip() != "200":
                print("FAIL: manifest.webmanifest not reachable")
                sys.exit(1)

            sw = subprocess.run(
                [
                    "curl",
                    "-s",
                    "-o",
                    "/dev/null",
                    "-w",
                    "%{http_code}",
                    f"http://127.0.0.1:{PORT}/sw.js",
                ],
                capture_output=True,
                text=True,
                timeout=10,
            )
            if sw.stdout.strip() != "200":
                print("FAIL: sw.js not reachable")
                sys.exit(1)

            shell = evaluate(
                ws,
                """
                (() => {
                  const titleBar = document.getElementById('mobile-title-text');
                  const header = document.getElementById('mobile-header');
                  const navIcons = document.querySelectorAll('.mobile-nav-btn .mobile-nav-icon svg');
                  const handle = document.querySelector('.mobile-more-sheet-handle');
                  if (!titleBar || !header) return { ok: false, reason: 'missing mobile header' };
                  if (getComputedStyle(header).display === 'none') return { ok: false, reason: 'mobile header hidden' };
                  if (navIcons.length < 5) return { ok: false, reason: 'missing nav icons' };
                  if (!handle) return { ok: false, reason: 'missing sheet handle' };
                  const apple = document.querySelector('link[rel=\"apple-touch-icon\"]');
                  if (!apple) return { ok: false, reason: 'missing apple-touch-icon link' };
                  return { ok: true, navIcons: navIcons.length };
                })()
                """,
            ).get("value") or {}
            if not shell.get("ok"):
                print(f"FAIL: mobile shell check: {shell.get('reason', shell)}")
                sys.exit(1)

            login_ov = evaluate(
                ws,
                """
                (() => {
                  const overlay = document.getElementById('login-overlay');
                  const split = document.querySelector('.login-split');
                  const hero = document.querySelector('.login-hero');
                  const panel = document.querySelector('.login-panel');
                  if (!overlay || !split || !hero || !panel) {
                    return { ok: false, reason: 'missing login split layout' };
                  }
                  const doc = document.documentElement;
                  const overflow = Math.max(
                    doc.scrollWidth - doc.clientWidth,
                    document.body.scrollWidth - document.body.clientWidth
                  );
                  const splitStyle = getComputedStyle(split);
                  const heroRect = hero.getBoundingClientRect();
                  const panelRect = panel.getBoundingClientRect();
                  const vw = doc.clientWidth;
                  if (overflow > 2) {
                    return { ok: false, reason: 'login horizontal overflow', overflow, vw };
                  }
                  if (splitStyle.flexDirection !== 'column') {
                    return { ok: false, reason: 'login should stack on mobile', flexDirection: splitStyle.flexDirection };
                  }
                  if (Math.abs(heroRect.width - vw) > 2 || Math.abs(panelRect.width - vw) > 2) {
                    return {
                      ok: false,
                      reason: 'login panels not full width',
                      vw,
                      heroWidth: heroRect.width,
                      panelWidth: panelRect.width
                    };
                  }
                  return { ok: true, vw, heroWidth: heroRect.width, panelWidth: panelRect.width };
                })()
                """,
            ).get("value") or {}
            if not login_ov.get("ok"):
                print(f"FAIL: login mobile layout: {login_ov.get('reason', login_ov)}")
                sys.exit(1)

            login = evaluate(
                ws,
                "(async()=>{document.getElementById('login-username').value='admin';document.getElementById('login-password').value='admin';await submitLogin();return getCurrentUser()&&getCurrentUser().role;})()",
            ).get("value")
            if login != "admin":
                print("FAIL: mobile login failed, role=", login)
                sys.exit(1)
            time.sleep(0.5)

            m2 = evaluate(
                ws,
                """
                (() => {
                  showView('board');
                  const hero = document.getElementById('mobile-board-hero');
                  if (!hero || hero.hidden) return { ok: false, reason: 'missing mobile board hero' };
                  showView('lodgers');
                  const cards = document.querySelectorAll('#lodger-card-list .lodger-card');
                  const emptyCards = document.querySelector('#lodger-card-list .empty-tip');
                  if (!cards.length && !emptyCards) return { ok: false, reason: 'missing lodger card list' };
                  showView('housekeeping');
                  const hkGroups = document.querySelectorAll('.hk-room-group');
                  const hkEmpty = document.querySelector('#hk-grid .empty-tip');
                  if (!hkGroups.length && !hkEmpty) return { ok: false, reason: 'missing hk room groups' };
                  showView('stay');
                  const form = document.getElementById('checkin-form');
                  if (!form || !form.classList.contains('is-wizard-mobile')) {
                    return { ok: false, reason: 'checkin wizard not active on mobile' };
                  }
                  const sticky = form.querySelector('.form-wizard-sticky');
                  if (!sticky) return { ok: false, reason: 'missing wizard sticky bar' };
                  return { ok: true, cards: cards.length, hkGroups: hkGroups.length };
                })()
                """,
            ).get("value") or {}
            if not m2.get("ok"):
                print(f"FAIL: mobile M2 layout: {m2.get('reason', m2)}")
                sys.exit(1)

            views = [
                "board",
                "lodgers",
                "stay",
                "reports",
                "history",
                "forecast",
                "housekeeping",
            ]
            for view in views:
                evaluate(ws, f"showView('{view}')")
                time.sleep(0.5)
                ov = evaluate(ws, overflow_check_expr()).get("value") or {}
                if not ov.get("ok"):
                    print(
                        f"FAIL: horizontal overflow on {view}: "
                        f"scroll={ov.get('scrollWidth')} client={ov.get('clientWidth')}"
                    )
                    sys.exit(1)

            more = evaluate(
                ws,
                """
                (() => {
                  toggleMobileMoreMenu();
                  const sheet = document.getElementById('mobile-more-sheet');
                  if (!sheet || sheet.hidden) return { ok: false, reason: 'more sheet not open' };
                  const items = sheet.querySelectorAll('.mobile-more-item');
                  if (items.length < 6) return { ok: false, reason: 'too few more items' };
                  mobileNavGo('lodging');
                  const active = document.getElementById('view-lodging')?.classList.contains('active');
                  const sheetClosed = document.getElementById('mobile-more-sheet')?.hidden;
                  return { ok: active && sheetClosed, active, sheetClosed };
                })()
                """,
            ).get("value") or {}
            if not more.get("ok"):
                print(f"FAIL: mobile more menu: {more}")
                sys.exit(1)

            ov_after_more = evaluate(ws, overflow_check_expr()).get("value") or {}
            if not ov_after_more.get("ok"):
                print("FAIL: horizontal overflow after more menu navigation")
                sys.exit(1)

            journey = evaluate(
                ws,
                """
                (async () => {
                  const today = new Date().toISOString().slice(0, 10);
                  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
                  run("DELETE FROM meals WHERE lodger_id IN (SELECT id FROM lodgers WHERE name='Mobile旅客')");
                  run("DELETE FROM payments WHERE lodger_id IN (SELECT id FROM lodgers WHERE name='Mobile旅客')");
                  run("DELETE FROM lodgers WHERE name='Mobile旅客'");
                  run("DELETE FROM guests WHERE name='Mobile旅客'");
                  run("DELETE FROM beds WHERE bed_number LIKE 'MOB-%'");
                  run("DELETE FROM rooms WHERE name LIKE 'MOB-%'");
                  await saveDB();

                  run("INSERT INTO rooms (name, location, floor, dorm_type) VALUES (?, ?, ?, ?)", ['MOB-测试房', '东楼', 1, '男寮']);
                  const roomId = db.exec("SELECT last_insert_rowid() as id")[0].values[0][0];
                  run("INSERT INTO beds (room_id, bed_number, status) VALUES (?, ?, ?)", [roomId, 'MOB-1', '可用']);
                  const bedId = db.exec("SELECT id FROM beds WHERE room_id=? ORDER BY id", [roomId])[0].values[0][0];

                  showView('checkin');
                  document.getElementById('ci-name').value = 'Mobile旅客';
                  document.getElementById('ci-phone').value = '13800138001';
                  document.getElementById('ci-idcard').value = '110101199001011235';
                  document.getElementById('ci-gender').value = '男';
                  document.getElementById('ci-in').value = today;
                  document.getElementById('ci-out').value = tomorrow;
                  document.getElementById('ci-bed').value = bedId;
                  if (typeof mountFormMealNeedPickers === 'function') mountFormMealNeedPickers();
                  setMealNeedPicker('ci-meal-need', 1, 1, 0);

                  const form = document.getElementById('checkin-form');
                  form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
                  await new Promise(r => setTimeout(r, 800));

                  const lodger = query("SELECT id FROM lodgers WHERE name='Mobile旅客' AND status='在住'")[0];
                  if (!lodger) return { ok: false, reason: 'checkin failed' };

                  if (typeof checkoutLodger === 'function') {
                    await checkoutLodger(lodger.id);
                    await new Promise(r => setTimeout(r, 400));
                  } else {
                    run("UPDATE lodgers SET status='已退', actual_check_out=?, bed_id=NULL WHERE id=?", [today, lodger.id]);
                    await saveDB();
                  }

                  const done = query("SELECT status FROM lodgers WHERE id=?", [lodger.id])[0];
                  const overflow = Math.max(
                    document.documentElement.scrollWidth - document.documentElement.clientWidth,
                    0
                  );
                  return {
                    ok: done && done.status === '已退' && overflow <= 2,
                    status: done ? done.status : null,
                    overflow
                  };
                })()
                """,
            ).get("value") or {}
            if not journey.get("ok"):
                print(f"FAIL: mobile journey: {journey}")
                sys.exit(1)

            print(
                "OK: mobile shell + M2 cards/wizard + PWA assets + overflow + journey"
            )
        finally:
            ws.close()
    finally:
        chrome_proc.terminate()
        server.terminate()


if __name__ == "__main__":
    main()
