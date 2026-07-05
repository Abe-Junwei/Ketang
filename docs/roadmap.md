# 客堂管理系统完整开发路线图

本文是当前项目的开发主线。目标是把系统从「本地客堂工具」稳定推进为「Cloudflare 在线多人正式版」，同时保留本地灾备能力，并为夏季大型活动排房打好数据和流程基础。

## 1. 路线图原则

- 先稳定在线多人核心，再做公开预约和大型活动排房。
- 先把数据权威源迁到 D1，再谈自动备份和 AI 辅助。
- 手机端先支持日常核心操作，不把复杂活动排房第一版压到手机优先。
- 每阶段必须有可验收结果，不以“代码写完”作为完成标准。
- 本地模式只作为开发、演示、灾备和离线恢复，不再作为正式多人协同入口。
- 继续保持原生 HTML/CSS/JS 架构，不引入构建链或前端框架。

## 2. 阶段总览

| 阶段     | 名称                             | 目标                                                                       | 依赖          | 状态                                                                   |
| -------- | -------------------------------- | -------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------- |
| Phase 0  | 冻结在线架构                     | 把当前未提交在线增强变成稳定基线                                           | 已有代码      | 已完成                                                                 |
| Phase 1  | 生产环境配置                     | 让正式域名使用 D1 权威数据                                                 | Phase 0       | 已完成                                                                 |
| Phase 2  | 线上多人验收                     | 验证多人共享、并发与主流程                                                 | Phase 1       | 清单就绪                                                               |
| Phase 3  | 账号与安全收口                   | 默认密码、权限、审计、入口安全                                             | Phase 1       | 已完成                                                                 |
| Phase 4  | 公开预约入口                     | 外部提交预约，内部审核处理                                                 | Phase 9       | 后置                                                                   |
| Phase 5  | 本地数据迁移                     | 旧 `ketang.db` 迁移到 D1                                                   | Phase 1/3     | 已完成                                                                 |
| Phase 6  | 备份与恢复                       | 手动备份可用，后续接 R2 定时备份                                           | Phase 5       | 基本完成                                                               |
| Phase 7  | 基础业务补强                     | 校验、报表、房务、用斋、打印等打磨                                         | Phase 2/5     | 部分完成                                                               |
| Phase 8  | 移动端适配                       | 手机浏览器可完成日常核心操作                                               | Phase 7       | 基本完成                                                               |
| Phase 9  | 夏季活动排房                     | 活动排房计划、预分房、冲突检查                                             | Phase 5/7/8   | **当前主线**                                                           |
| Phase 10 | AI 辅助排房                      | AI 生成可解释建议，人工最终确认                                            | Phase 9       | 暂缓                                                                   |
| Phase 11 | 运维与发布工程化                 | 白名单发布、巡检、日志、E2E、性能预算                                      | Phase 1/2/3/5 | 基本完成                                                               |
| Phase 12 | 同步与读模型 v2                  | 写契约、模块读、增量 delta、SSE 看板推送                                   | Phase 9       | 主体完成                                                               |
| Phase 13 | 在线读路径瘦身 + legacy 债务清理 | 清零在线裸 `query()`、退役 `/api/db`、写路径 in-memory patch、收敛双轨前端 | Phase 12      | **进行中**（P1 尾巴与写路径 patch ✅；legacy A–C ✅ 待提交；D–F 待办） |

> Phase 12 详见 [sync-read-model-v2.md](architecture/sync-read-model-v2.md)。Phase 13 分两条线：**读路径**（P1 尾巴已清零，在线走 `rc*` + `read-shim`）与 **legacy 债务**（SQL 网关/login 已 410 → 全 `/api/db` 410 → 写 patch 免回读 → 双轨前端收敛 → sql.js 边界）。写路径与迁移生命周期见 [migration-request-lifecycle.md](architecture/migration-request-lifecycle.md)。P4 性能专项（读副本 / SSE / Normalized Store）仍按触发门槛启动，不阻塞 Phase 9。

## 3. Phase 0：冻结在线架构（已完成）

目标：把当前工作区里的在线模式增强收束成一个可提交、可回滚、可部署的稳定版本。

当前状态：

- 关键写操作已从前端拼 SQL 收敛到后端业务 API（入住/退房/换床/续住/用斋/房务/预约/房间/床位/住客/营期/用户等）。
- `POST /api/db` SQL 网关与登录已退役；业务写与审计/改密均走 `/api/v1/*`（2026-07 起逐步全路由 410，见 §19.8）。
- 密码安全已升级：PBKDF2 哈希、legacy sha256 兼容自动升级、`auth_version` 会话失效、强制改密。
- 角色模型已扩展：`admin/zhike/kitchen/housekeeping/viewer`，并增加 `is_advanced` 与 `permissions` 字段。
- 本地与远程 migration 链已同步至 **schema v20**（`schema_version` 逐步升级；`importDB()` 与正常启动共用同一套迁移链）。
- README 与使用说明已刷新为在线多人系统定位。
- 已引入 npm devDependencies（ESLint + Prettier）用于开发与 CI，不影响发布产物。

主要任务：

- 审查 `functions/_shared/`、`functions/api/v1/`、`functions/api/public/`、`js/api-client.js`。
- 确认关键写操作已从前端拼 SQL 收敛到后端业务 API。
- 确认 D1 写操作具备事务或批处理边界，避免多人同时操作时出现床位错乱。
- 确认 `js/db.js` 的本地模式和远程模式边界清楚。
- 修正 [README.md](../README.md) 中仍偏“本地优先 MVP”的旧表述。
- 修正 [使用说明.txt](../使用说明.txt) 的章节编号和在线使用说明。
- 补齐在线 API 结构测试覆盖到新增文件。
- 提交并推送到 GitHub。

验收标准：

- `node --check` 覆盖所有 `js/*.js`、`functions/**/*.js`。
- `python3 test_api_structure.py` 通过。
- `python3 test_headless.py` 通过。
- `python3 test_cdp.py` 通过。
- `python3 test_file_protocol.py` 通过。
- GitHub `main` 包含在线 API 增强和文档更新。

交付物：

- 一次稳定提交（`6e6bee5 feat: harden cloud auth, user admin API, and admin records writes`）。
- 更新后的 README 与使用说明。
- 当前线上化架构说明。
- ESLint/Prettier 开发检查与 CI lint 步骤（`b177e54`）。

## 4. Phase 1：Cloudflare 生产环境配置

目标：让 `www.wulingkt.net` 使用 Cloudflare Pages + Functions + D1 作为正式运行环境。

主要任务：

- 创建或确认 D1 数据库。
- 配置 Pages D1 binding：`KETANG_DB`。
- 配置 `KETANG_SESSION_SECRET`，长度至少 32 字符。
- 视需要配置 `KETANG_BOOTSTRAP_SECRET`。
- 明确是否启用 `KETANG_PUBLIC_RESERVATIONS`。
- 确认 `www.wulingkt.net` 指向 Pages。
- 处理裸域 `wulingkt.net`：清理 Access 残留或统一跳转到 `www`。
- 确认不影响 `jieyu.ai`。

验收标准：

