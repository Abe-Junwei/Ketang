# 数据链路矩阵（Phase 12 对齐业内 Best Practice）

> 基线：`docs/architecture/sync-read-model-v2.md`  
> 更新：2026-07-02  
> 写后刷新策略：**按当前视图 scoped refresh**（`VIEW_SYNC_SCOPES`），全站 `renderAll` 仅用于登录/强制同步/批量导入。

## 图例

| 符号 | 含义                            |
| ---- | ------------------------------- |
| ✅   | 已对齐 best practice            |
| ⚠️   | 已知技术债（文档化）            |
| 🔄   | 依赖 active view 自动推断 scope |

## P0 — 高频写路径

| 操作                | UI                | 写 API              | changed_domains              | 同步模块           | 写后渲染                      | 状态        |
| ------------------- | ----------------- | ------------------- | ---------------------------- | ------------------ | ----------------------------- | ----------- |
| 保存房间/床位/住客  | info.js           | admin/records       | settings                     | settings_* 子模块  | renderInfo(tab)               | ✅ infoOnly |
| 保存挂单记录        | info.js           | admin/records       | lodging                      | lodgers_records    | renderInfo(lodgers)           | ✅          |
| 删除挂单            | info.js           | delete-lodger       | lodging                      | lodgers_records    | renderInfo(lodgers)           | ✅          |
| 分配床位            | checkin.js        | assign-bed          | lodging, board               | active view module | 🔄 stay/board                 | ✅          |
| 挂单入住            | checkin.js        | check-in            | lodging, board               | active view module | 🔄 board（跳转后）            | ✅          |
| 批量导入            | checkin.js        | batch-check-in      | lodging                      | 全量               | fullRefresh                   | ✅ 刻意     |
| 续住/换床/编辑/退房 | lodger-actions.js | lodgers API         | lodging, board, housekeeping | active view module | 🔄 board/lodgers              | ✅          |
| 房态变更            | housekeeping.js   | set-house-status    | board, housekeeping          | board              | 🔄 housekeeping               | ✅          |
| 营期 CRUD           | events.js         | admin/records       | events                       | events / infoOnly  | renderInfo(events)            | ✅          |
| 批量取消/No-show    | events.js         | batch-event-members | lodging, events              | 域级               | infoOnly + renderEventMembers | ✅          |

## P1 — 中频写

| 操作        | UI                     | changed_domains | 写后渲染          | 状态              |
| ----------- | ---------------------- | --------------- | ----------------- | ----------------- |
| 预约 upsert | reservations.js        | reservations    | 🔄 stay           | ✅                |
| 预约状态    | reservations.js        | reservations    | 🔄 stay           | ✅                |
| 用斋保存    | meals.js               | meals           | 🔄 board（modal） | ✅                |
| 排房发布    | rooming-publish.js     | events, lodging | 🔄 active view    | ✅                |
| 排房调整    | rooming-adjustments.js | events          | 🔄 active view    | ✅                |
| 运营配置    | housekeeping.js        | board           | backup panel      | ✅ patch app_meta |

## P2 — 只读 / 低频

| 视图         | 数据来源          | 后台轮询                   | 状态          |
| ------------ | ----------------- | -------------------------- | ------------- |
| reports      | sql.js 本地 query | syncRemoteIfStale → scoped | ✅            |
| forecast     | sql.js            | scoped refresh             | ✅ query 守卫 |
| history      | lodgers_records   | scoped refresh             | ✅            |
| lodging 图表 | board 模块        | scoped refresh             | ✅            |

## 基础设施

| 组件       | Best practice       | 客堂实现                 | 状态          |
| ---------- | ------------------- | ------------------------ | ------------- |
| 写响应     | version + domains   | finishWrite              | ✅            |
| 冷启动     | 全量 read-model     | syncRemoteReadModel      | ✅ 刻意       |
| 写后同步   | 最小 module         | resolveScopeModuleKey    | ✅            |
| 写后 UI    | 当前 view only      | refreshViewForScope      | ✅ Phase 2    |
| 轮询/SSE   | 增量 + 不 renderAll | syncRemoteIfStale scoped | ✅ Phase 2    |
| 304/ETag   | module 级           | apiReadModule            | ✅            |
| 域级灌库   | 行级 delta          | DELETE+INSERT            | ⚠️ Phase 12.4 |
| lodging 域 | 子模块拆分          | lodgingModuleForView     | ✅ Phase 3    |

## 刻意豁免（不要求对齐 SaaS）

- 便携文件夹 + sql.js 缓存 + D1 权威
- 无运行时构建链
- 登录/强制同步/批量导入仍用 `renderAll` / `fullRefresh`
- 域级全表替换（至 12.4 migration）
