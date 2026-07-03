#!/usr/bin/env python3
"""在线写 API 响应契约：权限、写后同步元数据、前端刷新接线。"""
import re
import sys
from pathlib import Path


def read(path):
    return Path(path).read_text(encoding="utf-8")


def function_body(src, name):
    marker = f"export async function {name}"
    start = src.find(marker)
    if start == -1:
        return ""
    next_export = src.find("\nexport async function ", start + len(marker))
    if next_export == -1:
        return src[start:]
    return src[start:next_export]


def route_uses(path, permission, shared_function):
    src = read(path)
    checks = [
        (f"{path} imports requirePermission", "requirePermission" in src),
        (
            f"{path} guards {permission}",
            f'requirePermission(env, session, "{permission}")' in src,
        ),
        (f"{path} calls {shared_function}", shared_function in src),
    ]
    return checks


def shared_write_contract(path, function_name, required_fragments):
    src = read(path)
    body = function_body(src, function_name)
    checks = [(f"{function_name} exported", bool(body))]
    for label, fragment in required_fragments:
        checks.append((f"{function_name} {label}", fragment in body))
    return checks


def frontend_write_contract(path, api_function, refresh_fragment):
    src = read(path)
    api_pos = src.find(api_function)
    refresh_pos = src.find(refresh_fragment, api_pos if api_pos >= 0 else 0)
    return [
        (f"{path} calls {api_function}", api_pos >= 0),
        (f"{path} refreshes after {api_function}", refresh_pos >= 0),
    ]