- 线上登录页可访问。
- 首次访问可初始化表结构。
- D1 中出现系统表和基础数据。
- 默认账号只能用于首次初始化或测试。
- 裸域访问策略明确，不再误入 Cloudflare Access 登录页。

交付物：

- Cloudflare Pages 配置记录。
- D1 数据库名称和 binding 记录。
- secret 配置检查清单。

## 5. Phase 2：线上多人基础验收

目标：确认系统已经真正进入“多人共享同一份数据”的状态。

主要任务：

- 使用两个浏览器、无痕窗口或两台设备同时登录。
- A 端办理入住，B 端检查房态刷新。
- B 端换床，A 端检查在住挂单和房态。
- A 端退房，B 端检查房务状态。
- 验证同一床位不能被两人同时占用。
- 验证用斋、历史查询、CSV 导出在远程模式可用。
- 验证审计日志记录关键操作。

验收标准：

- 多端看到同一份 D1 数据。
- 并发分床不会造成重复占床。
- 退房后床位和房务状态一致。
- 厨房用斋统计不重复计算预约转入住人员。
- 关键操作有审计记录。

交付物：

- 线上验收记录。
- 已知问题清单。
- 可正式迁移数据的 go/no-go 结论。

## 6. Phase 3：账号、权限与安全收口

目标：正式给寺院内部人员使用前，收紧账号、权限和入口安全。

主要任务：

- 强制修改 `admin`、`zhike` 默认密码（默认密码检测与强制改密机制已在 Phase 0 落地）。
- 确认管理员和知客师权限边界。
- 确认普通知客师不能管理用户、恢复备份或执行危险操作（已通过业务 API 与 SQL 网关限制）。
- 增加或确认登录限流（已在 Phase 0 落地）。
- 增加会话过期策略（JWT 过期 + `auth_version` 失效已在 Phase 0 落地）。
- 为 `kitchen`/`housekeeping`/`viewer` 角色配置具体可见菜单与操作权限。
- 明确「指定高级知客」的 `is_advanced` 标记使用规则。
- 确认公开预约接口不需要登录，但只能写入预约池。
- 确认错误信息不泄露 D1、SQL、secret 等内部细节。
- 建立“离职/换岗账号停用”操作流程。

验收标准：

- 默认密码无法长期保留。
- 非管理员访问用户管理和备份恢复会被拒绝。
- 登录失败不会无限尝试。
- 后台和公开预约入口边界清晰。

交付物：

- 账号初始化流程。
- 权限矩阵。
- 安全检查记录。

### 6.1 Phase 3 增补路线（2026-07 最新规划）

目标：实现“由管理员手动分配不同角色权限”，并确保前后端权限一致生效。

现状确认：

- `users` 已具备 `permissions`、`is_advanced` 字段（本地/远程 schema 与 migration 已覆盖）。
- 当前权限判断仍以 `isAdmin()` 为主，角色细粒度权限尚未真正启用。
- 多数业务 API 已有 `requireSession`，但缺少统一的权限码校验层。

#### 6.1.1 实施策略（先角色级，后用户级）

第一版先落地“角色级权限矩阵”，不直接上复杂用户级差异化策略，避免一次性改动过大。

权限源采用：

- `app_meta.role_permissions_v1`（JSON）作为角色权限配置存储。
- 无配置时回退到内置默认权限模板。
- 前端以会话返回的权限集合作为唯一显示依据；后端以同一权限集合作为唯一拦截依据。

#### 6.1.2 权限码体系（第一批）

- `board.read`
- `lodging.read` / `lodging.checkin` / `lodging.checkout` / `lodging.edit` / `lodging.change_bed`
- `reservation.read` / `reservation.write`
- `meals.read` / `meals.write`
- `housekeeping.read` / `housekeeping.write`
- `reports.read` / `reports.export`
- `users.read` / `users.write`
- `backup.read` / `backup.write`
- `settings.read` / `settings.write`

#### 6.1.3 分阶段执行顺序（Phase 3A/3B/3C）

Phase 3A（权限模型打底）：

- 定义权限码清单与默认角色权限模板。
- 新增角色权限读取与存储能力（本地 + 云端一致）。
- 会话接口返回当前用户权限集合。

Phase 3B（后端强制鉴权）：

- 为关键写接口补齐 `requirePermission`。
- 拦截优先级：入住/退房/换床/编辑/用斋/房务/预约写入/用户管理/备份。
- 非授权统一返回 403，杜绝“仅靠前端隐藏”。

Phase 3C（管理员可视化分配）：

- 在用户管理区域新增“角色权限配置”面板。
- 管理员可勾选并保存每个角色的权限集合。
- 菜单、按钮与关键操作按权限显隐并二次后端校验。

#### 6.1.4 后续增强（Phase 3D，可选）

- 用户级覆盖权限（在角色基础上加减）。
- `is_advanced` 作为“高级知客”快捷模板开关。
- 资源级权限（如“仅查看本人办理挂单”）在角色级稳定后再引入。

#### 6.1.5 验收标准（新增）

- 任意业务写 API 均有权限守卫，非授权返回 403。
- 不同角色登录后菜单和操作能力与权限矩阵一致。
- 本地模式与云端模式权限结果一致。
- 管理员修改角色权限后，新会话立即按新权限生效；密码重置/停用仍触发现有会话失效机制。

#### 6.1.6 本轮性能与体验结论（关联 Phase 3）

- 登录页“身份加载假状态”已移除，登录/强制改密已补齐 pending 反馈。
- 远程初始化已做 Worker 级缓存，认证链路仍存在 8-13 秒延迟，后续需在 Phase 3B 前并行做接口分段耗时诊断。

#### 6.1.7 待拍板事项（进入实现前必须确认）

- 本期是否仅做角色级权限（推荐：是）。
- `viewer` 是否允许报表导出（推荐：默认不允许）。
- `kitchen` / `housekeeping` 是否允许查看住客基础信息（推荐：允许只读）。

## 7. Phase 4：公开预约入口

目标：外部人员可以提交预约申请，但不能看到或操作后台数据。

主要任务：

- 设计公开预约页面。
- 字段采用 [product-requirements-current.md](product-requirements-current.md) 中的公开预约字段。
- 接入 `POST /api/public/reservations`。
- 增加手机号、日期、姓名等基本校验。
- 增加限流和防重复提交策略。
- 后台预约列表显示公开预约来源。
- 内部人员可确认、取消、转入住。
- 公开预约提交后给出清楚提示：不是自动确认床位。

验收标准：

- 未登录用户可以提交预约。
- 未登录用户不能查询房态、床位、住客、报表、用户。
- 后台能看到公开预约并处理。
- 重复提交和乱填字段能被基本拦截。

交付物：

- 公开预约页面。
- 后台预约池接收流程。
- 对外可用的预约说明文案。

## 8. Phase 5：本地数据迁移到云端

目标：把旧本地数据迁移到 D1，并明确迁移后 D1 是正式权威数据源。

主要任务：

- 在本地导出迁移包。
- 在线管理员导入迁移包。
- 导入前提示风险并要求二次确认。
- 导入后校验房间、床位、住客、在住、预约、历史、用斋、收款、营期、房务、用户数量。
- 对比关键名单，确认没有漏人、错床、错日期。
- 导入后跑完整业务路径。
- 明确迁移完成后旧本地库只作为归档。

