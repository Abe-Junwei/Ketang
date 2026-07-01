---
title: AI_QUICKSTART — 客堂住宿系统跨工具上手指引
status: active
applies_to: ["cursor", "github-copilot", "kimi-cli"]
---

# AI_QUICKSTART — 客堂住宿系统

> 新会话第一份必读。≤ 150 行，signal-dense。

## 1. 5 个 must-know

1. **[AGENTS.md](AGENTS.md)** — 跨工具权威基线（Karpathy 4 rules + 客堂-specific 约束）。
2. **[copilot-instructions.md](copilot-instructions.md)** — 详细工作流与禁止模式。
3. **核心文件**：`index.html`（入口壳）+ `styles.css`（样式）+ `js/*.js`（功能模块）。数据逻辑集中在 `js/db.js`。
4. **数据**：浏览器 IndexedDB 持久化，备份靠导出 `ketang.db`。
5. **验证**：Chrome Headless + 手动业务路径。

## 2. 项目结构

```
客堂住宿系统/
├── index.html              # 入口页面（按顺序加载 css/js）
├── styles.css              # 全局样式
├── js/                     # 原生 JS 模块（普通 <script src>，非 ES Module）
│   ├── utils.js            # 工具函数
│   ├── db.js               # SQLite + IndexedDB + schema/migration；HTTPS 时远程 D1
│   ├── api-client.js       # 云端 /api/v1 业务 API 客户端
│   ├── app.js              # 路由与首页渲染
│   ├── checkin.js          # 挂单登记
│   ├── lodger-actions.js   # 续住/换床/编辑/退房/凭证打印
│   ├── reservations.js     # 预约管理
│   ├── housekeeping.js     # 房务清洁
│   ├── meals.js            # 用斋
│   ├── events.js           # 营期管理、排房建议
│   ├── forecast.js         # 每日预报、周流动预测
│   ├── auth.js             # 登录/权限/用户管理
│   ├── info.js             # 基础设置页
│   ├── reports.js          # 报表
│   ├── history.js          # 历史查询
│   ├── guests.js           # 住客主档案
│   ├── audit.js            # 审计日志
│   └── validation.js       # 表单校验
├── lib/
│   ├── sql-wasm.js
│   └── sql-wasm.wasm
├── 启动客堂系统.bat        # Windows
├── 启动客堂系统.command    # macOS
├── 客堂住宿系统.app        # macOS 不弹 Terminal
├── 使用说明.txt            # 给客堂人员
├── README.md               # 技术说明
├── AGENTS.md               # 本文件
├── AI_QUICKSTART.md        # 快速指引
├── test_cdp.py             # HTTP 模式渲染测试
├── test_cdp_migration.py   # V3→V10 迁移回归测试
├── test_headless.py        # HTTP 模式 headless 冒烟测试
└── test_file_protocol.py   # file:// 本地打开测试
```

## 3. 工作流速记

```
Explore   只读 index.html / README.md / 使用说明.txt
   ↓
Research  新功能时调研寺院信息化 / 通用 PMS 成熟做法
   ↓
Plan      落位函数/视图 + 验证方式，等用户确认
   ↓
Implement 逐步改，逐步验证
   ↓
Verify    Chrome Headless + 手动跑通业务路径
```

## 4. 本地验证命令

```bash
# 1. 进入项目目录
cd /Users/junwei/开发/Ketang

# 2. 启动本地服务
python3 -m http.server 8080

# 3. 浏览器访问
# http://127.0.0.1:8080

# 4. 自动化验证
python3 test_cdp.py              # HTTP 模式：渲染所有视图并检查 console 错误
python3 test_cdp_migration.py    # V3 备份迁移至最新结构
python3 test_headless.py         # HTTP 模式 headless 初始化冒烟
python3 test_api_structure.py    # 云端 API 文件结构检查
python3 test_file_protocol.py    # file:// 模式：验证本地双击打开可正常初始化
npm run lint:ci                  # 开发期 JS/Functions ESLint 检查；不进入发布产物
```

## 5. 手动业务路径（每次改动后至少跑一条）

- 挂单登记 → 房态更新 → 用斋设置 → 续住 → 换床 → 退房 → 历史查询 → CSV 导出 → 备份恢复

## 6. 不要做

- 不引入会影响发布产物的 npm 运行依赖、Webpack、Vite、React、Vue；允许开发者使用 npm devDependencies 做 lint/test/format/CI。
- 不上架商店、不使用 Electron / Tauri。
- 不默认上云。
- 现在 `index.html` 已拆分，修改前先确认相关函数在 `js/` 的哪个文件里；新增模块同样以普通 `<script src>` 接入。

---

**维护规则**：硬上限 150 行；新增内容必须挤掉旧内容。
