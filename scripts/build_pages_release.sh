#!/usr/bin/env bash
# P0-3 白名单发布构建 | Build Cloudflare Pages release from allowlist only.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${ROOT}/.release"

rm -rf "$OUT"
mkdir -p "$OUT"

copy_file() {
  local src="$1"
  local dst="$2"
  mkdir -p "$(dirname "$OUT/$dst")"
  cp "$ROOT/$src" "$OUT/$dst"
}

copy_tree() {
  local src="$1"
  local dst="$2"
  mkdir -p "$OUT/$dst"
  cp -R "$ROOT/$src/." "$OUT/$dst/"
}

copy_file index.html index.html
copy_file reserve.html reserve.html
copy_file styles.css styles.css
copy_file _headers _headers
copy_file _routes.json _routes.json
copy_file manifest.webmanifest manifest.webmanifest
copy_file sw.js sw.js
copy_tree icons icons
copy_file role-permissions.defaults.json role-permissions.defaults.json
copy_tree js js
copy_tree fonts fonts
copy_tree resources resources
copy_tree functions functions

# 在线发布包不携带 sql-wasm（仅本地迁移 CI / ?force_local_db=1 开发路径需要 lib/）

python3 "$ROOT/scripts/verify_release_dir.py" "$OUT"
echo "OK release build ready: $OUT"
echo "Deploy: npx wrangler pages deploy \"$OUT\" --project-name ketang"
