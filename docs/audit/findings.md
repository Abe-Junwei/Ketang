# 数据链路排查结论（2026-07-02）

## 已修复

| 级别 | 问题                                  | 修复                                                       |
| ---- | ------------------------------------- | ---------------------------------------------------------- |
| P0   | 写后默认 `renderAll` 全站重绘         | `VIEW_SYNC_SCOPES` + `refreshViewForScope`                 |
| P1   | `changed_modules` 细粒度              | 写响应 + `writeResultToModules`                            |
| P2   | 模块内 DELETE+INSERT 主线程卡顿       | Phase 12.4：`updated_at` + delta `patch_mode` + UPSERT     |
| P2   | INSERT 无 `updated_at` / 时间格式混用 | **v22**：INSERT trigger + `sync-timestamp.js` 统一格式     |
| P2   | `app_meta` 撑爆 patch 行数上限        | `app_meta` 不计入 `ROW_PATCH_MAX_ROWS`                     |
| P3   | scoped 写后 UI 不刷新                 | `syncAfterRemoteWrite` scoped 分支补 `refreshViewForScope` |
| P3   | 写后 Network E2E                      | `test_write_after_network.py`（含 `KETANG_WRITE_LOOP=20`） |
| P3   | 1000+ 挂单 patch P95                  | `test_lodger_patch_benchmark.py`（本地 1050 行）           |
| P3   | 域 fallback 过粗                      | `lodging → lodgers_records`                                |
| P3   | `applyRemoteDelta` 静默失败           | `console.warn` + 返回 `false`                              |

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
KETANG_NETWORK_E2E=1 KETANG_NETWORK_E2E_BG=1 python3 test_write_after_network.py
```
