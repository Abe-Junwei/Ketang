# Phase G 改进路线（2026-07-04）

> 基于 web.dev Core Web Vitals、Navigation/Resource Timing、MDN PerformanceObserver、Cloudflare Workers Metrics/Analytics Engine 等公开最佳实践，结合客堂当前生产观测（`docs/ops/performance-baseline.json` → `observed_production`）制定。
>
> **原则**：RUM（真实用户）做最终判断；合成探针（`test_prod_latency.py`）做回归守门；分层归因（导航 / 资源 / 服务端 / 主线程），不再盲目压 D1 init。

## 当前状态（2026-07-04，deploy `07574ae`）

| 指标 | 外部 P95 | Server P95 | 判断 |
|------|---------:|-----------:|------|
| `read/board` | 2645ms | 1033ms | ✅ 接近 baseline；gzip 10352B |
| `write-refresh` | — | — | ✅ CDP 102ms |
| `sync/delta` | 2594ms | 765ms | ⚠️ 外部 gap 为主 |
| `first-view-ready` | — | — | ❌ CDP 13265ms，当前最大体验问题 |
| `read_lodgers_records` | 3241ms | 1024ms | ⚠️ 非首屏，仍有瘦身空间 |
| `read_events` | 2700ms | 999ms | ⚠️ 外部 gap 为主 |

**结论**：D1 冷 init 已不是主因（login init_ms≈0）。后续重心：

```text
观测闭环 → 首屏关键路径 → read module 数据分层 → 边缘延迟归因 → 长期 SLO
```

## 六条成熟做法 → 客堂映射

| # | 成熟做法 | 客堂现状 | 下一步 |
|---|----------|----------|--------|
| 1 | RUM 第 75 百分位判门槛；实验室测试只做回归 | 仅有 CDP + curl 合成探针 | Phase G-1：RUM 采样上报 |
| 2 | Navigation/Resource Timing 分层 | 仅有 `network_gap_ms = external - server` | Resource Timing + Server-Timing 对齐 |
| 3 | PerformanceObserver + sendBeacon | 已有 `performance.mark()` | `js/perf-rum.js` + `POST /api/v1/metrics/perf` |
| 4 | LCP/首屏拆 TTFB、资源、渲染、长任务 | bootstrap 只拉 board，但首屏仍 13s | 首屏 DOM 分片、mark 拆分、idle deferred |
| 5 | INP / 关键交互耗时 | write-refresh 已测 | 挂单/退房/换床/用斋/排房确认 mark |
| 6 | CF Workers Metrics / Analytics Engine | 无平台侧聚合 | 写 AE + 响应头 request-id |

---

## Phase G-1：RUM 最小闭环（2026-07-04 已落地）

**目标**：回答「真实用户慢在哪里」，不再只靠 CDP/curl 猜测。

| 组件 | 路径 | 状态 |
|------|------|------|
| 前端采集 | `js/perf-rum.js` | ✅ |
| 上报端点 | `POST /api/v1/metrics/perf` | ✅ |
| 存储 | D1 `perf_rum_samples`（lazy DDL） | ✅ |
| Server-Timing | `functions/_shared/timing.js` 全 API 响应 | ✅ |
| 探针升级 | warm-up、p75、cf-ray、WARN/FAIL 分级 | ✅ |

采样：`?rum=1` 或 admin 100%；默认 10%。`visibilitychange` 时 flush。

验收（生产）：≥50 条真实首屏样本后可聚合 p75/p95。

---

## Phase G-2：首屏关键路径（2026-07-04 已落地）

**目标**：`first-view-ready` 不等待 room-grid DOM 与 deferred 模块。

| 项 | 实现 |
|----|------|
| 首屏定义 | KPI/提醒/统计 +「正在加载房态…」占位，不含 room-grid |
| `renderBoard({ bootstrapOnly })` | 跳过 charts/meals/bedOptions |
| `renderRooms` | `requestIdleCallback` 延后，不阻塞 `first-view-ready` |
| deferred sync | 嵌套 idle，在 room-grid 之后拉后台模块 |
| RUM 上报 | 改在 `login-ready` measure 后 250ms（含 `first_view_ready_ms`） |

---

## Phase G-3：read module 数据分层（2–4 天）

