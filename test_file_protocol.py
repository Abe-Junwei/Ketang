#!/usr/bin/env python3
"""验证本地 file:// 协议下页面能正常初始化。

普通 `<script src>` 加载外部 JS 在 file:// 下通常没问题，但 sql.js 需要加载
同级目录的 sql-wasm.wasm，Chrome 必须带有 --allow-file-access-from-files。
本测试使用与启动脚本相同的逻辑来验证 file:// 初始化。
"""
import os
import platform
import re
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
HTML = os.path.join(ROOT, 'index.html')


def chrome_binary():
    system = platform.system()
    if system == 'Darwin':
        return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    if system == 'Windows':
        candidates = [
            r'C:\Program Files\Google\Chrome\Application\chrome.exe',
            r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
        ]
        for c in candidates:
            if os.path.exists(c):
                return c
    # 兜底：在 PATH 中查找
    for name in ['google-chrome', 'google-chrome-stable', 'chromium', 'chrome']:
        try:
            return subprocess.check_output(['which', name], text=True).strip()
        except Exception:
            pass
    return None


def main():
    chrome = chrome_binary()
    if not chrome:
        print('SKIP: Chrome not found')
        sys.exit(0)

    url = f'file://{HTML}'
    cmd = [
        chrome,
        '--headless=old',
        '--disable-gpu',
        '--no-sandbox',
        '--allow-file-access-from-files',
        '--virtual-time-budget=20000',
        '--dump-dom',
        url,
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    except subprocess.TimeoutExpired:
        print('FAIL: Chrome timed out')
        sys.exit(1)

    dom = result.stdout
    if result.returncode != 0:
        print('FAIL: Chrome exited with error')
        print(result.stderr[:1000])
        sys.exit(1)

    checks = []

    # 1. 基础 DOM 存在
    checks.append(('title', '<title>客堂住宿系统</title>' in dom))
    checks.append(('view-board', 'id="view-board"' in dom))
    checks.append(('view-lodging', 'id="view-lodging"' in dom))
    checks.append(('view-stay', 'id="view-stay"' in dom))

    # 2. 首页统计已渲染（JS 已执行）
    stat_match = re.search(r'id="stat-total">\s*(\d+)\s*<', dom)
    checks.append(('stat-total rendered', bool(stat_match)))

    # 3. 侧边栏按钮已启用（未停留在初始 disabled 状态）
    nav_buttons = re.findall(r'<button[^>]*onclick="showView\([^)]+\)"[^>]*>', dom)
    any_disabled = any('disabled' in btn for btn in nav_buttons)
    checks.append(('nav buttons enabled', len(nav_buttons) > 0 and not any_disabled))

    # 4. 没有初始化错误提示
    checks.append(('no init error', '客堂系统初始化失败' not in dom))

    failed = [name for name, ok in checks if not ok]
    if failed:
        print('FAIL: file:// initialization incomplete')
        for name, ok in checks:
            status = 'OK' if ok else 'FAIL'
            print(f'  [{status}] {name}')
        sys.exit(1)

    print(f'PASS: file:// initialized, stat-total={stat_match.group(1) if stat_match else "?"}')


if __name__ == '__main__':
    main()
