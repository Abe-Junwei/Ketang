# 数据链路排查结论（2026-07-02）

## 已修复

| 级别 | 问题                                     | 修复                                                         |
| ---- | ---------------------------------------- | ------------------------------------------------------------ |
| P0   | 写后默认 `renderAll` 全站重绘            | `VIEW_SYNC_SCOPES` + `refreshViewForScope`                   |
| P0   | 轮询/SSE `syncRemoteIfStale` → renderAll | 改为 active view scoped refresh                              |
| P0   | info 页每次保存拉 settings 全模块        | `infoOnly` + `INFO_TAB_MODULES`                              |
| P0   | 缓存未就绪 `[0].c` 抛错                  | reports/housekeeping/lodger-actions/rooming-capacity 加 `?.` |
| P1   | `lodging` 域过度拉取                     | `lodgingModuleForView` + `changed_modules` 服务端            |
| P2   | 服务端 `changed_modules` 细粒度          | `sync-modules.js` + 各写 API + `writeResultToModules`        |
| P3   | 写后同步契约回归                         | `test_write_sync_contract.py`                                |
| P3   | lodgers 搜索未防抖                       | `handleLodgerSearchDebounced` 200ms                          |
| P3   | scoped refresh 回归                      | `test_scoped_refresh.py`                                     |

## 仍开放（已知技术债）

| 级别 | 问题                            | 计划                       |
| ---- | ------------------------------- | -------------------------- |
| P2   | 模块内 DELETE+INSERT 主线程卡顿 | Phase 12.4 行级 delta      |
| P3   | 写后 Network 请求数远程 E2E     | CDP + 生产登录录制（待补） |

## 验证

```bash
npm run lint:ci && npm run format:check
python3 test_headless.py
python3 test_scoped_refresh.py
python3 test_write_sync_contract.py
python3 scripts/audit_refresh_calls.py
python3 test_api_structure.py
```

写后 Network 预期（远程模式）：

- 常规单字段保存：0× read-model，1× module（`changed_modules` 指定）
- 看板入住/续住/换床/退房：`changed_modules: ["board"]`
- 信息管理保存房间：`changed_modules: ["settings_rooms"]`
