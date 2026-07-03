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
    for _ in range(60):
        res = evaluate(
            ws,
            """
            document.readyState === 'complete' &&
            !!document.getElementById('reserve-form') &&
            !!document.getElementById('rv-submit') &&
            typeof escapeHtml === 'function' &&
            typeof validateGuestContact === 'function'
            """,
        )
        if res.get("value") is True:
            return True
        time.sleep(0.15)
    return False


def wait_for_result_text(ws, needle, timeout=8.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        res = evaluate(
            ws,
            "document.getElementById('reserve-result').textContent || ''",
        )
        text = str(res.get("value", ""))
        if needle in text:
            return text
        time.sleep(0.15)
    return ""


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
            (function () {
              document.getElementById('reserve-form').setAttribute('novalidate', 'novalidate');
              document.getElementById('rv-name').value = '';
              document.getElementById('rv-gender').value = '';
              document.getElementById('rv-idcard').value = '';
              document.getElementById('rv-in').value = '';
              document.getElementById('reserve-result').hidden = true;
              document.getElementById('reserve-result').textContent = '';
              document.getElementById('reserve-form').requestSubmit();
              return true;
            })()
            """,
        )
        req_err = wait_for_result_text(ws, "必填")
        req_hidden = evaluate(
            ws, "document.getElementById('reserve-form').hidden"
        ).get("value")
        if req_hidden:
            print("FAIL: form hidden on empty required")
            sys.exit(1)
        if not req_err:
            print("FAIL: missing required validation message")
            sys.exit(1)

        evaluate(
            ws,
            """
            (function () {
              document.getElementById('rv-name').value = '测试';
              document.getElementById('rv-gender').value = '男';
              document.getElementById('rv-idcard').value = '110101199001011234';
              document.getElementById('rv-in').value = '2026-08-10';
              document.getElementById('rv-out').value = '2026-08-01';
              document.getElementById('reserve-result').hidden = true;
              document.getElementById('reserve-result').textContent = '';
              document.getElementById('reserve-form').requestSubmit();
              return true;
            })()
            """,
        )
        date_err = wait_for_result_text(ws, "预离日期")
        date_hidden = evaluate(
            ws, "document.getElementById('reserve-form').hidden"
        ).get("value")
        if date_hidden:
            print("FAIL: form hidden on validation error")
            sys.exit(1)
        if not date_err:
            print("FAIL: missing date validation message")
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
            (function () {
              document.getElementById('rv-name').value = '测试';
              document.getElementById('rv-gender').value = '男';
              document.getElementById('rv-idcard').value = '110101199001011234';
              document.getElementById('rv-phone').value = '13800138000';
              document.getElementById('rv-in').value = '2026-08-01';
              document.getElementById('reserve-form').requestSubmit();
              return true;
            })()
            """,
        )
        err403 = wait_for_result_text(ws, "未开放")
        if not err403:
            print("FAIL: 403 error not shown")
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
            (function () {
              document.getElementById('rv-name').value = '测试';
              document.getElementById('rv-gender').value = '女';
              document.getElementById('rv-idcard').value = '110101199001011235';
              document.getElementById('rv-phone').value = '13800138002';
              document.getElementById('rv-in').value = '2026-08-02';
              document.getElementById('reserve-form').requestSubmit();
              return true;
            })()
            """,
        )
        err429 = wait_for_result_text(ws, "频繁")
        if not err429:
            print("FAIL: 429 error not shown")
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
            (function () {
              document.getElementById('rv-name').value = '成功测试';
              document.getElementById('rv-gender').value = '男';
              document.getElementById('rv-idcard').value = '110101199001011236';
              document.getElementById('rv-phone').value = '13800138001';
              document.getElementById('rv-in').value = '2026-08-03';
              document.getElementById('reserve-form').requestSubmit();
              return true;
            })()
            """,
        )
        ok_text = wait_for_result_text(ws, "预约已提交")
        ok_hidden = evaluate(
            ws, "document.getElementById('reserve-form').hidden"
        ).get("value")
        if not ok_hidden or not ok_text:
            print("FAIL: success state missing")
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
