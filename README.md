# 客堂住宿系统（本地优先 MVP）

> 面向寺院客堂的单机住宿/挂单管理工具。无需服务器、无需安装、无需 Apple/Windows 开发者认证。

## 一、产品定位

- **不采购**：自研，代码可控。
- **无服务器**：数据存在本机浏览器内，通过 `sql.js` 在浏览器中运行 SQLite。
- **免安装**：Windows 上双击 `启动客堂系统.bat` 即可用 Chrome/Edge 打开。
- **参考成熟产品**：功能对标寺院垂直产品（慧云台挂单住宿模块、通用 PMS 房态看板），但只保留客堂最核心的「房态 + 挂单 + 备份」。

## 二、目录结构

```
客堂住宿系统/
├── 启动客堂系统.bat          # Windows 启动脚本
├── 启动客堂系统.command      # macOS 启动脚本（会弹 Terminal）
├── 客堂住宿系统.app          # macOS 双击启动（不弹 Terminal）
├── 使用说明.txt              # 给客堂法师/义工看的操作说明
├── index.html                # 入口页面：视图容器 + 按顺序加载脚本
├── styles.css                # 全局样式（设计令牌、组件、打印）
├── AGENTS.md                 # AI 代理跨工具基线（必读）
├── AI_QUICKSTART.md          # AI 快速上手指引
├── copilot-instructions.md   # 项目级开发约束
├── lib/
│   ├── sql-wasm.js           # sql.js 主文件
│   └── sql-wasm.wasm         # SQLite WebAssembly 引擎
├── js/                       # 原生 JS 功能模块（普通 <script src> 加载）
│   ├── utils.js              # 工具函数（转义、toast、日期、CSV、文件名消毒、密码哈希）
│   ├── db.js                 # SQLite 初始化、IndexedDB、schema 与迁移
│   ├── guests.js             # 住客主档案
│   ├── audit.js              # 操作审计日志
│   ├── validation.js         # 表单校验
│   ├── meals.js              # 用斋记录
│   ├── checkin.js            # 挂单登记、批量 CSV 导入、营期下拉框
│   ├── lodger-actions.js     # 续住、换床、编辑、退房、凭证打印
│   ├── reservations.js       # 预约管理
│   ├── events.js             # 营期管理、批量取消/No-show、排房建议、营期报表
│   ├── forecast.js           # 每日预报、周流动预测、图表
│   ├── auth.js               # 登录/权限/用户管理
│   ├── housekeeping.js       # 房务清洁流转
│   ├── reports.js            # 报表中心（用斋/日报/月报/营期统计）
│   ├── history.js            # 历史查询与 CSV 导出
│   ├── info.js               # 基础设置页（房间/床位/住客/挂单/营期）
│   └── app.js                # 应用入口：路由、首页渲染编排
├── test_cdp.py               # HTTP 模式 CDP 渲染测试
├── test_cdp_migration.py     # V3→V10 迁移回归测试
├── test_file_protocol.py     # file:// 本地打开初始化测试
├── test_headless.py          # HTTP 模式 headless 初始化冒烟测试
└── （可选）backup/           # 建议手动自建，存放导出的 ketang.db
```

> **部署注意**：`js/` 与 `styles.css` 必须与 `index.html` 放在同一文件夹内整体复制，不能只复制单个 HTML 文件。所有 JS 通过普通 `<script src>` 按顺序加载，不使用 ES Module，保证双击启动脚本 / U 盘 / `file://` 下可直接运行。

> **给 AI 开发者**：每次会话请先读 [AI_QUICKSTART.md](AI_QUICKSTART.md)，再读 [AGENTS.md](AGENTS.md)。详细工作流与约束见 [copilot-instructions.md](copilot-instructions.md)。

## 三、技术栈

| 层级 | 选型 | 说明 |
|------|------|------|
| 前端 | 原生 HTML + CSS + JS | 无构建步骤，直接打开即用 |
| 本地数据库 | SQLite（sql.js） | 浏览器内运行，导出即文件 |
| 持久化 | IndexedDB | 保存 SQLite 二进制，关闭浏览器不丢失 |
| 备份 | 文件导出/导入 | 生成标准 `.db` 文件，可复制到 U 盘 |

## 四、核心数据模型

参考寺院垂直产品（慧云台等）与通用 PMS，抽象为以下主表：

### rooms（客房）
- `id`：房间编号
- `name`：房间名，如 101、202
- `location`：位置，如 东楼、西院
- `floor`：楼层
- `dorm_type`：男寮 / 女寮 / 不限
- `notes`：备注

