#!/usr/bin/env python3
"""Phase G 快路径静态守卫：304/delta/read module 不得回退到 schema ensure 热路径。"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def fn_body(src: str, fn_name: str) -> str | None:
    m = re.search(rf"export async function {re.escape(fn_name)}\([^)]*\)\s*\{{", src)
    if not m:
        m = re.search(rf"function {re.escape(fn_name)}\([^)]*\)\s*\{{", src)
    if not m:
        return None
    start = m.start()
    depth = 0
    i = m.end() - 1
    while i < len(src):
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth == 0:
                return src[start : i + 1]
        i += 1
    return None


def assert_304_before_init(label: str, body: str) -> list[str]:
    failed = []
    if "finish304" not in body:
        failed.append(f"{label} missing finish304")
        return failed
    if "ensureDatabaseForAuth" not in body:
        return failed
    init_pos = body.find("ensureDatabaseForAuth")
    finish304_pos = body.find("finish304")
    if init_pos < finish304_pos:
        failed.append(f"{label} must not call ensureDatabaseForAuth before finish304")
    return failed


def main() -> int:
    d1 = read("functions/_shared/d1.js")
    api_client = read("js/api-client.js")
    read_model = read("functions/api/v1/read-model.js")
    sync_delta = read("functions/api/v1/sync/delta.js")
    read_module = read("functions/api/v1/read/[module].js")
    failed: list[str] = []

    if "probeProductionDatabaseReady" not in d1 or "authEnsureReady" not in d1:
        failed.append("d1.js missing schema_version probe / authEnsureReady cache")

    init_remote = fn_body(d1, "initRemoteDatabase") or ""
    probe_pos = init_remote.find("probeProductionDatabaseReady")
    rooming_pos = init_remote.find("ensureRoomingSchemaColumnsIfTablesExist")
    if probe_pos < 0 or rooming_pos < 0 or rooming_pos < probe_pos:
        failed.append("initRemoteDatabase must probe production readiness before rooming schema checks")
    if "SELECT include_spare_beds" not in d1 or "SELECT updated_at FROM rooming_plans" not in d1:
        failed.append("production readiness probe must validate rooming columns before skipping migrations")
    if "timeoutMs: options.timeoutMs" not in api_client:
        failed.append("apiFetch 401 retry must preserve timeoutMs")

    failed += assert_304_before_init("read-model", fn_body(read_model, "onRequestGet") or read_model)
    failed += assert_304_before_init("sync/delta", fn_body(sync_delta, "onRequestGet") or sync_delta)

    mod_body = fn_body(read_module, "onRequestGet")
    if not mod_body:
        failed.append("read/[module].js missing onRequestGet")
    elif "ensureDatabaseForAuth" in mod_body:
        failed.append("read/[module] must not call ensureDatabaseForAuth on hot path")

    login_block = re.search(
        r'if \(payload\.action === "login_role"\) \{([\s\S]*?)\n    \}',
        read("functions/api/db.js"),
    )
    if login_block and "PRAGMA table_info" in login_block.group(1):
        failed.append("login_role must not inline PRAGMA table_info loops")

    if failed:
        print("FAIL phase G fast paths:", ", ".join(failed))
        return 1
    print("PASS: phase G API fast paths guarded")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
