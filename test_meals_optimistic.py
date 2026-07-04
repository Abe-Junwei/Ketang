#!/usr/bin/env python3
"""Phase C-L2：用斋保存局部乐观更新与失败回滚。"""
import sys
from pathlib import Path


def read(path):
    return Path(path).read_text(encoding="utf-8")


def main():
    meals = read("js/meals.js")
    backend = read("functions/_shared/meals.js")
    contract = read("test_online_write_response_contract.py")
    checks = [
        ("modal grid uses rc meals", "function mealRowsForLodgerRender" in meals and "readMealsForLodger(lodgerId)" in meals),
        ("builds days once", "function buildMealDaysFromModal" in meals),
        ("optimistic helper", "function applyMealsOptimistic" in meals),
        ("rollback helper", "function rollbackMealsOptimistic" in meals),
        ("optimistic patches lodger defaults", "meal_default_breakfast" in meals and "lodgers" in meals),
        ("optimistic patches meals", "rcApplyDeltaPatches" in meals and "meals" in meals),
        ("success checks rollback", "if (!rollbackOk) await forceRefreshMeals()" in meals),
        ("success refreshes visible meals", "function refreshMealsVisibleSurfaces" in meals and "renderTodayMealsPanel" in meals and "viewRefresh: refreshMealsVisibleSurfaces" in meals),
        ("failure force fetches meals", "rcEnsureMeals(true)" in meals),
        ("failure refreshes visible meals", "var refreshOk = await forceRefreshMeals();\n      refreshMealsVisibleSurfaces();" in meals),
        ("local write result", "writeResult = { ok: true, local: true };" in meals),
        ("rollback failure surfaced", "无法恢复最新用斋数据" in meals),
        ("backend queries meal patches", "saveMealPatches" in backend and "FROM meals WHERE lodger_id=?" in backend),
        ("backend returns extra meal patches", "extraPatches" in backend and "meals: mealRows" in backend),
        ("contract expects meal patches", '"patches meal rows"' in contract and '"extraPatches"' in contract),
    ]
    failed = [name for name, ok in checks if not ok]
    if failed:
        print("FAIL meals optimistic:")
        for item in failed:
            print(" ", item)
        sys.exit(1)
    print("PASS: meals optimistic save and rollback wired")


if __name__ == "__main__":
    main()