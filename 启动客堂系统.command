#!/bin/bash
# 客堂住宿系统 - macOS 启动脚本
# 用法：双击此文件，系统会用 Chrome/Edge 打开 index.html

cd "$(dirname "$0")"

HTML_FILE="file://$(pwd)/index.html"

# 优先用 Chrome 或 Edge 打开，并加上 --allow-file-access-from-files，
# 确保本地 sql.js 能加载同级目录下的 sql-wasm.wasm。
if [ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
        --allow-file-access-from-files "$HTML_FILE" >/dev/null 2>&1 &
elif [ -x "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" ]; then
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
        --allow-file-access-from-files "$HTML_FILE" >/dev/null 2>&1 &
else
    # 兜底：用系统默认浏览器
    open "index.html"
fi
