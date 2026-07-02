#!/usr/bin/env python3
"""Scan js/ for refreshAfterWrite / renderAll usage (Phase 0 audit)."""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JS_DIR = ROOT / "js"

REFRESH_RE = re.compile(
    r"refreshAfterWrite\s*\(\s*([^)]*)\)",
)
RENDER_ALL_RE = re.compile(r"renderAll\s*\(")


def scan_file(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    refreshes = []
    for m in REFRESH_RE.finditer(text):
        line = text.count("\n", 0, m.start()) + 1
        args = m.group(1).strip()
        scoped = "infoOnly" in args or "scope" in args or "fullRefresh" in args
        active_view = "getActiveViewId" in text or "refreshViewForScope" in text
        refreshes.append({
            "line": line,
            "args": args or "(none)",
            "scoped": scoped or (not args or args == "writeResult"),
        })
    render_all = []
    for m in RENDER_ALL_RE.finditer(text):
        line = text.count("\n", 0, m.start()) + 1
        render_all.append(line)
    return {"refreshes": refreshes, "render_all_lines": render_all}


def main() -> int:
    files = sorted(JS_DIR.glob("*.js"))
    total_refresh = 0
    unscoped = 0
    print("# refreshAfterWrite / renderAll audit\n")
    print("| file | refreshAfterWrite | unscoped | renderAll calls |")
    print("|------|-------------------|----------|-----------------|")
    for path in files:
        if path.name in ("sync-coordinator.js",):
            continue
        data = scan_file(path)
        n = len(data["refreshes"])
        u = sum(1 for r in data["refreshes"] if not r["scoped"])
        total_refresh += n
        unscoped += u
        if n or data["render_all_lines"]:
            print(
                f"| {path.name} | {n} | {u} | {len(data['render_all_lines'])} |"
            )
    print(f"\nTotal refreshAfterWrite: {total_refresh}, unscoped: {unscoped}")
    print("\n## Unscoped call sites\n")
    for path in files:
        data = scan_file(path)
        for r in data["refreshes"]:
            if not r["scoped"]:
                print(f"- {path.name}:{r['line']} refreshAfterWrite({r['args']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