def main():
    checks = []
    routes = [
        (
            "functions/api/v1/check-in.js",
            "lodging.checkin",
            "apiCheckIn",
        ),
        (
            "functions/api/v1/checkout.js",
            "lodging.checkout",
            "apiCheckout",
        ),
        (
            "functions/api/v1/change-bed.js",
            "lodging.change_bed",
            "apiChangeBed",
        ),
        (
            "functions/api/v1/extend-stay.js",
            "lodging.edit",
            "apiExtendStay",
        ),
        (
            "functions/api/v1/assign-bed.js",
            "lodging.change_bed",
            "apiAssignBed",
        ),
        (
            "functions/api/v1/edit-lodger.js",
            "lodging.edit",
            "apiEditLodger",
        ),
        (
            "functions/api/v1/delete-lodger.js",
            "lodging.edit",
            "apiDeleteLodger",
        ),
        (
            "functions/api/v1/save-meals.js",
            "meals.write",
            "apiSaveMeals",
        ),
        (
            "functions/api/v1/set-house-status.js",
            "housekeeping.write",
            "apiSetHouseStatus",
        ),
        (
            "functions/api/v1/upsert-reservation.js",
            "reservation.write",
            "apiUpsertReservation",
        ),
        (
            "functions/api/v1/reservation-status.js",
            "reservation.write",
            "apiUpdateReservationStatus",
        ),
        (
            "functions/api/v1/batch-event-members.js",
            "reservation.write",
            "apiBatchEventMembers",
        ),
        (
            "functions/api/v1/batch-check-in.js",
            "lodging.checkin",
            "apiBatchCheckIn",
        ),
        (
            "functions/api/v1/admin/operational-settings.js",
            "users.write",
            "saveOperationalSettings",
        ),
        (
            "functions/api/v1/admin/rooming-plans.js",
            "handleRoomingPlanAction",
            "handleRoomingPlanAction",
        ),
    ]
    for path, permission, shared_function in routes:
        if path.endswith("admin/rooming-plans.js"):
            src = read(path)
            checks.extend([
                (f"{path} imports requireSession", "requireSession" in src),
                (f"{path} calls handleRoomingPlanAction", "handleRoomingPlanAction" in src),
                (f"{path} calls handleRoomingPublishAction", "handleRoomingPublishAction" in src),
            ])
            continue
        checks.extend(route_uses(path, permission, shared_function))

    checks.extend(
        shared_write_contract(
            "functions/_shared/lodgers.js",
            "apiCheckIn",
            [
                ("uses lodgerFinishWrite", "lodgerFinishWrite"),
                ("finishes lodging/board/meals", '["lodging", "board", "meals"]'),
                ("patches lodger", "lodgerId"),
            ],
        )
    )
    checks.extend(
        shared_write_contract(
            "functions/_shared/lodgers.js",
            "apiCheckout",
            [
                ("uses lodgerFinishWrite", "lodgerFinishWrite"),
                ("finishes lodging/board", '["lodging", "board", "housekeeping"]'),
                ("patches bed", "bedIds"),
            ],
        )
    )
    checks.extend(
        shared_write_contract(
            "functions/_shared/lodgers.js",
            "apiChangeBed",
            [
                ("uses lodgerFinishWrite", "lodgerFinishWrite"),
                ("finishes lodging/board", '["lodging", "board", "housekeeping"]'),
                ("patches old/new beds", "bedIds"),
            ],
        )
    )
    checks.extend(
        shared_write_contract(
            "functions/_shared/lodgers.js",
            "apiExtendStay",
            [
                ("uses lodgerFinishWrite", "lodgerFinishWrite"),
                ("finishes lodging/board/meals", '["lodging", "board", "housekeeping", "meals"]'),
                ("patches lodger", "lodgerId"),
            ],
        )
    )
    checks.extend(
        shared_write_contract(
            "functions/_shared/lodgers.js",
            "apiAssignBed",
            [
                ("uses lodgerFinishWrite", "lodgerFinishWrite"),
                ("supports deferred finish", "deferFinishWrite"),
                ("finishes meals when not deferred", '["lodging", "board", "housekeeping", "meals"]'),
                ("patches bed", "bedIds"),
            ],
        )
    )
    checks.extend(
        shared_write_contract(
            "functions/_shared/lodgers.js",
            "apiAssignReservationToBed",
            [
                ("uses lodgerFinishWrite", "lodgerFinishWrite"),
                ("supports deferred finish", "deferFinishWrite"),
                ("finishes meals when not deferred", '["lodging", "board", "meals"]'),
                ("patches reservation", "reservationIds"),
            ],
        )
    )
    checks.extend(
        shared_write_contract(
            "functions/_shared/lodgers.js",
            "apiEditLodger",
            [
                ("uses lodgerFinishWrite", "lodgerFinishWrite"),
                ("finishes lodging/board/meals", '["lodging", "board", "housekeeping", "meals"]'),
                ("patches guest", "guestIds"),
            ],
        )
    )
    checks.extend(
        shared_write_contract(
            "functions/_shared/lodgers.js",
            "apiDeleteLodger",
            [
                ("records tombstone", "recordSyncDeletion"),
                ("finishes meals", '["lodging", "board", "meals"]'),
                ("returns deletion", 'table_name: "lodgers"'),
                ("patches bed", "bedIds"),
            ],
        )
    )
    checks.extend(
        shared_write_contract(
            "functions/_shared/meals.js",
            "apiSaveMeals",
            [
                ("uses enrichWriteResponse", "enrichWriteResponse"),
                ("finishes meals", '["meals"]'),
                ("patches lodger", 'patchTable: "lodgers"'),
                ("patches meal rows", "extraPatches"),
            ],
        )
    )
    checks.extend(
        shared_write_contract(
            "functions/_shared/housekeeping.js",
            "apiSetHouseStatus",
            [
                ("uses enrichWriteResponse", "enrichWriteResponse"),
                ("finishes board", '["board"]'),
                ("patches housekeeping row", "extraPatches"),
            ],
        )
    )
    checks.extend(
        shared_write_contract(
            "functions/_shared/reservations.js",
            "apiUpsertReservation",
            [
                ("uses enrichWriteResponse", "enrichWriteResponse"),
                ("finishes reservations", '["reservations"]'),
                ("patches reservation", "patchRowIds"),
            ],
        )
    )
    checks.extend(
        shared_write_contract(
            "functions/_shared/reservations.js",
            "apiUpdateReservationStatus",
            [
                ("uses enrichWriteResponse", "enrichWriteResponse"),
                ("finishes reservations", '["reservations"]'),
                ("patches reservation", 'patchTable: "reservations"'),
            ],
        )
    )
    checks.extend(
        shared_write_contract(
            "functions/_shared/reservations.js",
            "apiBatchEventMembers",
            [
                ("uses enrichWriteResponse", "enrichWriteResponse"),
                ("finishes reservations board meals", '["reservations", "board", "meals"]'),
                ("patches member rows", "patchRowIds"),
            ],
        )
    )
    checks.extend(
        shared_write_contract(
            "functions/_shared/operational-settings.js",
            "saveOperationalSettings",
            [
                ("uses enrichWriteResponse", "enrichWriteResponse"),
                ("finishes board", '["board"]'),
                ("patches app_meta", "extraPatches: { app_meta:"),
            ],
        )
    )

    frontend = [
        ("js/checkin.js", "apiCheckIn", "rcRefreshAfterWrite"),
        ("js/checkin.js", "apiAssignBed", "rcRefreshAfterWrite"),
        ("js/lodger-actions.js", "apiExtendStay", "rcRefreshAfterWrite"),
        ("js/lodger-actions.js", "apiChangeBed", "rcRefreshAfterWrite"),
        ("js/lodger-actions.js", "apiEditLodger", "rcRefreshAfterWrite"),
        ("js/lodger-actions.js", "apiDeleteLodger", "rcRefreshAfterWrite"),
        ("js/lodger-actions.js", "apiCheckout", "rcRefreshAfterWrite"),
        ("js/meals.js", "apiSaveMeals", "rcRefreshAfterWrite"),
        ("js/housekeeping.js", "apiSetHouseStatus", "rcRefreshAfterWrite"),
        ("js/reservations.js", "apiUpsertReservation", "rcRefreshAfterWrite"),
        ("js/reservations.js", "apiUpdateReservationStatus", "rcRefreshAfterWrite"),
        ("js/events.js", "apiBatchEventMembers", "eventRefreshAfterWrite"),
        ("js/housekeeping.js", "apiAdminSaveOperationalSettings", "rcRefreshAfterWrite"),
    ]
    for path, api_function, refresh_fragment in frontend:
        checks.extend(frontend_write_contract(path, api_function, refresh_fragment))

    failed = [name for name, ok in checks if not ok]
    if failed:
        print("FAIL online write response contract:")
        for item in failed:
            print(" ", item)
        sys.exit(1)
    print("PASS: online write response contracts covered")


if __name__ == "__main__":
    main()