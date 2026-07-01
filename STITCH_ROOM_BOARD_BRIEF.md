# 房态分布 · Stitch 重设计需求稿

> **用途**：在 [stitch.withgoogle.com](https://stitch.withgoogle.com) 中，**仅重设计「房态看板」里的「房态分布」区块**（其余 KPI / 运营动态 / 用斋 / 在住挂单保持现有 Stitch 壳层不变）。
>
> **设备**：Desktop **1440×900**；模型建议 **Gemini 3.1**。
>
> **设计系统**：沿用项目「宣纸墨韵」，与 `STITCH_DESIGN_BRIEF.md` Step 0 一致（朱红 `#a64b3f`、暖杏 `#fff8f0`、柔沙 `#e3d9c6`、深木 `#3d3028`、黛青 `#3a4f52`）。

---

## 1. 背景与问题（Why）

### 1.1 产品场景

客堂住宿系统是**寺院本地 PMS**，知客师/义工在单屏上需要：

1. **扫视**全寺房态（哪间空、哪间满、哪间脏）
2. **定位**某位居士所在房间/床位
3. **点击**进入入住、换床、退房等操作（详情可交给下方「在住挂单」或展开面板）

### 1.2 当前实现的问题（必须解决）

| 问题                 | 表现                                                                                         | 影响                                    |
| -------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------- |
| **卡片过高**         | 每间房同时展示：房号 + 寮标签 + 状态文案 + 进度条 + 迷你方块 + **完整床位行（床1 张居士…）** | 12 间房需滚动 2～3 屏，无法「一屏全览」 |
| **信息重复**         | 迷你床位点阵与下方床位文字列表表达同一信息                                                   | 视觉噪音大、占垂直空间                  |
| **栅格过宽**         | `minmax(200px, 1fr)`，每行仅 3～4 张卡                                                       | 横向空间利用率低                        |
| **分组标题占行**     | 「客堂1楼 · 6 间房」+ 图例重复占高                                                           | 房态区「头重脚轻」                      |
| **与挂单表功能重叠** | 卡片内展示居士姓名，下方表格又列一遍                                                         | 房态区应偏「地图」，表格偏「名册」      |

### 1.3 设计目标（Success）

- **默认态（折叠）**：在 1440×900 视口内，**房态分布区块 + 上方 KPI/运营/用斋 + 下方挂单表首 3 行**尽量同屏可见；12 间 × 2 床**无需滚动**即可扫完全部房间。
- **信息密度**：单间房「折叠态」高度 **≤ 64px**，宽度 **72～96px**（6～8 列网格）。
- **可操作性**：折叠态可点击；展开态可看到床位明细与快捷操作，**不强制跳转整页**。
- **可扩展**：支持 24～48 间房（6～12 列自适应），仍保持紧凑。

---

## 2. 数据与业务约束（Must respect）

### 2.1 实体关系（设计稿需体现，不必写 SQL）

```
区域 location（如 客堂1楼、客堂2楼）
  └─ 房间 room（房号 101、102…）
       └─ 床位 bed（床1、床2…，每床 0～1 在住居士）
            └─ 房务状态 housekeeping（净房 / 脏房 / 维修）
```

### 2.2 分组方式

- **主分组**：按 `location`（楼层/院落），标题示例：`客堂1楼` · `6 间`
- **次标签**：每间房角标 **男寮 / 女寮 / 不限**（线框小 tag，非大色块）
- 不要求 Stitch 稿画「男寮院 / 女寮院」大段标题（与 location 分组二选一即可；**推荐 location**）

### 2.3 房间 / 床位状态（4 类 + 子状态）

| 房间级状态    | 判定                     | 折叠态视觉                                     |
| ------------- | ------------------------ | ---------------------------------------------- |
| **空房**      | 0 床在住，无脏/维修      | 左线灰 `#c4b59a`；床位点全空 ○                 |
| **部分入住**  | 0 < 在住 < 总床          | 左线朱红 `#a64b3f`；●○ 混合                    |
| **满房**      | 在住 = 总床              | 左线朱红；全 ●                                 |
| **脏房/维护** | 任一空床为脏房，或床维修 | 左线黛青 `#3a4f52`；脏床用深青 ● 或小扫帚 icon |

床位级（展开态才显示姓名）：

| 床位     | 折叠态        | 展开态                            |
| -------- | ------------- | --------------------------------- |
| 空闲净房 | ○             | 「床1 · 空 · 净房」+ [快捷入住]   |
| 在住     | ● 朱红        | 「床1 · 张居士」+ 今日退/用斋摘要 |
| 脏房     | ● 黛青        | 「床2 · 清洁中」                  |
| 维修     | ● 黛青 + 扳手 | 「床2 · 维修中」                  |

### 2.4 样例数据（Stitch 必须画满）

**客堂1楼（6 间，男寮/女寮混合）**

| 房号 | 寮   | 床1    | 床2    | 房间态 |
| ---- | ---- | ------ | ------ | ------ |
| 101  | 男寮 | 张居士 | 空     | 部分   |
| 102  | 男寮 | 王居士 | 清洁中 | 脏房   |
| 103  | 男寮 | 空     | 空     | 空房   |
| 104  | 女寮 | 李居士 | 孙居士 | 满房   |
| 105  | 女寮 | 空     | 空     | 空房   |
| 106  | 女寮 | 赵居士 | 空     | 部分   |

**客堂2楼（6 间）** — 至少画 3 间示意即可，其余用「…」省略格

### 2.5 不在房态区展示的内容

- 手机号、身份证、押金
- 完整用斋日历
- 多按钮操作条（退房/续住/换床 → 交给展开面板或下方挂单表）

---

## 3. 布局方案（Stitch 请出 2 个 Variant + 1 个推荐）

### Variant A — **缩略图网格（推荐）**

```
┌─ 房态分布 ─────────────────── ○空 ●住 ●脏  男寮 女寮 ─┐
│ ▎客堂1楼 · 6 间                                      │
│ ┌────┬────┬────┬────┬────┬────┬────┬────┐            │
│ │101 │102*│103 │104 │105 │106 │    │    │  8列网格  │
│ │●○  │●●  │○○  │●●  │○○  │●○  │    │    │  56px高   │
│ └────┴────┴────┴────┴────┴────┴────┴────┘            │
│ ▎客堂2楼 · 6 间                                      │
│ ┌────┬────┬────┬──── … ────┐                         │
└──────────────────────────────────────────────────────┘

*102 右上角 12px 扫帚 icon 表示脏房
```

- 折叠格内容：**房号（13px 加粗）+ 寮 tag（10px 线框）+ 床位点阵（8px 圆点，横排，最多 4 点，超出 +N）**
- **禁止**在折叠格内写居士姓名
- 区域标题行高 ≤ 32px；图例与标题**同一行**右对齐

### Variant B — **横向床位条（备选一屏两列）**

每行 2 间房并排，每间宽 ~50%，高度 ~48px：左侧房号竖条 + 右侧仅 `●○` 与 `2/2` 数字。适合房名很长的寺院；默认仍优先 Variant A。

### 展开态（两 Variant 共用）

点击某房间后，在**网格下方插入一行**展开面板（非全屏 Modal）：

```
┌─ 101 · 男寮 · 客堂1楼 ──────────────── ✕ 关闭 ─┐
│ ● 床1  张居士   今日退 · 早午斋    [挂单详情]   │
│ ○ 床2  空闲 · 净房                 [快捷入住]   │
└─────────────────────────────────────────────────┘
```

- 展开面板高度 **≤ 120px**（2 床）；4 床 **≤ 200px**
- 同时只展开 **1 间**；再点其他房间切换；点 ✕ 或空白收起
- 展开时**不推动**下方「在住挂单」出视口超过半屏（面板用 sticky 或 max-height + 内部滚动）

---

## 4. 视觉规格（Stitch 像素级）

### 4.1 区块容器

| 属性           | 值                                                          |
| -------------- | ----------------------------------------------------------- |
| 区块标题       | 「房态分布」+ meeting_room icon；Noto Serif SC 18px 粗      |
| 图例           | 与标题同一行右侧：□空闲 ■在住 ■脏房 + 男寮/女寮 outline tag |
| 内边距         | 上 16 / 左右 24 / 下 16                                     |
| 背景           | `#fffcf7` 卡片 + 1px `#d4c9b4` 边框                         |
| 与上下模块间距 | 24px                                                        |

### 4.2 折叠房间格（Room Thumb）

| 属性             | 值                                                    |
| ---------------- | ----------------------------------------------------- |
| 最小宽度         | 72px                                                  |
| 最大宽度         | 1fr（8 列 @1440）                                     |
| 高度             | **56px 固定**                                         |
| 内边距           | 8px                                                   |
| 圆角             | 4px                                                   |
| 左边状态线       | 3px，贴左，圆角 2px                                   |
| 房号             | 14px Noto Serif SC 600                                |
| 寮 tag           | 10px Source Sans 3，outline，男=黛青边 / 女=朱红边    |
| 床位点           | 8px 圆；间距 4px；空=描边圆，住=朱红实心，脏=黛青实心 |
| Hover            | 边框朱红 35% + translateY(-1px)                       |
| Selected（展开） | 外框 2px 朱红                                         |

### 4.3 密度档位（需在稿中标注）

| 档位             | 列数 @1440 | 适用           |
| ---------------- | ---------- | -------------- |
| 舒适             | 6 列       | ≤18 间，字更大 |
| **标准（默认）** | **8 列**   | **12～32 间**  |
| 紧凑             | 10 列      | ≥36 间         |

Stitch 主稿用 **8 列标准**；另附一帧 **6 列舒适** 对比。

---

## 5. 交互说明

| 操作                     | 行为                                                                      |
| ------------------------ | ------------------------------------------------------------------------- |
| 点击折叠格               | 展开/切换下方详情条；已展开则收起                                         |
| Hover 床位点             | Tooltip：`床1 · 张居士` 或 `床2 · 空`                                     |
| 点击展开条「快捷入住」   | 示意跳转「入住登记」并预选该床（稿中可标注）                              |
| 点击展开条「挂单详情」   | 打开现有「更多操作」弹窗（稿中可画 Modal 缩略）                           |
| 顶栏搜索「张居士 / 101」 | 匹配房间格 **高亮描边**，非匹配 **降低 opacity 40%**（稿中画 101 高亮态） |
| 键盘                     | 非必须；若有，Tab 在房间格间移动                                          |

---

## 6. 与看板其他模块的关系

```
┌ KPI 6 项 ─────────────────────────────┐  保留现有 Stitch 稿
├ 运营动态 + 退房 Tab ─────────────────┤  保留
├ 今日用斋横条 ────────────────────────┤  保留
├ ★ 房态分布（本需求重设计）───────────┤  ← 变紧凑
├ 在住挂单表格 ────────────────────────┤  保留；姓名/操作以表为准
└──────────────────────────────────────┘
```

- 房态区负责 **空间分布**；挂单表负责 **名册与批量操作**
- 避免两处同时展示完整姓名列表

---

## 7. 边界与异常态（Stitch 各画 1 个小样）

| 场景             | 展示                                             |
| ---------------- | ------------------------------------------------ |
| 0 间房           | 区块内居中「尚未配置房间，请前往基础设置」+ 链接 |
| 单床房间         | 仅 1 个床位点                                    |
| 4 床大通铺       | 4 个点；折叠格可显示 `●●○●`                      |
| 40+ 床（大通铺） | 折叠格显示 `●×12 ○×28` 或 `12/40` 数字代替点阵   |
| 全部满房         | 左线均为朱红，无灰格                             |
| 搜索无结果       | 网格区「无匹配房间」                             |

---

## 8. 明确不做（Out of scope）

- 不改侧栏 / 顶栏 / KPI / 运营动态 / 用斋 / 挂单表布局
- 不做 floor plan 平面图、拖拽换床
- 不用 emoji；不用 SaaS 蓝紫渐变
- 不用 Tailwind CDN 风格；输出为静态视觉稿即可

---

## 9. Stitch 粘贴 Prompt（直接复制）

### Step 0 — 先确认设计系统（若已有项目可跳过）

```
Use existing 客堂住宿系统 design system: 宣纸墨韵 theme.
Colors: primary #a64b3f, background #fff8f0, surface #e3d9c6, text #3d3028, sidebar #3a4f52.
Typography: Noto Serif SC titles, Source Serif 4 body, Source Sans 3 labels.
Fixed sidebar 240px + top bar "客堂大盘" already designed — DO NOT redesign shell.
```

### Step 1 — 房态分布重设计（主任务）

```
Redesign ONLY the "房态分布" section on the 房态看板 screen (1440px desktop).

PROBLEM: Current room cards are too tall (200px+ each) because each card shows full bed rows with guest names, progress bars, and duplicate mini indicators. Users must scroll 2-3 screens to see 12 rooms.

GOAL: At-a-glance room map. All 12 rooms visible without scrolling inside this section. Collapsed room cell height 56px fixed, 8-column grid.

COLLAPSED ROOM CELL (default):
- 72-96px wide, 56px tall, apricot card #fffcf7, 1px border #d4c9b4
- 3px left accent: gray=empty, vermilion=occupied, dai cyan=dirty/maintenance
- Top: room number bold (101), tiny outline tag 男寮 or 女寮
- Bottom: horizontal bed dots only (8px): hollow=empty, vermilion fill=occupied, dai fill=dirty
- NO guest names in collapsed state
- Dirty room: small cleaning icon top-right corner

GROUPING:
- Section headers by location: "客堂1楼 · 6 间" with left vertical rule, 32px row height
- Legend inline with section title row: 空闲 / 在住 / 脏房 + 男寮 女寮 outline tags

EXPANDED STATE (when one room clicked):
- Inline panel below grid (NOT modal): shows bed list with names and actions
- Example 101: 床1 张居士 今日退 [详情] | 床2 空 净房 [快捷入住]
- Max height 120px for 2-bed room; close X on right

SAMPLE DATA: 6 rooms on 客堂1楼 (101 partial, 102 dirty, 103 empty, 104 full, 105 empty, 106 partial) + 3 rooms hint on 客堂2楼.

Also show: search highlight state (room 101 outlined when searching "张"), empty state, 4-bed room variant.

Keep KPI strip, 运营动态, 今日用斋, 在住挂单 table UNCHANGED from previous board design.

Language: Simplified Chinese. No emoji. Touch targets in expanded panel min 44px.
```

### Step 2 — 出两版对比（可选）

```
Create Variant B of the same 房态分布 section: 6-column "comfort" grid with slightly larger cells (64px height, 14px room numbers). Place Variant A (8-col) and Variant B side by side for comparison. Same data, same expand panel behavior.
```

---

## 10. 验收清单（Stitch 完成后）

- [ ] 12 间房在 **1440 宽**下于「房态分布」区块内 **无纵向滚动**即可看全
- [ ] 折叠态 **无居士姓名**，仅点阵 / 图标
- [ ] 展开态含床位明细 + 至少 2 个操作入口
- [ ] 4 种房间状态 + 脏房 icon 均有样本
- [ ] 男寮/女寮为 **线框 tag**，非大块底色
- [ ] 与现有看板壳层（侧栏/顶栏/KPI/表格）视觉一致
- [ ] 提供 **8 列标准** + **6 列舒适** 至少一帧
- [ ] 标注折叠格尺寸：**56×72px 起**

---

## 11. 落地开发备注（给实现阶段，Stitch 可忽略）

- 实现文件：`index.html` `#room-grid`、`js/app.js` `renderRooms()`、`styles.css` `.room-grid` / `.room-card`
- 折叠/展开状态：`data-room-id` + `.room-thumb` / `.room-detail-panel`
- 搜索高亮：复用 `handleBoardSearch()`
- 参考内部草案：`docs/room-board-redesign.md`

---

**维护**：Stitch 定稿后，将选定 Variant 截图链接或 Figma 地址补在本文件末尾，并更新 `STITCH_DESIGN_BRIEF.md` Step 1 的房态描述。