验收标准：

- 线上数据数量与本地导出一致。
- 在住床位关系正确。
- 预约状态正确。
- 历史记录可查。
- 用斋统计可用。
- 迁移后可正常新增、退房、换床。

交付物：

- 迁移包。
- 迁移校验表。
- 迁移完成确认记录。

## 9. Phase 6：备份与恢复

目标：先确保手动备份和恢复可靠，再实现 R2 定时备份。

主要任务：

- 管理员 JSON 导出。
- 管理员 JSON 导入。
- D1 控制台备份说明。
- 编写恢复演练流程。
- 后续增加 Worker Cron 定时导出 D1 JSON 到 R2。
- 后续设置备份保留策略。

建议备份策略：

- 近 7 天每日保留。
- 近 8 周每周保留。
- 近 12 个月每月保留。
- 关键活动前后手动额外备份。

验收标准：

- 管理员能导出完整 JSON。
- 管理员能从 JSON 恢复。
- 恢复后主流程可用。
- 后续 R2 中能看到按日期命名的备份文件。

交付物：

- 备份按钮或说明。
- 恢复演练记录。
- 后续 R2 自动备份任务。

## 10. Phase 7：基础业务补强

目标：在线稳定后，补齐真实客堂日常使用中最容易出错的细节。

主要任务：

- 强化身份证、手机号、日期、金额等字段校验。
- 统一前端校验和后端校验，避免只在页面提示、不在 API 拦截。
- 完善床位两级选择体验：先选寮房/房间，再选床位。
- 继续排除备用床和维修床统计。
- 完善房务流转：脏房、净房、查房、维修、可入住。
- 完善用斋统计：预约、在住、跳餐、不用斋名单。
- 完善打印凭证、门贴、CSV 导出格式。
- 完善历史查询和报表筛选。
- 为非 IT 用户优化按钮、提示、错误文案。

验收标准：

- 乱填手机号、身份证、日期会被明确拦截。
- 后端 API 不接受明显非法字段。
- 床位选择不显示不可分配床位。
- 报表和导出能被厨房、客堂直接使用。
- 常用路径无需技术人员解释即可完成。

交付物：

- 校验规则清单。
- 日常业务验收清单。
- 更新后的使用说明。

## 11. Phase 8：移动端适配

目标：从“手机浏览器能打开”提升到“手机可完成日常核心操作”。移动端第一版服务知客师临时查看、现场确认、简单办理，不承担复杂报表和大型活动排房的主要编辑工作。

当前判断：系统已有 viewport 和部分响应式 CSS，能在手机浏览器打开；但还没有移动端专用导航、移动端验收测试、PWA 安装配置，也没有针对小屏重新设计密集表格和排房工作流。

主要任务：

- 增加移动端导航：底部 Tab、顶部折叠菜单或抽屉菜单，避免小屏堆满侧栏按钮。
- 优化手机首屏：房态、今日到离、今日预约、今日用斋、待清洁房间优先展示。
- 优化日常操作路径：查看房态、搜索住客、确认预约、办理入住、退房、换床、查看用斋。
- 优化表单输入：大按钮、大触控区域、日期输入、身份证/手机号错误提示、提交后二次确认。
- 优化弹窗和下拉：床位选择、用斋选择、换床弹层在小屏不溢出。
- 优化表格密集页：报表、历史、房务、预约列表在手机上改为卡片或横向滚动方案。
- 增加 PWA 基础能力：`manifest`、应用图标、主题色、添加到主屏幕。
- 增加移动端自动化验收：用 iPhone 尺寸跑登录、房态查看、入住、退房、预约确认等路径。
- 更新 [使用说明.txt](../使用说明.txt)，说明手机端适合做什么、不适合做什么。

验收标准：

- iPhone 尺寸下首页不出现横向整体溢出。
- 手机端可完成登录、查看房态、搜索在住、确认预约、现场入住、退房。
- 关键按钮触控区域足够大，文字不重叠、不被遮挡。
- 弹层、下拉、床位选择器在小屏可完整操作。
- PWA 可添加到主屏幕，图标和名称正确。
- CI 或本地测试包含至少一条移动端 viewport 自动化路径。

交付物：

- 移动端导航与核心页面响应式改造。
- PWA manifest 与图标资源。
- 移动端验收脚本。
- 手机端使用说明。

明确不在第一版移动端承担：

- 大型活动排房计划的复杂多人编辑。
- 大表格深度分析。
- AI 排房规则配置。

## 12. Phase 9：夏季活动排房增强

目标：从普通营期管理升级为大型活动排房工作流，覆盖 [summer-rooming-requirements.md](summer-rooming-requirements.md) 中的核心流程。

建议拆成 5 个小版本：

### 9.1 活动与人员标签

- 增加活动扩展字段。
- 增加入住人员标签：身份、年龄、活动归属、时间、特殊需求。
- 增加房间/床位标签：房间类型、适合老人、适合儿童、可转换、机动等。

验收：能录入一次夏季活动所需的基础信息。

### 9.2 时间轴与容量预测

- 生成每日入住人数预测。
- 生成男女、儿童、老人、师资、义工分布。
- 生成每日床位余量和缺口提醒。

验收：能提前发现高峰日期和床位缺口。

### 9.3 预分房草稿

- 创建排房计划。
- 生成或手工维护预分配床位。
- 支持未确认、待调整、已确认状态。
- 不直接影响正式在住，直到发布或转入住。

验收：能为一个多日活动形成预分房表。

### 9.4 冲突检查与人工确认

- 检查床位冲突、性别冲突、身份冲突、时间冲突、特殊需求冲突、活动冲突。
- 输出缺口名单和必须人工确认的问题。
- 支持记录负责人确认结果。

验收：系统能拦截硬性规则冲突，并列出需要请示的问题。

### 9.5 发布、交接与复盘

- 发布最终分房。
- 输出签到表、房间表、门贴或床位名牌。
- 记录活动期间调整。
- 活动结束后形成复盘报表。

验收：能支撑一次从报名到离寺的完整活动排房流程。

交付物：

- 活动排房计划。
- 每日床位占用预测。
- 预分房表。
- 冲突检查表。
- 签到/门贴/交接输出。
- 复盘报表。

## 13. Phase 10：AI 辅助排房

目标：在规则化数据稳定后，让 AI 生成可解释排房建议，但最终确认仍由人负责。

主要任务：

- 把硬性规则结构化。
- 把舒适度规则结构化。
- 设计 AI 输入数据，不暴露不必要隐私。
- 输出排房建议和依据。
- 标记必须人工确认的问题。
- 禁止 AI 自动发布最终床位。

验收标准：

- AI 不违反硬性规则。
- AI 每条建议有理由。
- AI 输出能被人工修改和确认。
- 涉及老人、儿童、僧众、师资、隐私、外宿、特殊空间时必须人工确认。

交付物：

- AI 排房建议界面。
- 规则解释面板。
- 人工确认流程。

## 14. 当前最推荐的执行顺序

> **排期调整（2026-07-05）**：Phase 9 夏季排房仍为业务主线；**Phase 13 legacy 债务清理**与 Phase 9 并行（不挡排房功能开发）。最终总验收仍放在 Phase 4 之后。

