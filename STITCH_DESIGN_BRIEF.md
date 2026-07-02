# 客堂管理系统 — Stitch 设计稿规范

> **用法**：打开 [stitch.withgoogle.com](https://stitch.withgoogle.com) → 新建项目 → 先粘贴「Step 0 设计系统」→ 再逐屏粘贴 Step 1–9。
> 模型建议：**Gemini 3.1**（布局更准）；设备选 **Desktop 1440×900**。
> 本项目为**中文寺院客堂 PMS**，非 SaaS 仪表盘。

---

## Step 0 — 设计系统（整项目先跑这一条）

```
Design system for "客堂管理系统" — Chinese Buddhist temple guest house PMS.
Theme: 宣纸墨韵 Xuan Paper & Ink. Solemn, warm, minimal. NOT a generic SaaS dashboard.

COLORS (strict):
- Primary vermilion pillar: #a64b3f
- Background warm apricot wall: #fff8f0
- Surface soft sand floor: #e3d9c6
- Text deep wood: #3d3028
- Muted text: #6a5e52
- Sidebar dai cyan: #3a4f52
- Accent dai light: #4a6266
- Border wood line: #d4c9b4
- Partial room ochre: #8a7340

TYPOGRAPHY:
- Chinese UI: PingFang SC / Microsoft YaHei
- Base 15px, section titles 19px with letter-spacing 0.1em
- Large touch targets min 44px height for elderly temple staff

LAYOUT SHELL (all screens):
- Fixed left sidebar 240px, dai cyan #3a4f52 background
- Sidebar: app title "客堂管理系统" top, 8 nav items, theme toggle "明暗" bottom
- Active nav: vermilion #a64b3f left border 3px, subtle red tint background
- Main content: warm apricot #fff8f0 full bleed background
- Cards: slightly lighter #fffcf7 on apricot, 1px border #d4c9b4, NO drop shadows
- Section titles: deep wood text + 2px vermilion underline
- Primary button: filled vermilion. Secondary: outline only (wood border). Danger: vermilion outline or fill for delete only.
- Stats/KPI blocks: soft sand #e3d9c6 background, numbers in vermilion
- Tables: sand header row, generous row height (名册感), no zebra stripes
- Tags 男寮/女寮: transparent background, outline only (male=dai border, female=vermilion border)
- Room status cards: apricot card + 3px left accent line (dai=empty, ochre=partial, vermilion=full)
- NO emoji, NO gradients, NO glassmorphism, NO purple/blue SaaS colors

Generate a component board showing: sidebar, stat card, section title, primary/secondary button, table row, room card, male/female tag, modal, toast.
Language: Simplified Chinese labels throughout.
```

---

## Step 1 — 房态看板（Board）

```
Screen: 房态看板 — temple guest house room status dashboard.
Use the 客堂管理系统 design system above. Desktop 1440px.

LAYOUT REFACTOR:
1. Top: horizontal KPI strip — 6 stat cards in one row (总床位24, 已住, 空床, 在住人数, 脏房, 今日预约). Sand #e3d9c6 cards, vermilion numbers.
2. Below KPI: 3 equal reminder panels in a row — 今日应退 / 明日应退 / 已超期. White/apricot cards with LEFT accent line only (ochre / dai / vermilion). List names inside, not full colored blocks.
3. Optional thin backup warning banner (ochre left line, not yellow block).
4. MAIN AREA (60% visual weight): 房态一览 — grid of room cards 101–203, 2 beds each. Each card shows room number, 男寮/女寮 outline tag, floor, bed lines. Left status line on card.
5. RIGHT or BELOW: compact 今日用斋 — 3 small sand stat boxes (早/午/晚).
6. BOTTOM: 在住挂单 table — simplify actions to 2 visible buttons + "更多" dropdown (用斋/续住/换床/退房/编辑/凭证/删除). Sticky table header.

Sidebar: "房态看板" active.
Sample data in Chinese. Empty states show "无" gracefully.
```

---

## Step 2 — 挂单登记（Check-in）

```
Screen: 挂单登记 — guest check-in registration form.
Design system: 宣纸墨韵. Desktop wide layout.

LAYOUT REFACTOR:
- Split main card into TWO COLUMNS on desktop:
  LEFT (60%): 基本信息 — 姓名*, 法名, 性别*, 手机, 身份证, 分配床位* (tree picker dropdown mock), 身份, 入住日期*, 预计离院, 来源, 团体批次, 紧急联系人/电话, 备注
  RIGHT (40%): 收款信息 — 押金, 房费, 收款方式, 收款备注 + 用斋默认 checkboxes (早/午/晚)
- Bottom sticky bar: primary "办理入住" vermilion + secondary "清空" outline
- SECOND CARD below (collapsible): 批量导入 CSV — short description, 3 meal checkboxes, buttons "选择 CSV" + "下载模板"

Bed picker UI: show collapsed trigger "请选择床位 ▾" and one expanded mock with room groups (🟢 101 男寮, beds listed).
Form fields: large inputs, sand border, dai focus ring.
No wizard steps — single page but clearly grouped with subtle sand section backgrounds.
```

---

## Step 3 — 预约管理（Reservations）

```
Screen: 预约管理 — reservation management.
Design system: 宣纸墨韵.

LAYOUT REFACTOR:
- TOP CARD: compact add-reservation form — 2-row grid (姓名, 法名, 性别, 手机, 身份证, 身份, 预计入住, 预计离院, 房间偏好, 批次, 来源, 备注). Primary "添加预约" + "清空".
- BOTTOM CARD (dominant): 预约列表
  - Filter pill bar: 全部 | 预约 | 已确认 | 已入住 | 已取消 | No-show (outline pills, active=vermilion fill)
  - Table with status as small outline badge (not bright colors)
  - Row actions: 确认 | 转入住 | 取消 | No-show as compact outline buttons

Show 3 sample rows with varied status.
Sidebar: "预约管理" active.
```

---

## Step 4 — 房务清洁（Housekeeping）

```
Screen: 房务清洁 — housekeeping / room cleaning workflow.
Design system: 宣纸墨韵.

LAYOUT REFACTOR:
- Short intro line explaining 脏房→净房→查房→可用 flow
- Grid of bed cards (same width as room grid): each shows "101 / 1号床", 房务状态 badge (脏房/净房/查房/可用/维修), occupant or 无人
- Action buttons per card as small outline buttons contextual to state:
  脏房→"已净房" | 净房→"查房" | 查房→"可入住" | optional "报修"
- Status badge colors: text-only with colored left dot (dai/ochre/vermilion), not full background fills

Show mix of 6 bed cards in different states.
Sidebar: "房务清洁" active.
```

---

## Step 5 — 报表（Reports）

```
Screen: 报表中心 — reports hub.
Design system: 宣纸墨韵.

LAYOUT REFACTOR (important — replace 3 stacked duplicate cards):
- TOP: horizontal TAB bar — 用斋汇总 | 日报 | 月报 (vermilion underline on active tab)
- ONE content panel below that changes by tab:

TAB 1 用斋汇总: date picker + 查询 + 导出 CSV. Result: two sand-background tables side by side — 按身份 / 按房间 (people, 早斋, 午斋, 晚斋).

TAB 2 日报: date picker. Sections: 今日入住名单 table, 今日退房名单, 在住人数, 空床数 — each with sand header.

TAB 3 月报: month picker. Table: 日期 | 入住 | 退房 | 在住峰值.

Sidebar: "报表" active.
Only show Tab 1 content in the mockup but show tab bar for all three.
```

---

## Step 6 — 历史查询（History）

```
Screen: 历史挂单查询 — historical lodger search.
Design system: 宣纸墨韵.

LAYOUT REFACTOR:
- STICKY filter bar at top of card (sand background): 开始日期, 结束日期, 关键字, 房间号, 身份 dropdown
- Buttons: 查询 (vermilion) + 重置 (outline)
- Full-width scrollable table below with columns: 床位, 姓名, 法名, 身份, 性别, 手机, 入住日, 预离日, 实际离院, 状态, 用斋, 备注, 操作(删除)
- Show 5 sample rows, one 已退房 one 在住
- Empty state: centered "无匹配记录" in muted wood text

Sidebar: "历史查询" active.
```

---

## Step 7 — 信息管理（Info）

```
Screen: 信息管理 — master data admin (rooms, beds, guests, lodgers).
Design system: 宣纸墨韵.

LAYOUT REFACTOR:
- Horizontal text tabs (not pills): 房间管理 | 床位管理 | 住客档案 | 挂单记录
- Active tab: vermilion bottom border

TAB MOCK — 房间管理:
- Top right: "+ 添加房间" vermilion button
- Table: 编号, 房间名, 位置, 楼层, 性别, 男寮/女寮, 备注, 操作(编辑/删除)
- 4 sample rows

Also show faint ghost outline of tabs 2-4 labels to indicate structure.
Sidebar: "信息管理" active.
```

---

## Step 8 — 数据备份（Backup）

```
Screen: 数据备份与恢复 — data backup.
Design system: 宣纸墨韵.

LAYOUT REFACTOR:
- Hero section centered: short paragraph about local browser storage
- 3 LARGE action buttons in a row (equal width, min 48px tall):
  1. "导出 ketang.db" — vermilion filled (primary)
  2. "导出 CSV 台账" — outline
  3. "从文件恢复" — outline ochre/warning border
- Below: sand card "每日备份三步" numbered list 1-2-3 with ketang.db monospace
- Calm, trustworthy, no alarm colors except subtle warning on restore button

Sidebar: "数据备份" active.
```

---

## Step 9 — 弹窗组件（Modals）

```
Component sheet: 3 modal dialogs for 客堂管理系统, design system 宣纸墨韵.
Centered modal on dimmed overlay rgba(61,48,40,0.42). Apricot card, wood border.

MODAL A — 续住: title "续住 - 张三", current bed + date, date picker 新预计离院, button 确认续住

MODAL B — 用斋管理: title "用斋管理", 3-column grid of days with 早/午/晚 checkboxes (7 days), 保存用斋 button

MODAL C — 挂单凭证打印: voucher layout black border, centered 客堂挂单凭证, rows 姓名/法名/床位/入住/预离, print button

All Chinese. Minimal decoration. Large close × top right.
```

---

## Stitch 操作顺序建议

| 顺序 | 动作                                                                 | 产出            |
| ---- | -------------------------------------------------------------------- | --------------- |
| 1    | 粘贴 Step 0                                                          | 组件板 + 色板   |
| 2    | Step 1–8 各生成一屏                                                  | 8 个桌面页面    |
| 3    | Step 9                                                               | 弹窗组件        |
| 4    | 选中 Step 0 组件板 + Step 1 → **Redesign / Make consistent**         | 统一视觉        |
| 5    | **Paste to Figma**                                                   | 给法师/义工评审 |
| 6    | 导出截图或 HTML **仅作参考**，最终落地改 `styles.css` + `index.html` |

---

## 布局重构要点（给评审看）

| 页面     | 现况问题             | Stitch 目标                    |
| -------- | -------------------- | ------------------------------ |
| 房态看板 | 表格操作按钮过多占行 | 房态网格为主，操作收进「更多」 |
| 挂单登记 | 单列表单过长         | 双栏 + 底栏固定提交            |
| 报表     | 三块重复卡片         | **Tab 切换** 一屏一类报表      |
| 预约     | 表单+列表割裂感      | 上简下详，状态 Pill 筛选       |
| 信息管理 | Tab 样式未定型       | 文字 Tab + 标准 CRUD 表        |
| 备份     | 按钮视觉权重不清     | 三大操作并列 Hero              |

---

## 验收清单（Stitch 稿完成后）

- [ ] 8 个导航项各有一屏，侧栏高亮正确
- [ ] 主色 #a64b3f、背景 #fff8f0、柔沙 #e3d9c6 一致
- [ ] 无 emoji、无 SaaS 蓝紫渐变
- [ ] 控件高度 ≥44px，中文标签完整
- [ ] 房态/提醒用左线而非色块
- [ ] 报表页为 Tab 布局（非三卡片堆叠）

---

**维护**：色谱或页面增删时同步改本文与 `DESIGN.md`。
