#!/usr/bin/env python3
"""写响应应附带 patches/deletions（Directus read-after-write 对齐）。"""
import sys


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def main():
    wr = read("functions/_shared/write-response.js")
    ar = read("functions/_shared/admin-records.js")
    info = read("js/info.js")
    rc = read("js/read-cache.js")

    checks = [
        ("enrichWriteResponse", "export async function enrichWriteResponse" in wr),
        ("admin uses enrich", "enrichWriteResponse" in ar),
        ("admin room patch", 'patchTable: "rooms"' in ar),
        ("admin delete tombstone", "deletion: { table_name:" in ar),
        ("rcApplyWriteResult", "function rcApplyWriteResult" in rc),
        ("info cache-first render", "infoRcTabDataReady" in info),
        ("info no loading on filter", "infoRenderCurrentTabLists()" in info),
        ("info server patches", "infoApplyWritePatches" in info),
        ("lodgers enrich", "lodgerFinishWrite" in read("functions/_shared/lodgers.js")),
        ("reservations batch patches", "patchRowIds" in read("functions/_shared/reservations.js")),
        ("rcRefreshAfterWrite", "function rcRefreshAfterWrite" in rc),
        (
            "rcRefreshAfterWrite single impl",
            rc.count("function rcRefreshAfterWrite") == 1
            and "rcApplyWriteResult(writeResult)" in rc
            and "rcInvalidateMany(moduleKeys)" not in rc,
        ),
        ("info lodger map", "infoLodgerOnBedMap" in info),
        ("delete bed rooming", "rooming_assignments SET bed_id = NULL" in read("functions/_shared/admin-records.js")),
    ]
    failed = [name for name, ok in checks if not ok]
    if failed:
        print("FAIL write patch contract:", ", ".join(failed))
        sys.exit(1)
    print("PASS: write response patches + cache-first info render")


if __name__ == "__main__":
    main()
