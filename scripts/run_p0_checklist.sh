#!/usr/bin/env bash
# P0 运维清单一键执行 | Run local P0 checks (export, verify, release build).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DB="${1:-ketang.db}"
IMPORT_JSON="${2:-data/ketang-cloud-import.json}"
BASELINE_JSON="${3:-data/ketang-baseline-$(date +%Y%m%d).json}"

echo "== P0-1 导出并校验迁移 JSON =="
python3 scripts/export_ketang_db_to_json.py "$DB" "$IMPORT_JSON"
python3 scripts/verify_migration_json.py "$IMPORT_JSON"

echo
echo "== P0-3 构建白名单发布目录 =="
bash scripts/build_pages_release.sh

echo
echo "== 本地完成。线上步骤 =="
echo "1. 系统设置 → 从 JSON 恢复：$IMPORT_JSON"
echo "2. 导出基线备份到：$BASELINE_JSON"
echo "3. 恢复演练后对比：python3 scripts/compare_backup_json.py $BASELINE_JSON <恢复后.json>"
echo "4. 白名单部署：npx wrangler pages deploy .release --project-name ketang"
echo "5. 发布后巡检：python3 scripts/post_deploy_check.py --base https://wulingkt.net --run-latency"
