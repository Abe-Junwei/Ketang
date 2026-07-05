#!/usr/bin/env python3
"""P4：/api/db SQL 网关 query/run/batch_query 已退役，审计与改密走 v1。"""
import sys
from pathlib import Path


def read(path):
    return Path(path).read_text(encoding="utf-8")


def main():
    db_api = read("functions/api/db.js")
    audit_js = read("js/audit.js")
    api = read("js/api-client.js")
    failed = []
    if 'payload.action === "batch_query"' in db_api:
        failed.append("db.js still handles batch_query")
    if 'payload.action === "query"' in db_api:
        failed.append("db.js still handles query")
    if 'payload.action === "run"' in db_api and "410" not in db_api:
        failed.append("db.js still handles run")
    if not Path("functions/api/v1/audit.js").is_file():
        failed.append("missing functions/api/v1/audit.js")
    if not Path("functions/api/v1/auth/change-password.js").is_file():
        failed.append("missing functions/api/v1/auth/change-password.js")
    if "apiPostAudit" not in audit_js:
        failed.append("audit.js must use apiPostAudit")
    if 'action: "run"' in audit_js:
        failed.append("audit.js still uses /api/db run")
    if "typeof isRemoteDB === \"function\" && isRemoteDB())" not in audit_js:
        failed.append("audit.js must guard online path without local run()")
    if "/api/v1/auth/change-password" not in api:
        failed.append("api-client must call /api/v1/auth/change-password")
    if "remoteBatchQuery" in api:
        failed.append("remoteBatchQuery should be removed")
    if 'payload.action === "login"' in db_api and "410" not in db_api:
        failed.append("db.js must retire legacy login with 410")
    if 'payload.action === "login_role"' in db_api and "410" not in db_api:
        failed.append("db.js must retire legacy login_role with 410")
    if 'payload.action === "init"' in db_api:
        failed.append("db.js must not handle init (use /api/v1/admin/migrate)")
    if 'payload.action === "users"' in db_api:
        failed.append("db.js must not handle users (static HTML roles)")
    if "LEGACY_DB_RETIRED" not in db_api:
        failed.append("db.js must use unified LEGACY_DB_RETIRED 410 response")
    if failed:
        print("FAIL sql gateway retirement:")
        for item in failed:
            print(" ", item)
        sys.exit(1)
    print("PASS: /api/db SQL gateway retired; audit + change-password on v1")


if __name__ == "__main__":
    main()
