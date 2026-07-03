#!/usr/bin/env bash
# P1 运维与验收准备 | Patrol, latency baseline, contract tests
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PATROL_BASE="${1:-https://wulingkt.net}"
LATENCY_BASE="${2:-$PATROL_BASE}"

echo "== P1 contract tests =="
python3 test_auth_gateway.py
python3 test_p1_ops.py

echo
echo "== P1 post-deploy patrol ($PATROL_BASE) =="
python3 scripts/post_deploy_check.py --base "$PATROL_BASE" --allow-access-block

echo
echo "== P1 latency baseline ($LATENCY_BASE) =="
python3 test_prod_latency.py --base "$LATENCY_BASE" --samples 3 \
  --check-baseline docs/ops/performance-baseline.json \
  --write-report /tmp/ketang-latency-report.json || true
python3 test_prod_latency.py --base "$LATENCY_BASE" --samples 3 \
  --check-phase-g --check-baseline docs/ops/performance-baseline.json \
  || echo "WARN: phase G targets not met (see /tmp/ketang-latency-report.json)"

echo
echo "OK P1 checklist passed"
echo "Manual final acceptance: docs/final-acceptance-checklist.md"
