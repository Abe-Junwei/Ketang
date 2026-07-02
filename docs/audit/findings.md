# 数据链路排查结论（2026-07-02）

## 已修复

| 级别 | 问题                                     | 修复                                                         |
| ---- | ---------------------------------------- | ------------------------------------------------------------ |
| P0   | 写后默认 `renderAll` 全站重绘            | `VIEW_SYNC_SCOPES` + `refreshViewForScope`                   |
| P0   | 轮询/SSE `syncRemoteIfStale` → renderAll | 改为 active view scoped refresh                              |
| P0   | info 页每次保存拉 settings 全模块        | `infoOnly` + `INFO_TAB_MODULES`                              |
| P0   | 缓存未就绪 `[0].c` 抛错                  | reports/housekeeping/lodger-actions/rooming-capacity 加 `?.` |
| P0   | 灌库未设 `_remoteHydrating`              | applyModuleTables 包装                                       |
| P1   | 批量导入应全量刷新                       | `fullRefresh: true`                                          |
| P1   | `lodging` 域过度拉取                     | `lodgingModuleForView` + board/lodgers_records 分流          |
| P1   | stay 写后双模块                          | `VIEW_SYNC_SCOPES.stay.module = board`                       |
| P3   | lodgers 搜索未防抖                       | `handleLodgerSearchDebounced` 200ms                          |
| P3   | 无 scoped refresh 回归                   | `test_scoped_refresh.py`                                     |

## 仍开放（已知技术债）

| 级别 | 问题                            | 计划                     |
| ---- | ------------------------------- | ------------------------ |
| P2   | 模块内 DELETE+INSERT 主线程卡顿 | Phase 12.4 行级 delta    |
| P2   | 服务端 `changed_modules` 细粒度 | 评估 write-response 扩展 |
| P3   | 写后 Network 请求数 E2E         | CDP + 远程 mock（待补）  |

## 验证

```bash
npm run lint:ci && npm run format:check
python3 test_headless.py
python3 test_scoped_refresh.py
python3 scripts/audit_refresh_calls.py
python3 test_api_structure.py
```

写后 Network 预期（远程模式）：

- 常规单字段保存：0× read-model，≤2× module/delta
- 看板/在住操作：优先 `board` 或 `lodgers_records`，非全量 `lodgers`
- 批量导入：允许 fullRefresh / 多 module
