#!/usr/bin/env python3
"""Phase G-3：lodgers 读模块拆分契约。"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def main() -> int:
    rm = read("functions/_shared/read-modules.js")
    rc = read("js/read-cache.js")
    hist = read("js/history.js")
    sync = read("functions/_shared/sync-modules.js")
    checks = [
        ("lodgers_active module", "lodgers_active:" in rm),
        ("lodgers_recent module", "lodgers_recent:" in rm),
        ("lodgers_lookup module", "lodgers_lookup:" in rm),
        ("history page builder", "buildLodgersHistoryPage" in rm),
        ("special module guard", "isSpecialReadModule" in rm),
        ("lodgers_lookup deferred", '"lodgers_lookup"' in rc and "RC_DEFERRED_MODULES" in rc),
        ("no lodgers_records deferred", "RC_DEFERRED_MODULES" in rc and
         'RC_DEFERRED_MODULES = [\n  "lodgers",\n  "lodgers_lookup"' in rc.replace("\r\n", "\n")),
        ("rcKickoffBoardBootstrap", "rcKickoffBoardBootstrap" in rc),
        ("login kickoff board", "rcKickoffBoardBootstrap(true)" in read("js/auth.js")),
        ("history server fetch", "rcFetchHistoryRows" in hist),
        ("lodgers_active projection", "LODGERS_ACTIVE_LODGER_FIELDS" in rm),
        ("lookup id_card", '"id_card"' in rm and "lodgers_lookup" in rm),
        ("rcLookupLodgersInHouse", "rcLookupLodgersInHouse" in rc),
        ("validation uses lookup", "rcLookupLodgersInHouse" in read("js/validation.js")),
        ("lodging domain split", 'lodging: ["lodgers_active", "lodgers_lookup"]' in sync),
    ]
    failed = [name for name, ok in checks if not ok]
    if failed:
        print("FAIL lodgers module split:", ", ".join(failed))
        return 1
    print("PASS: lodgers read modules split contracts")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