1. ~~Phase 1 收尾~~、~~Phase 5 迁移~~、~~Phase 6 手动备份/恢复演练~~：**P0 已验收通过**（2026-07-02，D1 为正式权威源）。
2. ~~P1-2 权限可视化~~、~~P1-3 巡检与性能基线~~、~~P2-1 业务规则~~、~~P2-2 / Phase 8 移动端~~：**已基本完成**。
3. **当前主线：Phase 9 夏季活动排房**（9.1 → 9.5 分小版本推进，见 §12）。
4. **并行：Phase 13 legacy 债务清理**（§19.8）：写路径 `patchRows` ✅ → `/api/db` 全 410 ✅（待提交）→ 双轨前端收敛（16 模块仍留本地分支）→ sql.js 仅 CI migration/灾备 → 探针 enforce 常态化。
5. **其后：Phase 4 公开预约**（`reserve.wulingkt.net`、Turnstile、企业微信通知；依赖 Phase 9 核心流程稳定）。
6. **最后：最终总验收**（含原 P1-1 多人协同、并发占床、权限矩阵、备份恢复、发布安全、性能基线；见 [final-acceptance-checklist.md](final-acceptance-checklist.md)）。
7. Phase 10 AI 辅助排房继续暂缓；Phase 13 **P4 性能专项**（读副本/SSE/Normalized Store）按 §19.7.4 触发门槛决策，不前置。

当前排期原则：夏季大型活动排房优先落地；legacy 清理与排房开发并行、以守门测试防回归；公开预约与对外入口在排房能力就绪后再开；**总验收作为上线前最后一关**。

## 15. 需要澄清或拍板的决策点

### A. 上线入口与访问策略

1. 裸域 `wulingkt.net` 是跳转到 `www.wulingkt.net`，还是也直接打开系统？
2. 后台登录页是否公网可见，只靠账号密码保护，还是后续再加 Cloudflare Access？
3. 公开预约入口是否使用同一域名路径，例如 `/reserve`，还是使用单独子域名？

### B. 账号与权限

4. 正式角色是否只保留 `admin` 和 `zhike`，还是需要增加 `kitchen`、`housekeeping`、`viewer` 等角色？
5. 知客师是否允许查看收款金额和历史收款？
6. 谁可以执行删除挂单、导入备份、恢复数据这类高风险操作？
7. 是否需要为每位实际操作人员创建独立账号，还是多人共用 `zhike`？

### C. 公开预约

8. 公开预约是否立即开放，还是等真实数据迁移和备份完成后再开放？
9. 公开预约必填字段是否包含身份证号？如果不必填，后台确认时是否再补？
10. 公开预约提交后是否需要短信、微信或邮件通知？当前路线图暂不包含通知。
11. 预约是否允许申请人自行取消或修改？当前路线图暂按“只提交，后台处理”。
12. 公开预约是否需要验证码或更强防刷？

### D. 数据迁移

13. 旧本地库是否存在多份 `ketang.db`，哪一份是最终权威？
14. 迁移时是否覆盖线上测试数据，还是先清空线上库再导入？
15. 迁移后旧本地版是否只读归档，还是仍允许继续录入离线数据？
16. 用户账号是否随迁移一起导入，还是上线后重新创建？

### E. 备份恢复

17. 自动备份频率是每日一次，还是活动期间提高到每日多次？
18. 备份保留期限是否接受“7 天每日、8 周每周、12 个月每月”？
19. 谁有权限下载备份？备份文件是否需要额外加密？
20. 恢复备份是否允许在正式库直接覆盖，还是必须先恢复到临时库检查？

### F. 日常业务规则

21. 身份证号在寺院场景中是必填、选填，还是只在特定身份必填？
22. 手机号是否允许海外号码、座机、无手机号人员？
23. 押金、房费、收款方式是否继续保留，还是只作为备注和统计？
24. 备用床是否永远不进入统计，还是某些活动可以人工启用并进入活动统计？
25. 房务流转是否必须包含“查房”步骤，还是可以从“净房”直接变“可入住”？

### G. 夏季活动排房

26. “僧寮、师资房、义工房、学员房、客房、机动房”这些房间类型是否符合寺院实际？
27. 儿童与监护人的安排规则要做到多严格？是否允许同房、邻房、同区三档？
28. 师资、老人、儿童、僧众之间的优先级是否按本文顺序执行？
29. 是否允许系统自动生成预分房，还是第一版只做人工预分房 + 冲突检查？
30. 门贴、床位名牌、签到表需要什么格式：A4 打印、CSV、还是浏览器直接打印？
31. 活动排房是否需要支持多人同时编辑同一个排房计划？

### H. AI 辅助排房

32. AI 是否可以使用真实姓名和特殊需求信息，还是必须脱敏后再处理？
33. AI 只做“建议”，这个边界是否固定不变？
34. 是否接受先做规则引擎，不接大模型，等规则稳定后再接 AI？

## 16. 已选方案记录

记录日期：2026-07-01。最后更新：2026-07-02。

### I. 排期顺序（2026-07-02 拍板）

37. 执行顺序：选择 **Phase 9（夏季排房）→ Phase 4（公开预约）→ 最终总验收**；总验收不再挡在 Phase 9 之前。

### A. 上线入口与访问策略

1. 裸域 `wulingkt.net`：选择 B，裸域和 `www.wulingkt.net` 都直接打开系统。
2. 后台登录页访问策略：选择 B，后续加 Cloudflare Access。
3. 公开预约入口位置：选择 B，使用单独子域名，例如 `reserve.wulingkt.net`。

### B. 账号与权限

4. 正式角色：选择 E，需要增加 `kitchen`、`housekeeping`、`viewer`，并保留 `admin`、`zhike`。
5. 知客师查看收款：选择 A，可以查看收款金额和历史收款。
6. 高风险操作权限：选择 A + B，`admin` 与指定高级知客权限相同，均可执行删除挂单、导入备份、恢复数据、用户管理、批量取消/No-show 等高风险操作。
7. 操作账号：选择 A，每位实际操作人员使用独立账号。

### C. 公开预约

8. 开放时机：选择 D，先内部试用，再公开开放。
9. 公开预约身份证号：选择 A，必填。
10. 身份证号后台补录规则：不适用；公开预约身份证号必填，不走后台补录逻辑。
11. 提交通知：选择 C，需要企业微信通知。
12. 申请人取消或修改：选择 A，不能自行取消或修改，只能联系客堂。
13. 防刷策略：选择 C，使用 Cloudflare Turnstile。

### D. 数据迁移

14. 旧本地库数量：选择 A，只有一份权威 `ketang.db`。
15. 线上测试数据处理：选择 B，迁移时覆盖线上测试数据。
16. 迁移后旧本地版：选择 D，日常业务不再使用；代码级本地模式保留作为开发和备灾工具。
17. 用户账号迁移：选择 A，不导入旧账号，线上重新创建账号。

### E. 备份恢复

