# 数据链路排查结论（2026-07-02）

## 已修复

| 级别 | 问题                            | 修复                                                    |
| ---- | ------------------------------- | ------------------------------------------------------- |
| P0   | 写后默认 `renderAll` 全站重绘   | `VIEW_SYNC_SCOPES` + `refreshViewForScope`              |
| P1   | `changed_modules` 细粒度        | 写响应 + `writeResultToModules`                         |
| P2   | 模块内 DELETE+INSERT 主线程卡顿 | Phase 12.4：`updated_at` + delta `patch_mode` + UPSERT  |
| P3   | 写后 Network E2E                | `test_write_after_network.py`（`KETANG_NETWORK_E2E=1`，生产 2026-07-02 ✅） |
| P3   | 行级 delta 回归                 | `test_row_delta.py`                                     |
| P3   | 1000+ 挂单 patch P95 ≤2s      | `test_lodger_patch_benchmark.py`（本地 1050 行，p95≈2ms ✅） |
| P3   | 连续 20 次写无 read-model       | `KETANG_WRITE_LOOP=20` + network E2E（生产 2026-07-02 ✅） |

## 仍开放

| 级别 | 问题 | 计划 |
| ---- | ---- | ---- |
| —    | —    | —    |

## 验证

```bash
npm run lint:ci && npm run format:check
python3 test_headless.py
python3 test_scoped_refresh.py
python3 test_write_sync_contract.py
python3 test_row_delta.py
python3 test_lodger_patch_benchmark.py
KETANG_NETWORK_E2E=1 python3 test_write_after_network.py
KETANG_NETWORK_E2E=1 KETANG_WRITE_LOOP=20 python3 test_write_after_network.py
KETANG_NETWORK_BENCH=1 python3 test_lodger_patch_benchmark.py  # 生产挂单≥1050 时额外探测
```
