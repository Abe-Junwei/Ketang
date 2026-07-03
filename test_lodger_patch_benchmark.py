#!/usr/bin/env python3
"""Phase 12.4 lodger patch benchmark: 1000+ rows DB, small patch P95 ≤2s."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LODGER_TARGET = int(os.environ.get("KETANG_BENCH_LODGERS", "1050"))
PATCH_ROWS = int(os.environ.get("KETANG_BENCH_PATCH_ROWS", "5"))
SAMPLE_COUNT = int(os.environ.get("KETANG_BENCH_SAMPLES", "10"))
P95_LIMIT_MS = int(os.environ.get("KETANG_BENCH_P95_MS", "2000"))


def percentile(values: list[int], pct: float) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    rank = (pct / 100.0) * (len(ordered) - 1)
    lower = int(rank)
    upper = min(lower + 1, len(ordered) - 1)
    weight = rank - lower
    return int(round(ordered[lower] * (1 - weight) + ordered[upper] * weight))


def local_cdp_benchmark() -> bool:
    from test_cdp import PORT, evaluate, start_server
    from test_file_protocol import chrome_binary

    import websocket

    if not chrome_binary():
        print("SKIP local patch benchmark: Chrome not found")
        return True

    server = start_server()
    proc = subprocess.Popen(
        [
            chrome_binary(),
            "--remote-debugging-port=9229",
            "--remote-allow-origins=*",
            "--headless=new",
            "--disable-gpu",
            "--no-sandbox",
            "--disable-dev-shm-usage",
            f"http://127.0.0.1:{PORT}/index.html",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        for _ in range(30):
            try:
                subprocess.run(
                    ["curl", "-s", "http://127.0.0.1:9229/json"],
                    capture_output=True,
                    check=True,
                    timeout=1,
                )
                break
            except Exception:
                time.sleep(0.5)
        else:
            print("FAIL CDP not ready")
            return False

        pages = json.loads(
            subprocess.run(
                ["curl", "-s", "http://127.0.0.1:9229/json"],
                capture_output=True,
                text=True,
                check=True,
            ).stdout
        )
        ws_url = next(
            (
                p.get("webSocketDebuggerUrl")
                for p in pages
                if p.get("type") == "page" and str(PORT) in p.get("url", "")
            ),
            None,
        )
        if not ws_url:
            print("FAIL no CDP page")
            return False

        ws = websocket.create_connection(ws_url, timeout=30)
        ws.send(json.dumps({"id": 1, "method": "Runtime.enable"}))
        ws.recv()
        for _ in range(30):
            if evaluate(ws, "window.ketangReady").get("value") is True:
                break
            time.sleep(0.5)
        else:
            print("FAIL app init timeout")
            return False

        seed_expr = f"""
        (function () {{
          ensureRemoteLocalSchema();
          const target = {LODGER_TARGET};
          const existing = db.exec("SELECT COUNT(*) as c FROM lodgers")[0].values[0][0];
          const need = Math.max(0, target - existing);
          if (need > 0) {{
            db.run("BEGIN");
            for (let i = 0; i < need; i++) {{
              run(
                "INSERT INTO lodgers (name, status, check_in_date, updated_at) VALUES (?, ?, ?, datetime('now'))",
                ["压测" + (existing + i), "在住", "2026-07-01"],
              );
            }}
            db.run("COMMIT");
          }}
          return db.exec("SELECT COUNT(*) as c FROM lodgers")[0].values[0][0];
        }})()
        """
        lodger_count = evaluate(ws, seed_expr, timeout=120).get("value") or 0
        if lodger_count < LODGER_TARGET:
            print(f"FAIL seed lodgers: expected>={LODGER_TARGET}, got={lodger_count}")
            return False
        print(f"OK seeded {lodger_count} lodgers for patch benchmark")

        bench_expr = f"""
        (function () {{
          ensureRemoteLocalSchema();
          const patchRows = query(
            "SELECT * FROM lodgers ORDER BY id DESC LIMIT {PATCH_ROWS}",
          );
          const patches = {{ lodgers: patchRows }};
          const samples = [];
          for (let i = 0; i < {SAMPLE_COUNT}; i++) {{
            const t0 = performance.now();
            applyModuleTablesInner(patches, {{ upsertOnly: true }});
            samples.push(Math.round(performance.now() - t0));
          }}
          return {{
            lodgerCount: db.exec("SELECT COUNT(*) as c FROM lodgers")[0].values[0][0],
            patchRows: patchRows.length,
            samples: samples,
          }};
        }})()
        """
        result = evaluate(ws, bench_expr, timeout=120).get("value") or {}
        ws.close()

        samples = [int(x) for x in (result.get("samples") or [])]
        if len(samples) < SAMPLE_COUNT:
            print("FAIL benchmark samples:", result)
            return False

        p50 = percentile(samples, 50)
        p95 = percentile(samples, 95)
        print(
            f"OK local patch apply: lodgers={result.get('lodgerCount')} "
            f"patch_rows={result.get('patchRows')} samples={samples} "
            f"p50={p50}ms p95={p95}ms limit={P95_LIMIT_MS}ms"
        )
        if p95 > P95_LIMIT_MS:
            print(f"FAIL local patch P95 {p95}ms exceeds {P95_LIMIT_MS}ms")
            return False
        return True
    finally:
        proc.kill()
        proc.wait(timeout=5)
        server.kill()
        server.wait(timeout=5)


def production_delta_benchmark() -> bool:
    if os.environ.get("KETANG_NETWORK_BENCH") != "1":
        print("SKIP production delta benchmark (set KETANG_NETWORK_BENCH=1)")
        return True

    from test_prod_latency import load_baseline, percentile, request_json

    base = os.environ.get("KETANG_BASE_URL", "https://wulingkt.net").rstrip("/")
    password = os.environ.get("KETANG_ADMIN_PASSWORD", "admin")
    baseline = load_baseline(ROOT / "docs/ops/performance-baseline.json")
    limit = baseline["thresholds_ms"].get("sync_delta_ms", P95_LIMIT_MS)

    status = 0
    body: dict = {}
    for attempt in range(3):
        status, body, _, _ = request_json(
            f"{base}/api/db",
            method="POST",
            body={"action": "login_role", "role": "admin", "password": password},
            timeout=90,
        )
        if status == 200 and body.get("user"):
            break
        time.sleep(2)
    if status != 200 or not body.get("user"):
        print(
            f"SKIP production delta benchmark: login status={status} "
            f"(local 1000+ benchmark already passed)"
        )
        return True

    status, body, _, _ = request_json(f"{base}/api/v1/read/lodgers_active?timing=1")
    if status != 200:
        print(f"FAIL read/lodgers_active status={status}")
        return False
    lodgers = (body.get("tables") or {}).get("lodgers") or []
    lodger_count = len(lodgers)
    board_version = body.get("board_version") or 0
    print(f"Production lodger rows in read module: {lodger_count}")

    if lodger_count < LODGER_TARGET:
        print(
            f"SKIP production delta benchmark: lodgers={lodger_count} < {LODGER_TARGET} "
            "(local benchmark covers 1000+ scenario)"
        )
        return True

    since = max(0, int(board_version) - 1)
    samples: list[int] = []
    for _ in range(SAMPLE_COUNT):
        status, payload, ms, _ = request_json(
            f"{base}/api/v1/sync/delta?since={since}&timing=1",
            headers={"If-None-Match": str(since)},
        )
        samples.append(ms)
        if status not in (200, 304):
            print(f"FAIL sync/delta status={status} body={payload}")
            return False

    p50 = percentile(samples, 50)
    p95 = percentile(samples, 95)
    print(
        f"OK production sync/delta: lodgers={lodger_count} since={since} "
        f"samples={samples} p50={p50}ms p95={p95}ms limit={limit}ms"
    )
    if p95 > limit:
        print(f"FAIL production sync/delta P95 {p95}ms exceeds {limit}ms")
        return False
    return True


def main() -> int:
    if not local_cdp_benchmark():
        return 1
    if not production_delta_benchmark():
        return 1
    print("PASS lodger patch benchmark")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