18. 自动备份频率：选择 B，每日两次。
19. 备份保留期限：选择 D，永久保留，后续手动清理。
20. 备份下载权限：选择 B，`admin` + 指定高级知客可下载。
21. 备份加密：选择 A，暂不额外加密，依赖 Cloudflare 权限。
22. 恢复方式：选择 D，后台提供恢复，但必须二次确认。

### F. 日常业务规则

23. 身份证号业务规则：改为必填；公开预约和现场入住均必须填写身份证号。
24. 手机号业务规则：选择 E，允许海外号码、座机、无手机号但需备注联系人。
25. 押金、房费、收款方式：选择 A，保留并用于统计。
26. 备用床统计：选择 C，进入活动统计，但不进入日常统计。
27. 房务查房步骤：选择 C，可配置是否需要查房。

### G. 夏季活动排房

28. 房间类型：选择 A，采用僧寮、师资房、义工房、学员房、客房、机动房。
29. 儿童与监护人规则：选择 D，按活动负责人确认。
30. 排房优先级：选择 A，按当前路线图顺序执行。
31. 预分房第一版：选择 B，系统自动生成预分房草稿。
32. 门贴、床位名牌、签到表格式：选择 D，浏览器直接打印、CSV、A4 打印模板都需要。
33. 多人编辑排房计划：选择 B，支持多人编辑，但保存时提示冲突。

### H. AI 辅助排房

34. AI 数据使用：选择 B，必须脱敏后使用。
35. AI 权限边界：选择 B，可生成草稿，但必须人工确认发布。
36. AI 实施顺序：选择 A，先做规则引擎，不接大模型。

## 17. 待澄清事项

1. 企业微信通知需要后续确认接入形态：企业微信群机器人、企业微信应用消息，还是审批/待办类消息。
2. ~~指定高级知客需要后续在账号模型中落地：已通过 `users.is_advanced` 标记落地，待明确业务规则。~~

## 18. 暂不做事项

- 全寺 ERP。
- OA 审批。
- 完整会计系统。
- 多租户 SaaS。
- 外部用户后台注册。
- App Store / 微软商店上架。
- Electron / Tauri 安装包。
- AI 自动决定最终床位。
- 未确认安全边界前接入短信、微信、邮件等外部通知。

## 19. 2026-07-02 代码现状复盘与重新排期

本节以当前 `main` 分支代码为准，重新校准路线图。**最后全面更新：2026-07-05**（含 Phase 13 legacy 债务清理进展，见 §19.8）。

### 19.1 已落地或基本落地

- 生产在线形态已跑通：Cloudflare Pages + Functions + D1，`wulingkt.net` 可直接打开系统。
- 发布面安全已加强：`_headers`、`_routes.json`、`functions/_middleware.js` 已阻断源码、测试、文档、配置和本地数据路径。
- 角色与权限基础层已落地：`role-permissions.defaults.json`、前后端权限加载、`requirePermission`、按角色裁剪 read-model 已存在。
- 读模型性能已优化：`GET /api/v1/read-model` 支持 `ETag` / `If-None-Match`，客户端可处理 `304`，减少重复灌库。
- 登录体验已有改善：身份下拉不再依赖 D1 查询，登录前减少重初始化；登录/导入等关键操作已有 pending/提示顺序修复。
- 在线 CSV 批量入住已支持：`POST /api/v1/batch-check-in` 与前端 CSV 导入路径已接入，原“云端不支持 CSV 批量入住”的限制已过期。
- 备份恢复已进入可用但仍需验收状态：`/api/v1/admin/data-backup` 支持 JSON 导出/导入、导入预检、错误表名/行号、用户密码兜底、床位占用冲突检查。
- 弹窗布局已统一：营期/用户/排房建议复用 `#modal` + `modal-backdrop`，修复 `modal-overlay` 未定义导致的布局错误（`2569dad`）。
- **P0 运维脚本已落地**（`708da8e`）：`verify_migration_json.py`、`compare_backup_json.py`、`build_pages_release.sh`、`verify_release_dir.py`、`post_deploy_check.py`、`run_p0_checklist.sh`；白名单发布默认输出 `.release/`（78 文件）；已用白名单目录部署 Pages。
- **P0 正式验收已通过**（2026-07-02）：线上 JSON 导入、数量核对、基线导出与恢复演练完成；D1 现为正式权威数据源（房间 64 / 床位 522 / 在住 311）。
- **Phase 13 写路径 patch（2026-07-05，`main`）**：热路径 `lodgers` / `reservations` / `admin-records` / `meals` / `housekeeping` / `rooming-publish` 统一 in-memory `patchRow` / `patchRows`；`enrichWriteResponse` 业务侧零 `patchRowIds`；`admin/records` 分段 `handler_ms` / `write_tail_ms` / `patch_ms`；探针 workflow + `scripts/admin_write_thresholds.py`。
- **Phase 13 sql.js 兼容债第一批（2026-07，`main`）**：`/api/db` login/SQL 网关 410；v1 用户名登录 + 自助改密；发布产物移除 `sql-wasm`；CI 守门 `test_sql_js_debt_inventory.py` / `test_db_sql_gateway_retired.py` / `test_read_shim_online_guard.py`。
- **Phase 13 legacy 债务 A–C（2026-07-05，工作区待提交）**：`functions/api/db.js` 全路由 410 `LEGACY_DB_RETIRED`；客户端删除 `remoteDBRequestAsync`；`enrichWriteResponse` 移除 `patchRowIds` / `rowId` SELECT 回读；`read-shim.js` 引入 `readLocalQuery()`，在线零 fall through 到 `query()`；14 个模块在线分支改为 `useOnlineDataPath()`；守门 `test_no_api_db_client.py` 入 CI。

### 19.2 P0 验收记录（已完成）

#### P0-1 正式数据迁移验收 ✅

- 本地校验：`verify_migration_json.py` 通过。
- 线上导入：「系统设置 → 从 JSON 恢复」完成正式导入。
- 数量核对：与迁移包一致（在住 311、房间 64、床位 522）。
- 基线备份：导入后已导出在线 JSON 存档。

#### P0-2 备份恢复闭环 ✅

- 恢复演练：线上 JSON 导出/恢复流程验证通过。
- 数量对比：`compare_backup_json.py` 关键表与基线一致。
- 主流程：房态、在住、房务、权限正常。

#### P0-3 发布目录白名单化 ✅

- `scripts/build_pages_release.sh` → `.release/` 白名单目录。
- `scripts/verify_release_dir.py` 发布前扫描禁止路径。
- 部署命令：`npx wrangler pages deploy .release --project-name ketang`。
- 敏感路径：404/403 阻断已确认。

### 19.3 当前最高优先级（P1）

#### P1-1 线上多人业务验收

**状态：清单就绪，执行后置** → [docs/final-acceptance-checklist.md](../final-acceptance-checklist.md) §1–3。

#### P1-2 权限可视化与契约测试

**状态：已完成**（2026-07-02）。

- 系统设置 → **角色权限配置** 面板；保存至 `app_meta.role_permissions_v1`。
- 用户编辑 **高级知客**（`is_advanced`）自动合并备份/用户/基础设置权限。
- API：`GET/POST /api/v1/admin/role-permissions`；契约测试覆盖 defaults 快照与关键 API 403 守卫。

