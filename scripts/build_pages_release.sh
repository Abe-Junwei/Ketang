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
copy_file styles.css styles.css
copy_file _headers _headers
copy_file _routes.json _routes.json
copy_file manifest.webmanifest manifest.webmanifest
copy_file role-permissions.defaults.json role-permissions.defaults.json
copy_tree js js
copy_tree lib lib
copy_tree fonts fonts
copy_tree functions functions

if [[ -f "$ROOT/lib/sql-wasm.wasm" ]]; then
  copy_file lib/sql-wasm.wasm lib/sql-wasm.wasm
fi

python3 "$ROOT/scripts/verify_release_dir.py" "$OUT"
echo "OK release build ready: $OUT"
echo "Deploy: npx wrangler pages deploy \"$OUT\" --project-name ketang"
