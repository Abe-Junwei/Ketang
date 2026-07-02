@echo off
chcp 65001 >nul
echo ========================================
echo   客堂管理系统
echo ========================================
echo.
echo 正在打开系统，请使用浏览器操作...
echo.
echo 提示：数据保存在本机浏览器内，
echo       请定期在「系统设置」页面导出 ketang.db。
echo.

rem 优先用 Chrome 或 Edge 打开，更像本地应用。
rem 加上 --allow-file-access-from-files，确保本地 sql.js 能加载 sql-wasm.wasm。
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --allow-file-access-from-files --app="file:///%CD%\index.html"
    exit
)

if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    start "" "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" --allow-file-access-from-files --app="file:///%CD%\index.html"
    exit
)

if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" (
    start "" "C:\Program Files\Microsoft\Edge\Application\msedge.exe" --allow-file-access-from-files --app="file:///%CD%\index.html"
    exit
)

if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" (
    start "" "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --allow-file-access-from-files --app="file:///%CD%\index.html"
    exit
)

rem 兜底：用系统默认浏览器
start "" "index.html"
