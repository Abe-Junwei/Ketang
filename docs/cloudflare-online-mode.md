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
- 云端模式暂不支持浏览器内直接导出/导入 `ketang.db`。
- 现阶段为兼容旧页面，同步 SQL 调用会经由 `/api/db` 转发；后续应逐步改成专用业务 API。
- 远程 SQL 网关已限制为登录后执行单条 `SELECT/PRAGMA/INSERT/UPDATE/DELETE`；普通知客师不能直接读写 `users` 表。
- 数据库已增加「同一床位只能有一条在住记录」的唯一约束，降低并发重复分床风险。

## 回滚

如需临时回到本地模式：

- 使用本地启动脚本打开；或
- 在浏览器控制台设置 `window.KETANG_FORCE_LOCAL_DB = true` 后刷新（仅调试用）。
