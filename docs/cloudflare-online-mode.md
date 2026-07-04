# Cloudflare 在线多人模式

本文记录把客堂系统从「本地浏览器数据库」切到「Cloudflare Pages + Functions + D1」的最小配置。

## 架构

- 前端仍由 Cloudflare Pages 托管 `index.html`、`styles.css`、`js/`。
- HTTPS 线上访问会自动进入远程数据库模式。
- **读**：登录后 `GET /api/v1/read/:module` 按模块拉取 → `read-cache.js` 单一内存缓存（`_rcStore`）；在线主路径走 `rc*` / `read-shim`，**不再加载** `sql-wasm.js` / `sql-wasm.wasm`。
- **写后刷新**（对齐 ERPNext / Directus）：写 API 返回 `patches`（完整行）+ `deletions`（墓碑）+ `board_version`；全站统一 `rcRefreshAfterWrite()`：即时 patch `_rcStore`、刷新当前视图、后台 defer 对账（自己的写默认 skip delta）。
- **多端同步**：其他终端靠 `board_version` + `/api/v1/sync/delta` / SSE 拉变更；SSE 当前是服务端 1.5s 检测 `board_version` 后转推，轮询仍是可靠兜底。
- **公开预约**：`reserve.html` → `POST /api/public/reservations`（无需登录）。
- **写**：业务操作走 `/api/v1/*`，由 Worker 写入 D1。
- **登录/用户列表**：`POST /api/v1/auth/login`（角色/账号）；用户管理走 `/api/v1/admin/users`。
- **改密/审计**：`POST /api/v1/auth/change-password`；客户端 `logAudit` 走 `POST /api/v1/audit`（不再经 `/api/db` run）。
- 本地 `localhost`、`127.0.0.1`、`file://` 仍使用原 IndexedDB/sql.js 模式。

## Cloudflare 必填配置

1. 在 Cloudflare 创建 D1 数据库，例如 `ketang-db`。
2. 进入 Pages 项目 `ketang` 的设置。
3. 添加 D1 binding：
   - Variable name: `KETANG_DB`
   - D1 database: 选择刚创建的数据库
4. 添加环境变量：
   - Name: `KETANG_SESSION_SECRET`
   - Value: 使用随机长字符串，至少 32 字符。可在本机运行：
     ```bash
     openssl rand -hex 32
     ```
   - （可选）Name: `KETANG_BOOTSTRAP_SECRET` — 保护非空库重复 `init`
   - （可选）Name: `KETANG_PUBLIC_RESERVATIONS` — 设为 `false` 关闭公开预约 API
5. 重新部署 Pages。

首次访问线上站点时，后端会自动创建表结构和初始房间/床位。

## 登录

默认账号仍为：

- 管理员：`admin / admin`
- 知客师：`zhike / zhike`

上线后请立即登录管理员账号，在「系统设置 → 用户管理」修改默认密码。

## 首次上线安全清单

1. 立即修改 `admin` 和 `zhike` 默认密码。
2. 确认 `KETANG_SESSION_SECRET` 不是 `123456`、`secret` 等可猜字符串。
3. 只给实际测试人员创建账号，测试结束后停用临时账号。
4. 若发现异常操作，立刻更换 `KETANG_SESSION_SECRET` 并重新部署，所有旧登录会失效。

## 当前边界

- 云端模式支持多人访问同一份 D1 数据。
- 业务写操作走 `/api/v1/*` 接口（入住/退房/换床/续住/分床/编辑删除挂单/用斋/房务/预约/营期批量操作），D1 `batch()` 保证原子性。
- `/api/db`：**仅** init、users 列表（公开角色名）；`login` / `login_role` / SQL 网关 / `change_password` 已退役（410），请用 `/api/v1/auth/login` 与 `/api/v1/*` 业务 API。
- 管理员可在「系统设置」导出/导入 JSON 备份（含 `users` 表，`/api/v1/admin/data-backup`）。
- 房态看板在云端模式优先 **SSE**（`/api/v1/stream/board`），服务端 1.5s 检测版本变化、15s ping；失败或非看板场景降级到 `board-version` 轮询（active 视图 3s、idle 20s、hidden 跳过）。
- 登录前不再阻塞远程 `init`；身份下拉在 HTML 中静态列出，页面打开即可选。
- 已有数据的 D1 库登录走 `ensureDatabaseForAuth` 快速路径，跳过全量 schema 重放。
- 公开预约：`POST /api/public/reservations`（IP 限流；可用 `KETANG_PUBLIC_RESERVATIONS=false` 关闭）。
- `init` 在非空库时默认幂等；仅 `force: true` 且带 `x-ketang-bootstrap` 才允许强制 reseed。
- 登录与公开预约均有限流。
- 云端模式支持 CSV 批量导入入住（`POST /api/v1/batch-check-in`，单次最多 100 条，需 `lodging.checkin` 权限）。

## API 路由