**最终总验收：** 各角色菜单/API 403 全矩阵（见最终验收清单 §4）。

#### P1-3 发布后巡检与生产性能预算

**状态：已完成**（2026-07-02）。

- `scripts/post_deploy_check.py`：敏感路径 403/404 + `--allow-access-block`（Access 环境）
- `test_prod_latency.py`：P50/P95、read-model **304** 探测、`--check-baseline`
- `docs/ops/performance-baseline.json`：阈值基线
- `scripts/run_p1_checklist.sh` + `test_p1_ops.py`：一键 P1 自动化

```bash
bash scripts/run_p1_checklist.sh https://wulingkt.net https://<pages-preview>.ketang-6as.pages.dev
```

### 19.4 中期优先级（P2）

#### P2-1 日常业务规则补强（基本完成）

目标：真实数据稳定后，收紧现场使用中最容易出错的字段和流程。

任务与现状：

- 身份证必填、手机号允许海外/座机/无手机号但需联系人备注：**已完成**。
  - 前端：`js/validation.js`（`isPhoneLooseValid`、`RULES.idCard/phoneLoose`、`validateGuestContact` 等）。
  - 后端：`functions/_shared/validation.js`（`assertGuestIdentityFields`、`assertPhoneOrEmergency`）。
  - 使用点：入住、预约、编辑、公开预约提交。
  - 残留缺口：`reserve.html` 公开预约页实时逐字段校验未接入 `FIELD_RULES`，仅提交时校验。
- 备用床日常不计入、活动可计入：**已完成**。
  - 规则：`js/utils.js`（`isSpareRoom`、`spareRoomExcludeClause`）。
  - 日常排除：房态看板、房务、预测、排房容量。
  - 活动计入：`events.include_spare_beds` 字段 + `rooming-capacity.js` 按事件启用。
- 房务“是否必须查房”配置项：**已完成**。
  - Key：`housekeeping_require_inspect_v1`。
  - UI：`js/housekeeping.js` 系统设置面板；API：`functions/api/v1/admin/operational-settings.js`。
  - 生效点：分床、换床、退房、房务状态流转前后端一致。
- 押金、房费、收款方式继续用于统计：**已完成**。
  - 表：`payments`（type CHECK：押金/房费/退款/其他，含 method）。
  - 写入：入住/退房 API 自动插入；报表日报/月报展示。

验收：

- 前端和后端校验一致。
- 报表、导出、打印能反映最终业务口径。

#### P2-2 移动端日常核心操作（基本完成）

目标：手机端先能完成日常查看和轻操作，不承载复杂排房。

任务与现状：

- 移动端导航：**已完成**。底部 Tab（房态/在住/办理/报表/更多）+ 更多抽屉菜单；权限过滤 `applyMobileMorePermissions`。
- 手机首屏核心卡片：**已完成**。`js/mobile-ui.js` 展示今日预到、今日预离、空床、脏房四宫格。
- 日常操作路径：**基本完成**。底部 Tab + 抽屉覆盖主要视图；在住卡片提供用斋/续住/换床/退房快捷按钮；预约确认入口在「更多」中，路径略深。
- 表单输入优化：**部分完成**。入住/预约分步向导、身份证/手机号实时校验、大按钮/触控区已落地；统一提交后二次确认尚未完全覆盖（仅破坏性操作有 `confirm`）。
- 弹窗/下拉小屏适配：**部分完成**。通用 modal 限制 `max-height`、底部对齐；床位选择、用斋选择未做独立小屏组件，依赖滚动。
- 表格密集页：**部分完成**。在住列表、房务已卡片化；报表/历史/流动预测/预约列表仍用 `table-wrap` 横向滚动。
- PWA 基础能力：**已完成**。`manifest.webmanifest`、viewport、theme-color、apple-mobile-web-app、`sw.js` 预缓存 Shell。
- 移动端自动化验收：**已完成**。`test_mobile_viewport.py` 覆盖 viewport、导航、PWA、登录、首屏、卡片、向导、溢出检测、完整入住-退房 journey。

验收：

- 手机端无整体横向溢出。
- 登录、房态、搜索、入住、退房可完成。

残留缺口：预约确认入口较深、报表/历史/预测未卡片化、统一提交二次确认缺失、部分弹层选择器未独立小屏组件。

### 19.5 后置优先级（按新排期）

- **当前执行：Phase 9 夏季活动排房**（活动标签 → 容量预测 → 预分房草稿 → 冲突检查 → 发布交接）。
- **Phase 12 同步与读模型 v2**（主体已完成）：12.1 写契约与热修复 → 12.2 视图注册 → 12.3 模块读 API → 12.4 增量同步 → 12.5 看板 SSE。详见 [architecture/sync-read-model-v2.md](architecture/sync-read-model-v2.md)。
- **Phase 13 在线读路径瘦身**：P1 尾巴（reports/forecast/history/events/rooming/guests 在线 `rc*`）✅；legacy 债务清理 A–C ✅（工作区待提交，见 §19.8）；P4 读副本/SSE 按触发门槛。
- **Phase 4 公开预约**：P1 尾巴已清零，具备开放技术条件；业务上确认后即可接入 `reserve.wulingkt.net` + Turnstile + 企业微信通知。
- **最终总验收**：Phase 4 收尾后、正式对外大规模使用前一次性执行（见 §19.6）。
- AI 辅助排房：等规则引擎、脱敏策略和活动排房数据稳定后再评估。

### 19.7 Phase 13：在线读路径瘦身与 P4 修正排期

本节根据 **2026-07-05** 代码核查更新。结论：同步与读模型 v2、P1 读尾巴、写路径 in-memory patch 均已落地；**legacy API 与双轨前端**进入 §19.8 专项清理。

#### 19.7.1 现状核查结论（2026-07-05）

- **SSE / 轮询**：`GET /api/v1/stream/board` 每 **500ms** 检测 `board_version`，15s ping；客户端 `startBoardStream()` + 轮询兜底（active 1s / idle 5s）；board 视图外或 hidden 时关闭 SSE。
- **写后策略**：仅 `patch_complete === true` 时推进本地 `board_version` 并跳过 delta；`write-refresh` / `write-reconcile` 分计。
- **读模块**：`lodgers_active` + `lodgers_recent`（180 天窗口）；报表超窗按需拉全量 `lodgers`。
- **写路径 patch（`main`）**：lodger 热路径、预约 upsert/batch、营期取消级联、admin 挂单/房务/用斋、排房 queue check-in 等均 `patchRow` / `patchRows`；`test_event_write_path.py` 禁止热路径与 `write-response.js` 使用 `patchRowIds`。
- **迁移生命周期（`main`）**：见 [migration-request-lifecycle.md](architecture/migration-request-lifecycle.md) — `ensureDatabaseReady`、`schema_ready_version`、`POST /api/v1/admin/migrate`、写尾单 batch、`test_migration_hot_path.py`。
- **在线 boot**：`index.html` 不加载 `sql-wasm`；在线误调 `query()` 抛错；`test_online_no_sql.py` + `test_online_query_boundaries.py` 守门。
- **read-shim**：在线走 `rc*`；`readOnlineCachePending()` 返回空值；**`readLocalQuery()`** 保证在线永不 fall through 到 `query()`（§19.8 Phase C，工作区待提交）。
- **双轨前端**：`useOnlineDataPath()` = `isRemoteDB() && !KETANG_FORCE_LOCAL_DB`；14 个模块在线分支已从 `!isLocalForceDb()` 改为 `useOnlineDataPath()`；**仍含 `isLocalForceDb()` 的模块 16 个**（inventory 见 `test_sql_js_debt_inventory.py`）。
- **`/api/db`**：`main` 上 login/SQL 网关已 410；**全路由 410 + 客户端零引用**（§19.8 Phase A，工作区待提交）。
- **`enrichWriteResponse`**：业务热路径 in-memory patch；**`patchRowIds` / `rowId` SELECT 回读已移除**（§19.8 Phase B，工作区待提交）。
- **度量**：`GET /api/v1/metrics/perf?limit=100`；admin 写分段 `handler_ms` / `write_tail_ms` / `patch_ms`；`.github/workflows/probe-admin-write.yml` + `scripts/admin_write_thresholds.py`。
- **P1 尾巴**：在线热路径零裸 `query()`；`guests.js` 查找走 `rcFindGuest*`；在线 CSV 走 `apiBatchCheckIn`。
- **WebSocket / D1 读副本**：未实现；按 §19.7.4 触发门槛决策。

