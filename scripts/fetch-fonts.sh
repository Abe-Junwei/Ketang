#!/usr/bin/env bash
# 下载自托管字体子集（需联网一次，之后可离线使用）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/fonts"
mkdir -p "$DIR"
cd "$DIR"

fetch() { curl -sfL "$1" -o "$2" && echo "OK $2"; }

fetch "https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-sc@5.2.8/files/noto-serif-sc-chinese-simplified-400-normal.woff2" "noto-serif-sc-400.woff2"
fetch "https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-sc@5.2.8/files/noto-serif-sc-chinese-simplified-600-normal.woff2" "noto-serif-sc-600.woff2"
fetch "https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-sc@5.2.8/files/noto-serif-sc-chinese-simplified-700-normal.woff2" "noto-serif-sc-700.woff2"
fetch "https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.2.8/files/noto-sans-sc-chinese-simplified-400-normal.woff2" "noto-sans-sc-400.woff2"
fetch "https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.2.8/files/noto-sans-sc-chinese-simplified-500-normal.woff2" "noto-sans-sc-500.woff2"
fetch "https://cdn.jsdelivr.net/npm/@fontsource/source-sans-3@5.2.8/files/source-sans-3-latin-400-normal.woff2" "source-sans-3-400.woff2"
fetch "https://cdn.jsdelivr.net/npm/@fontsource/source-sans-3@5.2.8/files/source-sans-3-latin-500-normal.woff2" "source-sans-3-500.woff2"
fetch "https://cdn.jsdelivr.net/npm/@fontsource/source-serif-4@5.2.8/files/source-serif-4-latin-400-normal.woff2" "source-serif-4-400.woff2"
fetch "https://cdn.jsdelivr.net/npm/@fontsource/source-serif-4@5.2.8/files/source-serif-4-latin-600-normal.woff2" "source-serif-4-600.woff2"

echo "Fonts ready in $DIR"