### beds（床位）
- `id`：床位编号
- `room_id`：所属房间
- `bed_number`：床位号，如 1号床、2号床
- `status`：可用 / 占用 / 维修
- `notes`：备注

### guests（住客主档案）
- `name`、`dharma_name`：登记姓名（界面统一为「姓名 / 法名」单字段；新登记写入 `name`，旧数据两列仍可读）
- `gender`、`phone`、`id_card`：基础信息
- `emergency_contact`、`emergency_phone`：紧急联系人
- `blacklist`：风险标记
- `visit_count`、`last_visit_date`：累计到访次数与最近到访日
- `notes`：备注

### lodgers（挂单/住客）
- `guest_id`：关联住客主档案
- `event_id`：关联营期（禅营/法会/修道班）
- `name`、`dharma_name`、`gender`、`phone`、`id_card`：登记时快照（界面单字段「姓名 / 法名」；与 `guests` 主档案可能不同，用于保留历史记录）
- `check_in_date`、`expected_check_out`、`actual_check_out`：入住与离院
- `bed_id`：关联床位（通过床位可得到房间）
- `role`：身份（法师/居士/义工等）
- `class_name`：班级/分组（如一班、师父组）
- `status`：在住 / 已退 / 已取消 / No-show
- `source`：入住来源（现场/电话/微信/法会预约）
- `notes`：备注

### meals（用斋记录）
- `id`：记录编号
- `lodger_id`：关联住客
- `date`：日期
- `breakfast` / `lunch` / `dinner`：早 / 午 / 晚斋，0=不用，1=用
- `notes`：备注

### payments（收款/退款）
- `lodger_id`：关联挂单
- `type`：押金 / 房费 / 退款
- `amount`：金额
- `method`：现金 / 微信 / 支付宝 / 刷卡 / 挂账 / 免费
- `remark`：备注/收据号
- `paid_at`：收款时间

### events（营期/法会）
- `name`：营期名称
- `event_type`：禅营 / 法会 / 修道班等
- `gender_type`：男 / 女 / 混合
- `expected_count`：预计人数
- `start_date`、`end_date`：起止日期
- `status`：筹备中 / 进行中 / 已结束 / 已取消
- `notes`：备注

### users（系统账号）
- `username`：登录账号
- `display_name`：显示名
- `role`：admin（管理员）/ zhike（知客师）
- `password`：SHA-256 加盐哈希存储

### reservations（预约）
- `guest_id`：关联住客主档案
- `event_id`：关联营期
- `name`、`dharma_name`、`gender`、`phone`、`id_card`：预约人信息（登记时快照）
- `expected_check_in`、`expected_check_out`：预计入住/离院
- `room_preference`：房间偏好
- `class_name`：班级/分组
- `source`：来源
- `status`：预约 / 已确认 / 已入住 / 已取消 / No-show

### housekeeping（房务清洁流转）
- `bed_id`：关联床位
- `status`：脏房 / 净房 / 查房 / 可用 / 维修
- `operator`：操作人
- `changed_at`：变更时间
- `notes`：备注

### audit_logs（操作日志）
- `action`：操作类型
- `target_type`、`target_id`：操作对象
- `detail`：详情（JSON）
- `created_at`：时间

## 五、功能清单

