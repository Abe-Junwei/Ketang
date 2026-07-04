#!/usr/bin/env python3
"""管理写延迟探针：login + create/delete resource，拆分 init/auth/biz。

Usage:
  python3 test_admin_write_latency.py
  python3 test_admin_write_latency.py --base https://wulingkt.net --samples 3
"""
from __future__ import annotations

import argparse
import http.cookiejar
import json
import sys
import time
import urllib.error
import urllib.request


def request_json(opener, base, path, method="GET", body=None, timeout=60):
    data = None
    headers = {
        "Accept": "application/json",
        "User-Agent": "KetangAdminWriteLatency/1.0",
    }
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    url = base.rstrip("/") + path
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    t0 = time.perf_counter()
    try:
        with opener.open(req, timeout=timeout) as resp:
            raw = resp.read()
            ms = int((time.perf_counter() - t0) * 1000)
            payload = json.loads(raw.decode("utf-8")) if raw else {}
            timing = None
            st = resp.headers.get("Server-Timing") or resp.headers.get(
                "server-timing"
            )
            xt = resp.headers.get("X-Ketang-Timing")
            if xt:
                try:
                    timing = json.loads(xt)
                except Exception:
                    timing = None
            return resp.status, payload, ms, timing, st
    except urllib.error.HTTPError as exc:
        ms = int((time.perf_counter() - t0) * 1000)
        try:
            payload = json.loads(exc.read().decode("utf-8"))
        except Exception:
            payload = {"error": str(exc)}
        return exc.code, payload, ms, payload.get("_timing"), None


def summarize(values: list[int]) -> dict:
    if not values:
        return {"n": 0, "p50": None, "max": None}
    ordered = sorted(values)
    mid = ordered[len(ordered) // 2]
    return {"n": len(ordered), "p50": mid, "max": ordered[-1], "samples": ordered}


def create_payload(resource: str, stamp: int) -> dict:
    if resource == "event":
        return {
            "resource": "event",
            "action": "create",
            "name": f"延迟探针-{stamp}",
            "event_type": "禅营",
            "gender_type": "混合",
            "expected_count": 0,
            "status": "筹备中",
        }
    if resource == "room":
        return {
            "resource": "room",
            "action": "create",
            "name": f"探针房-{stamp}",
            "location": "探针",
            "floor": 1,
            "dorm_type": "男寮",
        }
    raise SystemExit(f"unsupported resource: {resource}")


def delete_payload(resource: str, create_body: dict) -> dict | None:
    if resource == "event":
        eid = create_body.get("event_id")
        if not eid:
            return None
        return {"resource": "event", "action": "delete", "event_id": eid}
    if resource == "room":
        rid = create_body.get("room_id")
        if not rid:
            return None
        return {"resource": "room", "action": "delete", "room_id": rid}
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Admin write latency probe")
    parser.add_argument("--base", default="https://wulingkt.net")
    parser.add_argument("--resource", default="event", choices=["event", "room"])
    parser.add_argument("--samples", type=int, default=2)
    parser.add_argument("--role", default="admin")
    parser.add_argument("--password", default="admin")
    args = parser.parse_args()
    base = args.base.rstrip("/")
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(jar)
    )

    print(f"Target: {base} resource={args.resource} samples={args.samples}")

    st, body, login_ms, login_timing, _ = request_json(
        opener,
        base,
        "/api/db?timing=1",
        method="POST",
        body={
            "action": "login_role",
            "role": args.role,
            "password": args.password,
        },
    )
    if st != 200 or not body.get("user"):
        print(f"FAIL login status={st} body={body}")
        return 1
    print(f"login_ms={login_ms} timing={login_timing}")

    create_totals = []
    create_inits = []
    create_auths = []
    create_bizs = []
    delete_totals = []

    for i in range(max(1, args.samples)):
        stamp = int(time.time() * 1000) + i
        payload = create_payload(args.resource, stamp)
        st, body, ms, timing, server_timing = request_json(
            opener,
            base,
            "/api/v1/admin/records?timing=1",
            method="POST",
            body=payload,
        )
        if st != 200:
            print(f"FAIL create#{i+1} status={st} body={body}")
            return 1
        create_totals.append(ms)
        timing = timing or body.get("_timing") or {}
        create_inits.append(timing.get("init_ms"))
        create_auths.append(timing.get("auth_ms"))
        create_bizs.append(timing.get("biz_ms"))
        label = "cold" if i == 0 else f"warm{i}"
        print(
            f"create_{label}_ms={ms} init_ms={timing.get('init_ms')} "
            f"auth_ms={timing.get('auth_ms')} biz_ms={timing.get('biz_ms')} "
            f"patch_complete={body.get('patch_complete')} "
            f"server_timing={server_timing}"
        )

        del_body = delete_payload(args.resource, body)
        if del_body:
            st, dbody, dms, dtiming, _ = request_json(
                opener,
                base,
                "/api/v1/admin/records?timing=1",
                method="POST",
                body=del_body,
            )
            if st != 200:
                print(f"FAIL delete#{i+1} status={st} body={dbody}")
                return 1
            delete_totals.append(dms)
            dtiming = dtiming or dbody.get("_timing") or {}
            print(
                f"delete_{label}_ms={dms} init_ms={dtiming.get('init_ms')} "
                f"biz_ms={dtiming.get('biz_ms')}"
            )

    def clean(vals):
        return [v for v in vals if isinstance(v, (int, float))]

    print("summary_create_total", summarize(create_totals))
    print("summary_create_init", summarize(clean(create_inits)))
    print("summary_create_auth", summarize(clean(create_auths)))
    print("summary_create_biz", summarize(clean(create_bizs)))
    print("summary_delete_total", summarize(delete_totals))
    print("PASS: admin write latency probe")
    return 0


if __name__ == "__main__":
    sys.exit(main())
