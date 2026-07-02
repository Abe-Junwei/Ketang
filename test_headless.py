#!/usr/bin/env python3
"""Headless smoke test: start local server and check page loads without fatal errors."""
import subprocess
import sys
import time

from test_cdp import start_server, PORT
from test_file_protocol import chrome_binary

def main():
    server = start_server()
    try:
        time.sleep(0.3)
        try:
            r = subprocess.run(
                ['curl', '-s', '-o', '/dev/null', '-w', '%{http_code}',
                 f'http://127.0.0.1:{PORT}/index.html'],
                capture_output=True, text=True, timeout=10
            )
            if r.returncode != 0 or r.stdout.strip() != '200':
                print(f"FAIL: server not reachable (curl exit={r.returncode}, status={r.stdout.strip()})")
                sys.exit(1)
        except Exception as e:
            print(f"FAIL: server not reachable: {e}")
            sys.exit(1)

        chrome = chrome_binary()
        if not chrome:
            print("SKIP: Chrome not found")
            return
        proc = subprocess.Popen([
            chrome,
            "--headless=new",
            "--disable-gpu",
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--enable-logging=stderr",
            "--v=0",
            f"http://127.0.0.1:{PORT}/index.html"
        ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

        try:
            stdout, stderr = proc.communicate(timeout=15)
        except subprocess.TimeoutExpired:
            proc.kill()
            stdout, stderr = proc.communicate()

        combined = (stdout or "") + "\n" + (stderr or "")
        if "初始化失败 | Init failed" in combined or "系统初始化失败" in combined:
            print("FAIL: page reported init failure")
            print(combined[-2000:])
            sys.exit(1)
        if "客堂管理系统初始化完成" in combined:
            print("PASS: page initialized successfully")
            return
        if proc.returncode == 0:
            print("PASS: Chrome exited normally")
            return
        print("FAIL: initialization marker not found")
        print(combined[-2000:])
        sys.exit(1)
    finally:
        server.terminate()
        try:
            server.wait(timeout=3)
        except subprocess.TimeoutExpired:
            server.kill()

if __name__ == "__main__":
    main()
