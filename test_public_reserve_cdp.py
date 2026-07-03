#!/usr/bin/env python3
"""Phase E reserve.html CDP smoke: validation + mocked success/failure."""
import json
import subprocess
import sys
import time

import websocket

from test_cdp import CDP_PORT, PORT, cdp_ws_url, evaluate, start_server, wait_for_cdp
from test_file_protocol import chrome_binary


def wait_for_form(ws):
    for _ in range(40):
        res = evaluate(ws, "!!document.getElementById('reserve-form')")
        if res.get("value") is True:
            return True
        time.sleep(0.15)
    return False


def main():
    server = start_server()
    chrome = chrome_binary()
    if not chrome:
        print("SKIP: Chrome not found")
        sys.exit(0)

    proc = subprocess.Popen(
        [
            chrome,
            f"--remote-debugging-port={CDP_PORT}",
            "--remote-allow-origins=*",
            "--headless=new",
            "--disable-gpu",
            "--no-sandbox",
            "--disable-dev-shm-usage",
            f"http://127.0.0.1:{PORT}/reserve.html",
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

        if not wait_for_form(ws):
            print("FAIL: reserve form not ready")
            sys.exit(1)

        evaluate(
            ws,
            """
            (async function () {
              document.getElementById('rv-name').value = '测试';
              document.getElementById('rv-gender').value = '男';
              document.getElementById('rv-idcard').value = '110101199001011234';
              document.getElementById('rv-in').value = '2026-08-10';
              document.getElementById('rv-out').value = '2026-08-01';
              document.getElementById('reserve-form').requestSubmit();
              await new Promise(function (r) { setTimeout(r, 150); });
              return true;
            })()
            """,
        )
        r = evaluate(
            ws,
            "({ formHidden: document.getElementById('reserve-form').hidden, err: document.getElementById('reserve-result').textContent || '' })",
        )
        if r.get("value", {}).get("formHidden"):
            print("FAIL: form hidden on validation error")
            sys.exit(1)
        if "预离日期" not in str(r.get("value", {}).get("err", "")):
            print("FAIL: missing date validation message:", r)
            sys.exit(1)

        evaluate(
            ws,
            """
            window.fetch = async function (url, opts) {
              if (String(url).indexOf('/api/public/reservations') !== -1) {
                return { ok: false, status: 403, json: async function () { return { error: '线上预约未开放' }; } };
              }
              throw new Error('unexpected fetch ' + url);
            };
            document.getElementById('reserve-result').hidden = true;
            document.getElementById('reserve-result').textContent = '';
            document.getElementById('rv-out').value = '';
            """,
        )
        evaluate(
            ws,
            """
            (async function () {
              document.getElementById('rv-name').value = '测试';
              document.getElementById('rv-gender').value = '男';
              document.getElementById('rv-idcard').value = '110101199001011234';
              document.getElementById('rv-phone').value = '13800138000';
              document.getElementById('rv-in').value = '2026-08-01';
              document.getElementById('reserve-form').requestSubmit();
              await new Promise(function (r) { setTimeout(r, 250); });
              return true;
            })()
            """,
        )
        err403 = evaluate(ws, "document.getElementById('reserve-result').textContent || ''")
        if "未开放" not in str(err403.get("value", "")):
            print("FAIL: 403 error not shown:", err403)
            sys.exit(1)

        evaluate(
            ws,
            """
            window.fetch = async function (url, opts) {
              if (String(url).indexOf('/api/public/reservations') !== -1) {
                return { ok: false, status: 429, json: async function () { return { error: '请求过于频繁，请稍后再试' }; } };
              }
              throw new Error('unexpected fetch ' + url);
            };
            document.getElementById('reserve-result').hidden = true;
            document.getElementById('reserve-result').textContent = '';
            document.getElementById('rv-out').value = '';
            """,
        )
        evaluate(
            ws,
            """
            (async function () {
              document.getElementById('rv-name').value = '测试';
              document.getElementById('rv-gender').value = '女';
              document.getElementById('rv-idcard').value = '110101199001011235';
              document.getElementById('rv-phone').value = '13800138002';
              document.getElementById('rv-in').value = '2026-08-02';
              document.getElementById('reserve-form').requestSubmit();
              await new Promise(function (r) { setTimeout(r, 250); });
              return true;
            })()
            """,
        )
        err429 = evaluate(ws, "document.getElementById('reserve-result').textContent || ''")
        if "频繁" not in str(err429.get("value", "")):
            print("FAIL: 429 error not shown:", err429)
            sys.exit(1)

        evaluate(
            ws,
            """
            window.fetch = async function (url, opts) {
              if (String(url).indexOf('/api/public/reservations') !== -1) {
                return { ok: true, status: 201, json: async function () { return { reservation_id: 1 }; } };
              }
              throw new Error('unexpected fetch ' + url);
            };
            document.getElementById('reserve-form').hidden = false;
            document.getElementById('reserve-result').hidden = true;
            document.getElementById('reserve-result').textContent = '';
            document.getElementById('rv-out').value = '';
            """,
        )
        evaluate(
            ws,
            """
            (async function () {
              document.getElementById('rv-name').value = '成功测试';
              document.getElementById('rv-gender').value = '男';
              document.getElementById('rv-idcard').value = '110101199001011236';
              document.getElementById('rv-phone').value = '13800138001';
              document.getElementById('rv-in').value = '2026-08-03';
              document.getElementById('reserve-form').requestSubmit();
              await new Promise(function (r) { setTimeout(r, 250); });
              return true;
            })()
            """,
        )
        ok = evaluate(
            ws,
            "({ formHidden: document.getElementById('reserve-form').hidden, ok: document.getElementById('reserve-result').textContent || '' })",
        )
        val = ok.get("value", {})
        if not val.get("formHidden") or "预约已提交" not in str(val.get("ok", "")):
            print("FAIL: success state missing:", ok)
            sys.exit(1)

        ws.close()
        print("PASS: reserve.html validation, 403/429 failure, and success states")
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
