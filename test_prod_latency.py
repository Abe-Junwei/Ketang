#!/usr/bin/env python3
"""生产/预发接口测速 | Benchmark auth and read-model endpoints."""
import argparse
import json
import sys
import time
import urllib.error
import urllib.request


def request_json(url, method="GET", headers=None, body=None, timeout=60):
    data = None
    req_headers = {"Accept": "application/json"}
    if headers:
        req_headers.update(headers)
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        req_headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=req_headers, method=method)
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            elapsed_ms = int((time.perf_counter() - started) * 1000)
            return resp.status, json.loads(raw or "{}"), elapsed_ms
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8")
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        try:
            payload = json.loads(raw or "{}")
        except json.JSONDecodeError:
            payload = {"error": raw[:200]}
        return e.code, payload, elapsed_ms


def ttfb_ms(url, timeout=60):
    started = time.perf_counter()
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        resp.read(256)
        return int((time.perf_counter() - started) * 1000)


def main():
    parser = argparse.ArgumentParser(description="Ketang production latency probe")
    parser.add_argument(
        "--base",
        default="https://wulingkt.net",
        help="Site base URL (default: https://wulingkt.net)",
    )
    parser.add_argument("--role", default="admin", help="Login role")
    parser.add_argument("--password", default="admin", help="Login password")
    args = parser.parse_args()
    base = args.base.rstrip("/")
    timing_q = "?timing=1"

    print(f"Target: {base}")
    results = {}

    try:
        results["index_ttfb_ms"] = ttfb_ms(f"{base}/index.html")
    except Exception as e:
        print(f"FAIL index TTFB: {e}")
        sys.exit(1)

    status, body, ms = request_json(
        f"{base}/api/db",
        method="POST",
        body={"action": "users"},
    )
    results["users_ms"] = ms
    results["users_status"] = status
    if status != 200:
        print(f"FAIL users status={status} body={body}")
        sys.exit(1)

    status, body, ms = request_json(
        f"{base}/api/db",
        method="POST",
        body={"action": "login_role", "role": args.role, "password": args.password},
    )
    results["login_role_ms"] = ms
    results["login_role_status"] = status
    results["login_role_timing"] = body.get("_timing")
    if status != 200 or not body.get("token"):
        print(f"FAIL login_role status={status} body={body}")
        sys.exit(1)
    token = body["token"]

    status, body, ms = request_json(
        f"{base}/api/v1/session{timing_q}",
        headers={"Authorization": f"Bearer {token}"},
    )
    results["session_ms"] = ms
    results["session_status"] = status
    results["session_timing"] = body.get("_timing")
    if status != 200:
        print(f"FAIL session status={status} body={body}")
        sys.exit(1)

    status, body, ms = request_json(
        f"{base}/api/v1/read-model{timing_q}",
        headers={"Authorization": f"Bearer {token}"},
    )
    results["read_model_ms"] = ms
    results["read_model_status"] = status
    results["read_model_timing"] = body.get("_timing")
    if status != 200:
        print(f"FAIL read-model status={status} body={body}")
        sys.exit(1)

    status, body, ms = request_json(
        f"{base}/api/v1/board-version",
        headers={"Authorization": f"Bearer {token}"},
    )
    results["board_version_ms"] = ms
    results["board_version_status"] = status
    if status != 200:
        print(f"FAIL board-version status={status} body={body}")
        sys.exit(1)

    print(json.dumps(results, ensure_ascii=False, indent=2))
    print("OK production latency probe")


if __name__ == "__main__":
    main()