#### 19.7.2 修正后的执行顺序

1. ~~CRUD 写链路 patch + 高频操作 pending~~：**已完成**（含排房 queue check-in、`patch_complete` 全覆盖）。
2. ~~P1 尾巴 A–E（在线读零裸 `query()`）~~：**已完成**。
3. **§19.8 legacy 债务清理 A–C**：**已完成（工作区待提交）**；D–F 按 §19.8.2 推进。
4. **P4-② D1 只读副本**：报表/历史 P95 > 800ms 或 D1 读配额告警时启动。
5. **P4-① SSE 优化**：终端 <30 时优先调间隔/重连；WebSocket 仅 spike 后决策。
6. **P4-③ Normalized Store**：多模块 patch bug 复现 ≥2 次再评估。
7. **P4-④ 完全去 sql.js**：§19.8 Phase E；`KETANG_FORCE_LOCAL_DB` + CI migration job 为唯一运行时消费者。

#### 19.7.3 P1 尾巴清零批次

| 批次 | 范围                                              | 工作                                                    | 完成标准                             |
| ---- | ------------------------------------------------- | ------------------------------------------------------- | ------------------------------------ |
| A    | `reports.js`                                      | 日报/月报/事件报表改为 read API 或 `rc*` 聚合           | ✅ 在线路径不直接裸 `query()`        |
| B    | `forecast.js`                                     | 今日房态/预测改为 `rc*` + 内存计算                      | ✅ 预测页不触发 sql.js hydrate       |
| C    | `history.js`、`events.js`、`rooming-*`、`auth.js` | 在线读迁 `rc*` / read API；本地 `isLocalForceDb()` 守卫 | ✅ `test_online_query_boundaries.py` |
| D    | `index.html`、`db.js`、发布白名单                 | `sql-wasm` 仅本地/灾备动态加载                          | ✅ 在线 bundle 不含 wasm             |
| E    | `guests.js`、`checkin.js`（CSV）                  | 在线 `rcFindGuest*`；写路径 `guestUseLocalDb()`         | ✅ 在线 CSV 走 `apiBatchCheckIn`     |

#### 19.7.4 P4 技术专项触发门槛

| 专项             | 启动门槛                                                  | 优先方案                                                                  |
| ---------------- | --------------------------------------------------------- | ------------------------------------------------------------------------- |
| D1 只读副本      | 报表/历史查询 P95 > 800ms，或 D1 读配额告警               | `KETANG_DB_READ` 分流 reports/history/backup，主库继续负责看板和 delta    |
| SSE/WebSocket    | 双端写后 B 端 P95 > 2s，或看板用户数导致 SSE/轮询成本过高 | 先 SSE 优化；DO WebSocket 作为 spike 后决策                               |
| Normalized Store | 多模块同表 patch bug 复现 2 次以上                        | 先补 `changed_modules` / patch 范围，再决定是否引入 `rc-normalized.js`    |
| 去 sql.js        | §19.8 Phase E 完成；在线 `query()` 仅 local 分支          | 动态加载 sql.js；CI 拆分在线 job 与 `KETANG_FORCE_LOCAL_DB` migration job |

#### 19.7.5 下一步建议（2026-07-05）

| 优先级 | 动作                                                                                      | 状态                           |
| ------ | ----------------------------------------------------------------------------------------- | ------------------------------ |
| P0     | 写路径 `patchRows` + admin 分段计时 + 探针 workflow                                       | ✅ `main`                      |
| P0     | P1 尾巴 + 在线 query 边界守门                                                             | ✅                             |
| P1     | §19.8 Phase A–C：全 `/api/db` 410、`enrichWriteResponse` 无 SELECT 回读、`readLocalQuery` | ✅ 待提交                      |
| P1     | §19.8 Phase D：剩余 16 模块本地分支收敛 / `useOnlineDataPath` 统一                        | 进行中                         |
| P2     | §19.8 Phase F：`--enforce-thresholds` 绑进定期 CI / release 前 manual probe               | 部分（workflow_dispatch 已有） |
| P3     | §19.8 Phase E：sql.js 仅 migration/灾备；`file://` 正式废弃                               | 待办                           |
| —      | P4 spike（读副本 / SSE）                                                                  | 待触发                         |

结论：**P4 不阻塞 Phase 9 排房**。legacy 清理与排房并行；完成 §19.8 后 Phase 13 可标记为「主体完成」，仅 P4 按门槛可选启动。

### 19.8 Phase 13 续：legacy 债务清理方案（2026-07-05）

目标态：**生产只走 D1 + `/api/v1/*` + `rc*` 读缓存**；`POST /api/db` 与 sql.js 运行时依赖清零；双轨前端仅保留 CI migration / 灾备恢复路径。

#### 19.8.1 债务分类

| 类型                                  | 性质           | 生产风险            | 清理阶段 |
| ------------------------------------- | -------------- | ------------------- | -------- |
| `/api/db` 边界                        | API 生命周期债 | 低（客户端已不用）  | A        |
| 写 patch SELECT 回读                  | 性能债         | 无（已清）          | B        |
| 双轨前端 `isLocalForceDb` / `query()` | 过渡兼容债     | 低（在线已 bypass） | C + D    |
| sql.js 运行时                         | 架构边界债     | 低                  | E        |
| SLO / enforce 探针                    | 运维债         | 中（回归难发现）    | F        |

#### 19.8.2 分阶段执行与验收

