# Cloudflare 在线多人模式

本文记录把客堂系统从「本地浏览器数据库」切到「Cloudflare Pages + Functions + D1」的最小配置。

## 架构

- 前端仍由 Cloudflare Pages 托管 `index.html`、`styles.css`、`js/`。
- HTTPS 线上访问会自动进入远程数据库模式。
- 远程读写通过 `functions/api/db.js` 访问 Cloudflare D1。
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
- `/api/db` 网关：知客师仅允许 `SELECT`/`PRAGMA` 与 `INSERT audit_logs`；管理员可管理用户与房间设置。
- 管理员可在「系统设置」导出/导入 JSON 备份（含 `users` 表，`/api/v1/admin/data-backup`）。
- 房态看板在云端模式每 8 秒轮询 `board-version` 自动刷新。
- 公开预约：`POST /api/public/reservations`（IP 限流；可用 `KETANG_PUBLIC_RESERVATIONS=false` 关闭）。
- `init` 在非空库时默认幂等；仅 `force: true` 且带 `x-ketang-bootstrap` 才允许强制 reseed。
- 登录与公开预约均有限流；默认密码登录后会强制改密（本地与云端）。
- 云端模式暂不支持 CSV 批量导入入住。

## API 路由

| 路径 | 说明 |
|------|------|
| `POST /api/db` | 登录、query/run/batch_query、改密 |
| `POST /api/v1/check-in` | 入住登记 |
| `POST /api/v1/checkout` | 退房 |
| `POST /api/v1/change-bed` | 换床 |
| `POST /api/v1/extend-stay` | 续住 |
| `POST /api/v1/assign-bed` | 分床（含预约转入住） |
| `POST /api/v1/edit-lodger` | 编辑在住挂单 |
| `POST /api/v1/delete-lodger` | 删除历史挂单 |
| `POST /api/v1/save-meals` | 保存用斋 |
| `POST /api/v1/set-house-status` | 房务状态 |
| `POST /api/v1/upsert-reservation` | 新增/编辑预约 |
| `POST /api/v1/reservation-status` | 更新预约状态 |
| `POST /api/v1/batch-event-members` | 营期批量取消/No-show |
| `GET /api/v1/board-version` | 看板版本号 |
| `GET /api/v1/session` | 校验当前登录会话 |
| `GET/POST /api/v1/admin/users` | 用户列表 / 增改停用 / 重置密码 / 启用 |
| `GET/POST /api/v1/admin/records` | 房间床位营期等基础资料写操作 |
| `GET/POST /api/v1/admin/data-backup` | JSON 导入导出 |
| `POST /api/public/reservations` | 公开预约 |

## 本地 wrangler

见根目录 `wrangler.toml`；部署前替换 D1 `database_id`，并设置 `KETANG_SESSION_SECRET`。

## 从本地 ketang.db 导入已有数据

若寺院已在本地模式使用过客堂，可把 `ketang.db` 迁到云端 D1：

1. 在本机项目根目录执行（默认读取 `ketang.db`）：

   ```bash
   python3 scripts/export_ketang_db_to_json.py
   ```

   会生成 `data/ketang-cloud-import.json`（含房间/床位/挂单等，已映射到 schema v13）。

2. 确保 Pages 已部署最新代码且 D1 已绑定。

3. 用 **HTTPS** 打开线上站点，**管理员**登录 → **系统设置** → **从文件恢复数据**，选择上述 JSON 文件。

4. 确认覆盖提示后等待导入完成；刷新后房态看板应显示原有房间与在住挂单。

说明：

- JSON 含真实住客信息，已在 `.gitignore` 中忽略，请勿提交到 Git。
- 旧库若无 `users` 表，导出时会自动补上默认 `admin` / `zhike` 账号。
- 大量数据导入已按 80 条/批写入 D1，避免 batch 超限。

## 回滚

如需临时回到本地模式：

- 使用本地启动脚本打开；或
- 在浏览器控制台设置 `window.KETANG_FORCE_LOCAL_DB = true` 后刷新（仅调试用）。
