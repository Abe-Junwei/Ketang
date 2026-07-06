# 图表引擎迁移规划（Chart.js → ECharts）

> **状态：** Phase A–G 已完成（2026-07）；默认 ECharts，Chart.js 灾备  
> **原则：** Phase A 的「不换库高收益优化」是 ECharts 迁移的**前置基础层**，不是迁移后的附加项  
> **封装入口：** `js/chart-theme.js`（`createKetangChart` / `createKetangRingChart` / `createKetangPieChart`）

---

## 1. 为什么要先做 Phase A

若直接切 ECharts，很多性能问题只是换库继续存在（重复 destroy/new、同步连刷多张图、非首屏 canvas 提前 init）。

先把 Chart.js 的生命周期、节流、延迟挂载做好，后续 ECharts 适配层可直接映射为 `setOption`，且**即使最终不全量迁 ECharts，Phase A 也已实打实提升当前系统**。

---

## 2. 阶段总览

| 阶段 | 名称 | 目标 | 状态 |
| ---- | ---- | ---- | ---- |
| **A** | Chart.js 封装性能优化 | 实例复用、更新队列、延迟挂载、性能埋点 | ✅ 完成 |
| **B** | ECharts 适配层与开关 | 双引擎 adapter、URL/localStorage 切换、pilot keys | ✅ 完成 |
| **C** | 单图 PoC | 一张低风险柱状图双引擎验收 | ✅ 完成（`events-progress`） |
| **D** | 页面灰度 | 报表/预测/营期/看板柱图 | ✅ 完成 |
| **E** | 看板核心 | 环图、饼图、容量折线 | ✅ 完成 |
| **F** | ECharts 增强 | dataZoom、同页联动 | ✅ 完成 |
| **G** | 默认切换 | 默认 ECharts + Chart.js 灾备 | ✅ 完成 |

---

## 3. Phase A：Chart.js 基础设施（不换库）

### A1. 避免重复销毁重建 ✅

**实现：** `canReuseKetangChart` / `canReuseKetangEchart` + `upsertKetangChart`

- 同 key、同 canvas、同 type：复用实例，更新 `data/options`（Chart.js 走 `scheduleKetangChartUpdate` → `chart.update("none")`）
- type 变化或 canvas 断开：才 `destroy` 后重建
- ring / pie / bar 分别保留 `createKetangRingChart` / `createKetangPieChart` 的 prepare 逻辑

**收益：** 切页、筛选、SSE/轮询刷新时减少主线程抖动；ECharts 侧映射为 `setOption`。

**守门：** `test_chart_infra.py` 禁止 `destroyKetangChart(key); var merged` 每次 render 模式。

### A2. 统一图表更新队列 ✅

**实现：** `ketangChartUpdateQueue` + `scheduleKetangChartUpdate`（`requestAnimationFrame`）

- 同 key 同帧只保留最后一次更新
- 避免同步刷新时连续 render 多张图

**收益：** SSE/轮询触发刷新更稳；为 ECharts `setOption` 合并打基础。

### A3. 图表延迟挂载 ✅

**实现：** `isKetangChartElementVisible` + `ketangChartDeferred` + `IntersectionObserver` + `mountKetangChartsInRoot`

- 非 `.view.active`、祖先 `display:none`、零尺寸 canvas：**不** `new Chart` / `echarts.init`，只缓存 pending config
- 视图切换（`showView`）、预测 tab 切换（`renderForecastTab`）主动 flush
- 已存在实例的 hidden 视图仍允许 update（只 defer **首次 init**）

**典型场景：** 后台 SSE 触发 `renderBoard()` 时用户在其他视图；报表/预测/营期非首屏图。

### A4. 图表性能埋点 ✅

**实现：** `ketangChartPerf` + `getKetangChartPerfSummary()`

| 指标 | 含义 |
| ---- | ---- |
| `initCount` / `lastInitMs` / `totalInitMs` | 新建实例 |
| `updateCount` / `lastUpdateMs` / `totalUpdateMs` | 复用更新 |
| `destroyCount` | 销毁次数 |
| `reuseCount` | 复用命中 |
| `deferCount` / `flushCount` | 延迟挂载队列 |

**用途：** Phase C 起对比 Chart.js vs ECharts 耗时，不靠主观感受。

---

## 4. Phase B：ECharts 适配层 ✅（主体）

### 4.1 对外接口（保持不变）

- `createKetangChart` / `createKetangRingChart` / `createKetangPieChart`
- `destroyKetangChart` / `destroyKetangChartsByPrefix`
- `getChartTheme` / `getChartPalette` / `chartLegendHtml` / `chartBoxHtml`

### 4.2 引擎切换

| 方式 | 说明 |
| ---- | ---- |
| `?chart_engine=echarts` | URL 临时切换 |
| `localStorage.ketang_chart_engine` | 持久偏好 |
| `window.KETANG_CHART_ENGINE` | 运行时 |
| `?chart_pilot_keys=key1,key2` / `window.KETANG_ECHARTS_PILOT_KEYS` | 按 chart key 灰度 |

**回退：** ECharts 未加载 → `console.warn` 一次 → 自动 Chart.js。

### 4.3 配置转换

`chartJsConfigToEchartsOption(merged, mode)` — bar / pie / doughnut 最小子集；动画默认关闭以对齐 Chart.js `update("none")` 语义。

