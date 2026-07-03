#!/usr/bin/env python3
"""本地开发：静态文件 + 将 /api/* 代理到已部署 Cloudflare（在线-only 开发）。

用法：
  python3 scripts/dev_server.py
  # 浏览器打开 http://127.0.0.1:8080

环境变量：
  KETANG_DEV_API_ORIGIN  默认 https://wulingkt.net
  KETANG_DEV_PORT        默认 8080
"""
from __future__ import annotations

import http.server
import os
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API_ORIGIN = os.environ.get("KETANG_DEV_API_ORIGIN", "https://wulingkt.net").rstrip("/")
PORT = int(os.environ.get("KETANG_DEV_PORT", "8080"))

HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
}


def rewrite_set_cookie(value: str) -> str:
    """Remove Domain= so browser stores cookie for localhost dev host."""
    parts = []
    for chunk in value.split(";"):
        name = chunk.split("=", 1)[0].strip().lower()
        if name == "domain":
            continue
        parts.append(chunk.strip())
    return "; ".join(parts)


class DevHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, fmt, *args):
        sys.stderr.write("[dev] %s - %s\n" % (self.address_string(), fmt % args))

    def _proxy_api(self):
        upstream = API_ORIGIN + self.path
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None
        headers = {}
        for key, value in self.headers.items():
            lk = key.lower()
            if lk in HOP_BY_HOP or lk == "host":
                continue
            headers[key] = value
        req = urllib.request.Request(
            upstream, data=body, headers=headers, method=self.command
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                self.send_response(resp.status)
                for key, value in resp.headers.items():
                    lk = key.lower()
                    if lk in HOP_BY_HOP:
                        continue
                    if lk == "set-cookie":
                        self.send_header(key, rewrite_set_cookie(value))
                    else:
                        self.send_header(key, value)
                self.end_headers()
                while True:
                    chunk = resp.read(65536)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
        except urllib.error.HTTPError as err:
            self.send_response(err.code)
            for key, value in err.headers.items():
                lk = key.lower()
                if lk in HOP_BY_HOP:
                    continue
                if lk == "set-cookie":
                    self.send_header(key, rewrite_set_cookie(value))
                else:
                    self.send_header(key, value)
            self.end_headers()
            self.wfile.write(err.read())
        except Exception as exc:
            payload = ("Proxy error: %s" % exc).encode("utf-8")
            self.send_response(502)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write(payload)

    def do_OPTIONS(self):
        if self.path.startswith("/api/"):
            self.send_response(204)
            self.end_headers()
            return
        super().do_OPTIONS()

    def do_GET(self):
        if self.path.startswith("/api/"):
            self._proxy_api()
            return
        super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/"):
            self._proxy_api()
            return
        self.send_error(405)

    def do_PUT(self):
        if self.path.startswith("/api/"):
            self._proxy_api()
            return
        self.send_error(405)

    def do_PATCH(self):
        if self.path.startswith("/api/"):
            self._proxy_api()
            return
        self.send_error(405)

    def do_DELETE(self):
        if self.path.startswith("/api/"):
            self._proxy_api()
            return
        self.send_error(405)


def main():
    os.chdir(ROOT)
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), DevHandler) as httpd:
        print("Ketang dev server: http://127.0.0.1:%d" % PORT)
        print("API proxy → %s" % API_ORIGIN)
        httpd.serve_forever()


if __name__ == "__main__":
    main()
