---
title: AGENTS.md — 客堂管理系统 AI 开发基线
status: active
applies_to: ["cursor", "github-copilot", "kimi-cli"]
---

# Agent instructions（客堂管理系统）

> **每次会话先读 [AI_QUICKSTART.md](AI_QUICKSTART.md)**，再继续本文。
> 本文是跨工具（Cursor / GitHub Copilot / Kimi-cli）共同加载的权威基线。

## 项目特殊性（先理解再动手）

- **无服务器、免安装、免商店认证**：产品形态是「便携文件夹 + 浏览器」。
- **多文件原生架构**：`index.html`（入口壳）+ `styles.css` + `js/*.js`（普通 `<script src>` 加载，非 ES Module）+ `lib/sql-wasm.*`。
- **本地优先**：数据存在浏览器 IndexedDB，备份靠导出 `ketang.db`。
- **目标用户**：寺院客堂非 IT 人员，UI 必须大按钮、低学习成本。
- **验证方式**：Chrome Headless 渲染测试 + 手动跑完整业务路径。

## 通用代理基线（Karpathy 4 rules）

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

- 动手前明确假设；不确定就提问。
- 存在多种解释时，列出选项，不静默替用户做决定。
- 有简单方案时主动提出；必要时反驳过度设计。
- 新增功能前先调研业内成熟做法（寺院信息化 / 通用 PMS）；记录复用/适配/自研决策。
- 看不懂就停，指出困惑点，再问。

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- 不实现用户没要的功能。
- 不为一处使用制造抽象。
- 不添加未请求的「灵活性」或「配置项」。
- 不写不可能场景的错误处理。
- 200 行能写完就别写 500 行。

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

- 不改无关的相邻代码、注释、格式。
- 不改没坏的东西。
- 遵循现有代码风格。
- 自己改动产生的废弃变量/函数要清理；原有死代码只提不改。

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

- 每个任务要有可验证的完成标准。
- 持久化路径必须验证：写入 → 刷新/重开 → 读回。
- **未经实际验证，不得宣称「已完成」或「已修复」。**
- Commit / 结束会话前附验证证据（命令 + 结果摘要）。

## 客堂-specific 约束

### 架构纪律

- **保持多文件原生结构**：入口 `index.html` 只负责视图容器与按序加载脚本；样式在 `styles.css`，业务逻辑在 `js/` 各模块。
- **不引入运行时构建链**：发布产物不得依赖 Webpack/Vite/npm/Node；允许开发者使用 npm devDependencies 做 ESLint、Prettier、测试和 CI 检查，只要不改变用户运行方式。
- **不引入外部框架**：保持原生 HTML/CSS/JS，只有 `sql.js` 一个运行时依赖。
- **数据模型变更必须 migration**：通过 `schema_version` 表逐步升级（当前 v20）；`importDB()` 与正常启动须跑同一套迁移链，保证旧 `.db` 可恢复。

### 代码风格

- 中英双语注释：关键逻辑附简短英文说明，便于跨工具理解。
- 用户可见文案用中文，保持寺院场景语义（挂单、退房、用斋、房态）。
- 所有用户输入在 `innerHTML` 前必须经过 `escapeHtml()` 转义。
- 日期统一用 `YYYY-MM-DD` 字符串比较，不涉及时区计算。

### 工作流（Explore → Plan → Implement → Verify）

完整定义见 [copilot-instructions.md](copilot-instructions.md)。要点：

- **Explore**：只读 `index.html` / `README.md` / `使用说明.txt`，产出 ≤ 15 行「已读事实」。
- **Research**（新功能 / 新交互 / 新存储时）：调研寺院垂直产品或通用 PMS 的成熟做法。
- **Plan**：落位到具体函数/视图 + 验证方式；用户确认后再实施。
- **Implement**：逐步执行，每改一处先验证。
- **Verify**：必须包含 Chrome Headless 渲染 + 一条手动业务路径。

### 单人合并门槛（拍板）

任何改动结束前必须：

1. `python3 -m http.server 8080` 启动本地服务。
2. Chrome Headless 渲染无错误、关键元素存在。
3. 手动跑通一条业务路径（例如：挂单 → 续住 → 换床 → 用斋 → 退房 → 历史查询 → CSV 导出）。
4. 更新 `README.md` 和 `使用说明.txt`（如功能有变）。

## 不要做

- 不上架 App Store / 微软商店（与免认证约束冲突）。
- 不默认使用公有云 SaaS（与数据不出院冲突）。
- 不引入 Electron / Tauri 等需要签名的桌面安装包。
- 不堆全寺 ERP 功能；只做客堂住宿刀尖。

---

**Guidelines work if:** 改动更聚焦、更少返工、验证先于声称完成。