**目标**：降低 parse/内存成本；`read/board` decoded ≤180KB、gzip ≤8KB。

### 落位

| 模块 | 文件 | 改造 |
|------|------|------|
| board 字段投影 | `functions/_shared/read-modules.js` | rooms: id/name/floor/location；beds: id/room_id/bed_number/status；lodgers: 在住最小集；housekeeping: 非净房 only |
| lodgers_records 拆分 | `functions/_shared/read-modules.js` + 新 module keys | `lodgers_active` / `lodgers_recent` / `lodgers_history_page` / `lodgers_lookup` |
| 前端模块表 | `js/read-cache.js` | `RC_DEFERRED_MODULES` 调整；history 不进 bootstrap |
| 回归 | `test_read_module_board_slim.py` | 加 payload 体积上限断言 |

### 验收

```text
read_board decoded_bytes ≤ 180KB
read_board gzip ≤ 8KB
read_board server_total ≤ 800ms
read_lodgers_records 不作为首屏依赖
```

---

## Phase G-4：边缘延迟与 CF 观测（持续 ~1 周）

**目标**：证明 external gap 来源（colo / RTT / 下载 / 等待 TTFB）。

### 落位

| 项 | 文件 / 平台 |
|----|-------------|
| Server-Timing 全端点 | `functions/_shared/timing.js`（已有 `X-Ketang-Timing`）→ 对齐 W3C `Server-Timing` |
| Request ID | 各 handler → `X-Ketang-Request-Id` |
| AE 写入 | 新 `functions/_shared/perf-ae.js`；non-blocking |
| 探针 cf-ray/colo | `test_prod_latency.py` 读响应头 `CF-RAY` / `cf-cache-status` |
| D1 慢查询 | Cloudflare dashboard + 现有 `_timing` stages |

### 验收

```text
每个慢请求可定位 colo / endpoint / server_timing / network_gap
连续 3 天判断 external gap 是否稳定
```

---

## Phase G-5：合成监控升级（1 天）

**落位**：`test_prod_latency.py`、`docs/ops/performance-baseline.json`、`.github/workflows/prod-latency.yml`

| 项 | 说明 |
|----|------|
| warm-up | 2 次不计样本 |
| samples | 默认 9 或 11 |
| 输出 | p50/p75/p95/max + server p95 + network_gap p95 + bytes p95 + outlier + cf-ray |
| 检查分级 | **FAIL**：功能错误、server 严重超阈、write-refresh 超阈；**WARN**：仅 external gap；**INFO**：outlier retry 后恢复 |
| 历史 | `docs/ops/perf-history/` JSON 时间序列（不覆盖 `observed_production`） |

---

## Phase G-6：SLO 阶段目标

最终目标保留（`phase_g_targets_ms`），新增阶段门槛（`phase_g_stage_targets_ms`，见 baseline JSON）。

避免「一切全红」同时不放弃 3s 终态。

---

## 推荐执行批次

| 批次 | 周期 | 内容 |
|------|------|------|
| **第 1 批** | 1–2 天 | RUM + Server-Timing + 探针 WARN/FAIL 分级 + perf-history |
| **第 2 批** | 2–3 天 | renderRooms 延后/分片 + idle deferred + longtask |
| **第 3 批** | 2–4 天 | read/board 字段投影 + lodgers_records 拆分 |
| **第 4 批** | 持续 | CF Metrics/AE + 边缘治理决策 |

## 最小下一步

**先做 Phase G-1（RUM + Server-Timing）**。

原因：`first-view-ready` 13.3s 的主因尚未在浏览器侧分层证实。RUM 落地后可直观看：

```text
login API 多少 ms
board fetch 多少 ms
JSON parse / rc 应用多少 ms
renderBoard / renderRooms 是否阻塞
deferred sync 是否抢主线程
```

---

## 相关文件

- 基线与阶段 SLO：[docs/ops/performance-baseline.json](../ops/performance-baseline.json)
- 合成探针：`test_prod_latency.py`、`test_phase_g_cdp.py`、`test_phase_g_fast_paths.py`
- 前端 marks：`js/perf.js`（若存在）/ `js/app.js` / `js/read-cache.js` / `js/auth.js`
- 读模块：`functions/_shared/read-modules.js`
- 运维 Cron：`.github/workflows/prod-latency.yml`
