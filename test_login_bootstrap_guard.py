#!/usr/bin/env python3
"""G-6 CDP guard: login must not trigger separate read:board fetch."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from test_prod_latency import check_login_bootstrap_read_guard


def main() -> int:
    baseline_path = ROOT / "docs/ops/performance-baseline.json"
    baseline = json.loads(baseline_path.read_text(encoding="utf-8"))

    fail_keys = baseline.get("probe_check_levels", {}).get("fail", [])
    if "login_bootstrap_extra_read_module" not in fail_keys:
        print("FAIL baseline missing login_bootstrap_extra_read_module in probe_check_levels.fail")
        return 1

    ok_results = {
        "read_module_marks": [],
        "frontend_login_ready_ms": {"p95_ms": 8000},
    }
    fails, warns = check_login_bootstrap_read_guard(ok_results, baseline)
    if fails or warns:
        print("FAIL guard should pass for empty read_module_marks:", fails, warns)
        return 1

    bad_results = {
        "read_module_marks": [
            "ketang:read:board",
            "ketang:read:board:start",
            "ketang:read:board:end",
        ],
        "frontend_read_board_ms": {"p95_ms": 3200},
    }
    fails, warns = check_login_bootstrap_read_guard(bad_results, baseline)
    if not fails:
        print("FAIL guard should FAIL when read_module_marks contains read:board")
        return 1
    if "login_bootstrap_extra_read_module" not in fails[0]:
        print("FAIL guard message missing key:", fails[0])
        return 1

    skip_results = {"frontend_probe_skip": {"_skip": "chrome_not_found"}}
    fails, warns = check_login_bootstrap_read_guard(skip_results, baseline)
    if fails or warns:
        print("FAIL guard should skip when frontend probe skipped")
        return 1

    seeded_ok = {"read_module_marks": ["ketang:read:board:seeded"]}
    fails, warns = check_login_bootstrap_read_guard(seeded_ok, baseline)
    if fails or warns:
        print("FAIL seeded mark should not trigger guard:", fails, warns)
        return 1

    restore_ok = {
        "read_module_marks": [],
        "restore_probe_ok": True,
        "restore_logged_in": True,
        "restore_pending_gate": False,
        "restore_overlay_active": False,
        "restore_shell_visible": True,
        "restore_read_module_marks": [],
    }
    fails, warns = check_login_bootstrap_read_guard(restore_ok, baseline)
    if fails or warns:
        print("FAIL restore ok should pass:", fails, warns)
        return 1

    restore_bad = {
        "read_module_marks": [],
        "restore_probe_ok": True,
        "restore_logged_in": True,
        "restore_pending_gate": False,
        "restore_overlay_active": False,
        "restore_shell_visible": True,
        "restore_read_module_marks": ["ketang:read:board"],
    }
    fails, warns = check_login_bootstrap_read_guard(restore_bad, baseline)
    if not fails:
        print("FAIL restore read:board should fail guard")
        return 1

    anon_shell = {
        "read_module_marks": [],
        "restore_probe_ok": True,
        "restore_logged_in": False,
        "restore_pending_gate": False,
        "restore_overlay_active": True,
        "restore_shell_visible": True,
        "restore_read_module_marks": [],
    }
    fails, warns = check_login_bootstrap_read_guard(anon_shell, baseline)
    if not fails:
        print("FAIL anonymous shell visible should fail guard")
        return 1

    latency = (ROOT / "test_prod_latency.py").read_text(encoding="utf-8")
    if "check_login_bootstrap_read_guard" not in latency:
        print("FAIL test_prod_latency.py missing check_login_bootstrap_read_guard")
        return 1
    if "restore_read_module_marks" not in latency:
        print("FAIL test_prod_latency.py missing session restore CDP probe")
        return 1

    print("PASS: login bootstrap read guard contracts")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