### 4.4 运行时资产

- `lib/chart.umd.min.js`（默认）
- `lib/echarts.min.js`（vendored，SW 预缓存）
- `index.html` 按序加载两者 + `chart-theme.js`

Phase A 的复用、队列、延迟挂载、埋点**在 adapter 之上共用**，切换引擎不重写。

---

## 5. Phase C：单图 PoC ✅

**首图：** `events-progress`（营期招生进度，横向堆叠柱，`信息管理 → 营期`）。

**启用 ECharts：**

```text
?chart_engine=echarts&chart_pilot_keys=events-progress
```

或控制台：

```javascript
localStorage.setItem("ketang_chart_engine", "echarts");
window.KETANG_ECHARTS_PILOT_KEYS = ["events-progress"];
```

**实现要点：**

- canvas 宿主自动插入 `.ketang-echart-host` div（ECharts 不可直接 init canvas）
- `chartJsConfigToEchartsOption` 支持 `indexAxis: "y"` 与 stacked 系列
- Chart.js 模式仍走原 canvas；切回时 `releaseKetangEchartHost` 恢复 canvas 显示

**验收清单：**

1. 默认 Chart.js 模式行为不变
2. `?chart_engine=echarts&chart_pilot_keys=events-progress` ECharts 正常
3. 故意移除 echarts script → 自动回 Chart.js，控制台仅一条 warn
4. `getKetangChartPerfSummary()` init/update 不劣化（同数据同视图对比）
5. `test_chart_infra.py` + `test_headless.py` 全绿

---

## 6. Phase D–G：灰度与收尾 ✅

### D 页面灰度（全部 chart key 已走统一 adapter）

- 营期 `events-progress`、报表 `report-*`、预测 `forecast-*`、看板 `board-flow` / `board-dorm` / `board-capacity`
- 无需逐页改调用方；`shouldUseKetangEchartsForKey` 在无 pilot 限制时对全部 key 生效

### E 看板核心

- `board-occ` / `lodging-occ` 环图：cutout 映射 + `.ketang-echart-host--ring`
- `meals-panel-*` 饼图：分段 `backgroundColor` 映射
- `board-capacity` 折线：line + areaStyle

### F ECharts 增强

- **dataZoom**：标签数 > 8（折线/混图）或 > 12（柱图）自动启用 inside + slider
- **同页联动**：`board-*` / `report-*` / `forecast-*` 分组 `echarts.connect`
- **progressive 大数据**：当前数据量未触发，保留扩展点

### G 默认切换

- 默认引擎：**ECharts**（`readKetangChartEnginePreference` 无存储时返回 `echarts`）
- **灾备**：`?chart_engine=chartjs` 或 `localStorage.ketang_chart_engine=chartjs`；ECharts 未加载时自动回 Chart.js
- Chart.js 仍保留在 `index.html` 作离线灾备，未从 SW 移除

**切换示例：**

```text
# 默认已是 ECharts；强制 Chart.js 灾备：
?chart_engine=chartjs

# 仅灰度单图（可选，迁移期调试）：
?chart_engine=echarts&chart_pilot_keys=events-progress
```

---

## 7. 调用点清单（迁移排序参考）

| 模块 | Chart keys | 类型 | 建议阶段 |
| ---- | ----------- | ---- | -------- |
| `events.js` | `events-progress` | bar | C / D |
| `reports.js` | `report-*` | bar | D |
| `forecast.js` | `forecast-*` | bar | D |
| `app.js` | `board-occ`, `board-flow`, `board-dorm` | ring / bar | D / E |
| `meals.js` | `chart-meals-bf/lc/dn` | pie | E |
| `rooming-capacity.js` | `board-capacity` | bar | D / E |

---

## 8. 守门测试

| 测试 | 覆盖 |
| ---- | ---- |
| `test_chart_infra.py` | 复用/队列/延迟/埋点 token；禁止每次 render destroy；asset 版本 |
| `test_chart_echarts_runtime.py` | 隐藏视图 defer → 桌面视口 flush；环/饼 host 尺寸 |
| `test_chart_render_perf.py` | 窄屏 `renderBoard` 零 init；桌面正常 init |
| `test_headless.py` | 看板壳与 canvas 存在 |
| 手动 | `?chart_engine=echarts` + pilot key；切换视图无泄漏；perf summary 可读 |

---

## 9. 性能与可见性（2026-07 增补）

- **`isKetangChartPresentationHidden`**：祖先 `display:none` / `visibility:hidden` 时不 flush、不 init（避免 0×0 ECharts）。
- **`mountKetangChartsInRoot`**：仅对布局可见的 canvas flush；不再因 view active  alone 挂载隐藏图表。
- **窄屏看板**：`boardChartsEnabledForViewport()` 跳过看板三图、用斋饼图、容量折线 init；数字摘要由 `mobile-board-hero` / `mobile-board-chips` 承担。
- **环图 host**：隐藏容器不再盲目设 132px；`syncKetangEchartHostLayout` 仅在可见时回退默认尺寸。

---

## 10. 相关文档

- 路线图 §19.9
- Phase 11 性能预算：`docs/roadmap.md`
- 同步刷新与视图：`js/sync-coordinator.js`（报表/预测仅在 active view 刷新）
