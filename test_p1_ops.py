#!/usr/bin/env python3
"""P1 运维资产静态检查 | Verify patrol, baseline, and acceptance checklist."""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent

REQUIRED = [
    "docs/ops/performance-baseline.json",
    "docs/final-acceptance-checklist.md",
    "scripts/post_deploy_check.py",
    "scripts/run_p1_checklist.sh",
    "test_prod_latency.py",
]

missing = [p for p in REQUIRED if not (ROOT / p).exists()]
if missing:
    print("FAIL missing P1 assets:")
    for p in missing:
        print(" -", p)
    sys.exit(1)

baseline = json.loads(
    (ROOT / "docs/ops/performance-baseline.json").read_text(encoding="utf-8")
)
required_metrics = [
    "login_role_ms",
    "session_ms",
    "read_model_ms",
    "read_model_304_ms",
    "board_version_ms",
]
for key in required_metrics:
    if key not in baseline.get("thresholds_ms", {}):
        print(f"FAIL baseline missing threshold {key}")
        sys.exit(1)

phase_g = baseline.get("phase_g_targets_ms", {})
for key in [
    "login_to_ready_p95_ms",
    "delta_sync_p95_ms",
    "read_module_p95_ms",
]:
    if key not in phase_g:
        print(f"FAIL baseline missing phase_g target {key}")
        sys.exit(1)

latency = (ROOT / "test_prod_latency.py").read_text(encoding="utf-8")
if "read_model_304_ms" not in latency or "--check-baseline" not in latency:
    print("FAIL test_prod_latency.py missing 304 probe or baseline check")
    sys.exit(1)
if "--check-phase-g" not in latency or "check_phase_g" not in latency:
    print("FAIL test_prod_latency.py missing phase G check")
    sys.exit(1)
if "probe_frontend_metrics" not in latency or "network_gap_ms" not in latency:
    print("FAIL test_prod_latency.py missing frontend probe or network_gap reporting")
    sys.exit(1)
if "check_login_bootstrap_read_guard" not in latency:
    print("FAIL test_prod_latency.py missing G-6 login bootstrap read guard")
    sys.exit(1)
if "DEFAULT_SAMPLES = 7" not in latency and "default=DEFAULT_SAMPLES" not in latency:
    print("FAIL test_prod_latency.py should default samples to 7")
    sys.exit(1)
if not (ROOT / "test_phase_g_fast_paths.py").exists():
    print("FAIL missing test_phase_g_fast_paths.py")
    sys.exit(1)

patrol = (ROOT / "scripts/post_deploy_check.py").read_text(encoding="utf-8")
if "--allow-access-block" not in patrol:
    print("FAIL post_deploy_check.py missing Access-aware mode")
    sys.exit(1)

checklist = (ROOT / "docs/final-acceptance-checklist.md").read_text(encoding="utf-8")
for phrase in ("并发占床", "权限矩阵", "性能基线"):
    if phrase not in checklist:
        print(f"FAIL final acceptance checklist missing section: {phrase}")
        sys.exit(1)

proc = subprocess.run(
    [
        sys.executable,
        str(ROOT / "test_prod_latency.py"),
        "--help",
    ],
    cwd=str(ROOT),
    capture_output=True,
    text=True,
)
if proc.returncode != 0:
    print("FAIL test_prod_latency.py --help")
    sys.exit(1)

print("OK P1 ops assets")