| 路径                                  | 说明                                      |
| ------------------------------------- | ----------------------------------------- |
| `POST /api/db`                        | init、users 列表（login/SQL 网关已退役 410） |
| `POST /api/v1/auth/login`             | 双 token 登录（推荐）                     |
| `POST /api/v1/auth/change-password`   | 修改当前用户密码                          |
| `POST /api/v1/audit`                  | 客户端审计日志                            |
| `POST /api/v1/check-in`               | 入住登记                                  |
| `POST /api/v1/checkout`               | 退房                                      |
| `POST /api/v1/change-bed`             | 换床                                      |
| `POST /api/v1/extend-stay`            | 续住                                      |
| `POST /api/v1/assign-bed`             | 分床（含预约转入住）                      |
| `POST /api/v1/edit-lodger`            | 编辑在住挂单                              |
| `POST /api/v1/delete-lodger`          | 删除历史挂单                              |
| `POST /api/v1/save-meals`             | 保存用斋                                  |
| `POST /api/v1/set-house-status`       | 房务状态                                  |
| `POST /api/v1/upsert-reservation`     | 新增/编辑预约                             |
| `POST /api/v1/reservation-status`     | 更新预约状态                              |
| `POST /api/v1/batch-event-members`    | 营期批量取消/No-show                      |
| `POST /api/v1/batch-check-in`         | CSV 批量入住（最多 100 条）               |
| `GET /api/v1/read-model`              | 登录后全量读模型（冷启动/强制同步，ETag） |
| `GET /api/v1/read/:module`            | 按模块读（board/events/lodgers/…）        |
| `GET /api/v1/read/settings/:resource` | 信息管理子模块（rooms/beds/guests）       |
| `GET /api/v1/read/event/:id`          | 单营期排房读模型                          |
| `GET /api/v1/sync/delta?since=`       | 按域增量同步                              |
| `GET /api/v1/stream/board`            | 看板版本 SSE 推送                         |
| `GET /api/v1/board-version`           | 看板版本号                                |
| `GET /api/v1/session`                 | 校验当前登录会话                          |
| `GET/POST /api/v1/admin/users`        | 用户列表 / 增改停用 / 重置密码 / 启用     |
| `GET/POST /api/v1/admin/records`      | 房间床位营期等基础资料写操作              |
| `GET/POST /api/v1/admin/data-backup`  | JSON 导入导出                             |
| `POST /api/public/reservations`       | 公开预约                                  |

## 本地 wrangler

见根目录 `wrangler.toml`；部署前替换 D1 `database_id`，并设置 `KETANG_SESSION_SECRET`。

### 白名单发布（推荐）

不要直接 `wrangler pages deploy .`，应只发布运行必需文件：

```bash
bash scripts/build_pages_release.sh
npx wrangler pages deploy .release --project-name ketang
python3 scripts/post_deploy_check.py --base https://wulingkt.net
python3 test_prod_latency.py --base <Pages预览域名> --samples 3 \
  --check-baseline docs/ops/performance-baseline.json
bash scripts/run_p1_checklist.sh https://wulingkt.net <Pages预览域名>
```

主域名若启用 Cloudflare Access，自动化巡检加 `--allow-access-block`；测速请对 **Pages 预览域名** 执行（免 Access）。

最终多人/并发验收清单见 [docs/final-acceptance-checklist.md](final-acceptance-checklist.md)。

### 在线 sql.js 边界（Phase F 已完成）

线上主数据源是 D1 + `_rcStore`，在线模式**不加载** sql.js：

- [index.html](../index.html) 不再静态引用 `./lib/sql-wasm.js`；本地/灾备通过 `ensureLocalSqlite()` 动态加载。
- 在线误调 `query()` 会抛出带 caller 提示的错误，便于清尾巴。
- `?force_local_db=1` 或纯本地 IndexedDB 模式仍会加载 wasm，供 migration / 灾备恢复。

遗留 `query()` 仅存在于本地分支或 `_remoteHydrating` 过渡路径；新功能须走 `rc*`。

性能埋点见 [docs/ops/performance-baseline.json](ops/performance-baseline.json)（Phase G）。

发布前迁移/恢复校验：

```bash
python3 scripts/verify_migration_json.py data/ketang-cloud-import.json
python3 scripts/compare_backup_json.py baseline.json restored.json
```

## 从本地 ketang.db 导入已有数据

若寺院已在本地模式使用过客堂，可把 `ketang.db` 迁到云端 D1：

1. 在本机项目根目录执行（默认读取 `ketang.db`）：

   ```bash
   python3 scripts/export_ketang_db_to_json.py
   ```

   会生成 `data/ketang-cloud-import.json`（含房间/床位/挂单等，已映射到 schema v15）。

2. 确保 Pages 已部署最新代码且 D1 已绑定。

3. 用 **HTTPS** 打开线上站点，**管理员**登录 → **系统设置** → **从文件恢复数据**，选择上述 JSON 文件。

4. 确认覆盖提示后等待导入完成；成功后会显示房间/床位/在住人数摘要，房态看板应显示原有数据。

说明：

- JSON 含真实住客信息，已在 `.gitignore` 中忽略，请勿提交到 Git。
- 导出时会保留源库 `users` 表；若无 `users` 表则自动补上默认 `admin` / `zhike` 账号。
- 导入前会校验必需表、外键引用与在住占床冲突；写入按 80 条/批提交（D1 batch 单批原子），失败时请勿刷新并联系管理员重试。

## 回滚

如需临时回到本地模式：

- 使用本地启动脚本打开；或
- 在浏览器控制台设置 `window.KETANG_FORCE_LOCAL_DB = true` 后刷新（仅调试用）。