| 阶段  | 内容               | 关键落点                                                                                       | 验收（CI）                                                         | 状态      |
| ----- | ------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------- |
| **A** | `/api/db` 完全退役 | `functions/api/db.js` 统一 410；删 `remoteDBRequestAsync`；init → `POST /api/v1/admin/migrate` | `test_no_api_db_client.py`、`test_db_sql_gateway_retired.py`       | ✅ 待提交 |
| **B** | 写基础设施收口     | `enrichWriteResponse` 移除 `patchRowIds` / `rowId` SELECT                                      | `test_event_write_path.py`（`write-response` 无 patchRowIds）      | ✅ 待提交 |
| **C** | read-shim 在线隔离 | `readLocalQuery()`；`readUseRc()` 基于 `useOnlineDataPath()`                                   | `test_read_shim_online_guard.py`                                   | ✅ 待提交 |
| **D** | 双轨语义收紧       | 在线分支统一 `useOnlineDataPath()`；削减 `isLocalForceDb()`（**25 → 16 模块**）                | `test_sql_js_debt_inventory.py`、`test_online_query_boundaries.py` | 进行中    |
| **E** | sql.js 边界        | `file://` 废弃；`db.js` 仅 `KETANG_FORCE_LOCAL_DB` / 灾备；wasm 移出发布白名单                 | `test_cdp_migration.py`、migration CI job                          | 待办      |
| **F** | SLO 固化           | `probe-admin-write.yml` + `prod-latency.yml`；`--enforce-thresholds` 发布前必跑                | `test_admin_write_timing_stages.py`                                | 部分      |

**Phase D 剩余模块**（2026-07-05 inventory，按 `isLocalForceDb()` 次数）：

| 模块                  | 次数 | 说明                                        |
| --------------------- | ---- | ------------------------------------------- |
| `events.js`           | 5    | 在线已 `rc*`；本地写/导入分支               |
| `lodger-actions.js`   | 5    | 挂单写路径本地守卫                          |
| `checkin.js`          | 3    | CSV / 本地批量入住                          |
| `forecast.js`         | 3    | 本地预测 query                              |
| `history.js`          | 3    | 本地历史 query                              |
| `housekeeping.js`     | 3    | 本地房务写                                  |
| `reservations.js`     | 3    | 本地预约写                                  |
| `api-client.js`       | 2    | `useOnlineDataPath` / `isLocalForceDb` 定义 |
| `db.js`               | 2    | 本地 DB 生命周期                            |
| `meals.js`            | 2    | 本地用斋写                                  |
| `auth.js`             | 1    | 本地登录/导入                               |
| `guests.js`           | 1    | 本地 guest 写                               |
| `permissions.js`      | 1    | 本地权限加载                                |
| `read-cache.js`       | 1    | 本地 seed                                   |
| `rooming-read.js`     | 1    | 本地排房读                                  |
| `sync-coordinator.js` | 1    | 本地 sync                                   |

**Phase D 波次建议**：

1. 叶模块（guests、permissions、rooming-read、sync-coordinator）— 仅守卫本地写。
2. 业务热路径（checkin、lodger-actions、meals、housekeeping、reservations）。
3. 重 query 模块（events、history、forecast）— 在线已 `rc*`，压缩 local 分支体积。
4. 核心（auth、db.js、api-client 定义处）— 用户管理与本地 DB 生命周期最后收。

#### 19.8.3 守门测试矩阵（Phase 13 legacy）

| 测试                                | 覆盖                                                              |
| ----------------------------------- | ----------------------------------------------------------------- |
| `test_no_api_db_client.py`          | 客户端零 `/api/db`；`db.js` 全 410；write-response 无 SELECT 回读 |
| `test_db_sql_gateway_retired.py`    | SQL 网关 / login 退役；v1 audit / change-password                 |
| `test_sql_js_debt_inventory.py`     | `isLocalForceDb()` 上限只减不增；`useOnlineDataPath` 契约         |
| `test_online_query_boundaries.py`   | Phase D 在线路径无裸 `query()`                                    |
| `test_event_write_path.py`          | 热路径 `patchRows`；禁止 `patchRowIds`                            |
| `test_admin_write_timing_stages.py` | admin 分段计时；v1 登录探针                                       |
| `test_migration_hot_path.py`        | 生产热路径零 DDL                                                  |
| `test_headless.py`                  | 在线壳渲染                                                        |

#### 19.8.4 明确不做（仍属 P4，非 legacy 清理）

- D1 只读副本、DO WebSocket、Normalized Store：见 §19.7.4，**不纳入 §19.8 必做项**。
- 全寺 ERP / 外部 SaaS / Electron 打包：见 §18。

#### 19.8.5 完成定义（Phase 13 legacy Done）

1. 客户端与 `functions` 热路径零 `/api/db`、零 `patchRowIds`。
2. 在线 `read-shim` 零 `query()`；`test_online_query_boundaries` 全绿。
3. `isLocalForceDb()` 模块数 **≤ 12**（仅 db-local + migration 必需路径；当前 16）。
4. 发布产物无 `sql-wasm`；在线 boot 不加载 sql.js。
5. 文档同步：`migration-request-lifecycle.md`、`cloudflare-online-mode.md`、本路线图 §19.7–19.8。

### 19.9 图表引擎迁移（Chart.js → ECharts，2026-07-05）

**策略：** Phase A「不换库高收益优化」作为 ECharts 迁移**前置基础层**（非迁移后附加项）。详见 [chart-engine-migration.md](architecture/chart-engine-migration.md)。

| 阶段 | 内容 | 状态 |
| ---- | ---- | ---- |
| **A** | 实例复用、rAF 更新队列、延迟挂载、性能埋点 | ✅ 完成（`chart-theme.js` v8） |
| **B** | ECharts adapter、`chart_engine` / pilot keys 开关、配置转换 | ✅ 主体完成 |
| **C** | 单图 PoC（`events-progress` 营期招生进度柱图） | ✅ 完成 |
| **D–G** | 页面灰度 → 看板核心 → ECharts 增强 → 默认切换与 Chart.js 清理 | 待办 |

**Phase A 已落地要点：**

- `upsertKetangChart`：同 key 复用 + 同帧合并更新，避免每次 render destroy/new
- `ketangChartDeferred` + `mountKetangChartsInRoot`：非 active 视图 / 隐藏 tab 不 init
- `getKetangChartPerfSummary()`：init/update/destroy/reuse/defer 计数，供 C 阶段 A/B 对比

**Phase C PoC（`events-progress`）：** `?chart_engine=echarts&chart_pilot_keys=events-progress`；canvas 自动挂载 `.ketang-echart-host`；横向堆叠柱已映射。验收：`test_chart_infra.py` + `test_headless.py` 全绿。

**明确后置（Phase F，现在不做）：** dataZoom、图表联动、progressive 大数据渲染。

### 19.6 最终总验收（排期最后执行）

在 **Phase 9、Phase 4** 等功能项收尾后，集中执行以下清单（含原 P1-1）：

1. **多人协同**：两端同时登录，入住/换床/退房/房务/用斋/历史/CSV 导出。
2. **并发占床**：同一床位并发分配，确认仅一人成功。
3. **房态刷新**：board-version 轮询与写后 forceSync 及时性。
4. **权限矩阵**：各角色菜单、按钮、API 403 与管理员配置一致。
5. **备份恢复**：导出 JSON → 恢复演练 → 主流程抽查。
6. **发布安全**：白名单产物 + 敏感路径 404/403 + 核心静态资源可用。
7. **性能基线**：登录、read-model（含 304）、board-version 耗时记录。

通过后方可视为正式版上线就绪（对外大规模使用、长期运维基线冻结）。