### 已有（MVP + Phase 1/2/3 已实现）
- [x] 图形化房态看板（KPI / 运营提醒 / 在住挂单）
- [x] 本地多账号登录与权限（管理员 / 知客师）
- [x] 用户管理（仅管理员）
- [x] 住宿管理独立页（房态网格、床位展开、快捷入住）
- [x] **床位级管理**：每间房显示每张床及当前住客
- [x] 点击房间快速办理入住（自动分配第一张可用床位）
- [x] **住宿办理**：同一页面分「现场入住 / 提前预约」两 Tab；预约可转入住并预填表单
- [x] 挂单登记（姓名/法名/性别/手机号/身份证/入住日期/预离日期/来源/团体批次/紧急联系人/备注）
- [x] 挂单时设置用斋默认（早/午/晚）
- [x] 性别与房间类型校验（男房、女房、不限）
- [x] 在住列表与一键退房
- [x] **编辑挂单**：修改姓名/法名/性别/身份/手机/身份证/日期/备注
- [x] **删除挂单**：彻底清除误登记记录
- [x] **续住**：延长预离日期，无需退房重登
- [x] **换床**：在住期间更换床位
- [x] **用斋管理**：按人按日勾选早/午/晚斋
- [x] **今日用斋统计**：客堂大盘与报表含在住用斋 + 当日待入住预约（入住后自动转入挂单用斋，不重复计数）
- [x] **历史挂单查询**：按日期、姓名、床位筛选
- [x] **今日/明日/超期预离提醒**：首页直接提醒
- [x] **CSV 台账导出**：含床位、用斋天数、押金/房费/退款
- [x] **数据安全**：用户输入 HTML 转义、手机号/身份证校验、重复登记检测、saveDB 失败提示、每日备份提醒
- [x] 数据库导出为 `ketang.db`
- [x] 从 `ketang.db` 恢复数据（自动迁移到最新结构）
- [x] 使用统计看板
- [x] **住客主档案（guests）**：自动去重、累计到访次数
- [x] **收款/退款（payments）**：押金、房费、退款记录
- [x] **预约（reservations）**：在「住宿办理 → 提前预约」登记；支持确认/转入住/取消/No-show；用斋需求计入预计入住当日厨房统计
- [x] **房务清洁（housekeeping）**：脏房→净房→查房→可用 流转
- [x] **操作日志（audit_logs）**：入住/退房/换床/续住/删除等关键操作留痕
- [x] **报表中心**：厨房用斋汇总、日报、月报
- [x] **法会/批次 CSV 批量导入**
- [x] **挂单凭证打印**
- [x] **信息管理**：房间 / 床位 / 住客档案 / 挂单记录 增删改查

### 可后续扩展
- [ ] 多设备同房态（同一 WiFi 下电脑临时当主机）
- [ ] PWA「添加到主屏幕」

## 六、使用方式

### Windows（单台旧电脑）
1. 把整个文件夹复制到电脑桌面或 U 盘（不能只复制单个文件）。
2. 双击 `启动客堂系统.bat`。
3. 脚本会自动用 Chrome/Edge 以 `file://` 方式打开，并已附加 `--allow-file-access-from-files`，确保本地 `sql-wasm.wasm` 可被加载。
4. 在浏览器中操作。左侧「信息管理」可对房间、床位、住客档案、挂单记录做增删改查。

### macOS（开发/测试）
- **不弹 Terminal**：双击 `客堂住宿系统.app`（内部调用 `.command` 脚本）。
- **可接受弹 Terminal**：双击 `启动客堂系统.command`。
- **命令行**：`python3 -m http.server 8080`，然后浏览器访问 `http://127.0.0.1:8080`。

> 如果直接双击 `index.html` 或在未加 `--allow-file-access-from-files` 的浏览器中打开，
> `sql.js` 可能无法加载本地 `sql-wasm.wasm`，导致页面白屏。请始终使用提供的启动脚本。

### 开发调试
- 推荐：`python3 -m http.server 8080` 后访问 `http://127.0.0.1:8080`。
- 也可以直接双击启动脚本；本地 `file://` 模式已验证可正常初始化。

### 自动化验证
项目根目录提供两个 Python 脚本，用于在修改后快速回归：

```bash
# 1. HTTP 模式下渲染所有视图并检查 console 错误
python3 test_cdp.py

# 2. file:// 本地打开模式初始化验证（使用与启动脚本一致的 Chrome 参数）
python3 test_file_protocol.py

# 3. V3 备份导入迁移至 V10
python3 test_cdp_migration.py

# 4. HTTP headless 初始化冒烟
python3 test_headless.py
```

## 七、备份与迁移

- 日常：进入「系统设置」页面 → 导出 `ketang.db` → 复制到 U 盘。
- 换电脑：在新电脑上打开本系统 → 「从文件恢复数据」→ 选择 `ketang.db`。
- 灾难恢复：只要 `ketang.db` 在手，数据即可完全恢复。

## 八、设计取舍

| 成熟产品做法 | 本方案做法 | 原因 |
|--------------|------------|------|
| 服务器 + MySQL | 浏览器 + sql.js + IndexedDB | 无服务器、零安装 |
| 桌面安装包（Electron/Tauri） | 纯网页 + 启动脚本 | 免 Apple/Windows 签名认证 |
| 公有云 SaaS | 本地数据 | 挂单隐私、无外网依赖 |
| 全寺 ERP（20+ 模块） | 只做客堂住宿刀尖功能 | 小庙落地、学习成本低 |

## 九、参考产品

- **慧云台**：挂单住宿模块、图形房态、本地部署思路。
- **竑炫 / 菩佑**：寺院信息化模块划分参考。
- **通用 PMS（楚笛、迎客等）**：房态可视化、入住/退房流程。
- **Staymonk**：朝圣接待/性别分房/法会批量登记的海外参考。
