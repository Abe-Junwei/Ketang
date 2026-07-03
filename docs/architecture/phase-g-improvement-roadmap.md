# Phase G 改进路线（2026-07-04）

> 基于 web.dev Core Web Vitals、Navigation/Resource Timing、MDN PerformanceObserver、Cloudflare Workers Metrics/Analytics Engine 等公开最佳实践，结合客堂当前生产观测（`docs/ops/performance-baseline.json` → `observed_production`）制定。
>
> **原则**：RUM（真实用户）做最终判断；合成探针（`test_prod_latency.py`）做回归守门；分层归因（导航 / 资源 / 服务端 / 主线程），不再盲目压 D1 init。

## 当前状态（2026-07-04，Phase G 全批完成）

| 指标 | 外部 P95 | Server P95 | 判断 |
|------|---------:|-----------:|------|
| `read/board` | ~2171ms (P50) | ~798ms | ✅ gzip 7833B / decoded 105KB |
| `read/lodgers_active` | — | — | ✅ 替代 bulk `lodgers_records` |
| `write-refresh` | — | — | ✅ CDP ~137ms |
| `first-view-ready` | — | — | ⚠️ CDP ~7.0s（board prefetch 后；仍受 RTT 主导） |
| external gap | ~2.1s | — | ⚠️ WARN；D1 `perf_probe_samples` + 可选 AE |

**结论**：G-1～G-5 已落地。后续重心：RUM 样本积累 → 边缘 colo 治理决策 → 阶段 SLO 收敛。

---

## Phase G-1：RUM 最小闭环 ✅

| 组件 | 路径 | 状态 |
|------|------|------|
| 前端采集 | `js/perf-rum.js` | ✅ |
| 上报端点 | `POST /api/v1/metrics/perf` | ✅ |
| 存储 | D1 `perf_rum_samples` | ✅ |
| Server-Timing | `functions/_shared/timing.js` | ✅ |

---

## Phase G-2：首屏关键路径 ✅

`first-view-ready` 不等待 room-grid；`renderBoard({ bootstrapOnly })` + idle deferred sync；登录/恢复会话 `bootstrap_board` opt-in 内嵌 board（G-6）。

---

## Phase G-3：read module 数据分层 ✅

| 项 | 状态 |
|----|------|
| board 字段投影 | ✅ gzip 7831B |
| lodgers_active / recent / lookup | ✅ |
| lodgers_history_page 服务端查询 | ✅ |
| 登录 deferred 移除 bulk lodgers_records | ✅ |
| 契约 | `test_lodgers_modules_split.py` |

---

## Phase G-4：边缘延迟与 CF 观测 ✅

| 项 | 路径 | 状态 |
|----|------|------|
| Server-Timing + Request-Id | `timing.js` | ✅ |
| D1 探针样本 | `perf-probe-store.js` → `perf_probe_samples` | ✅ |
| 探针 ingest | `POST /api/v1/metrics/probe` | ✅ |
| 可选 AE | `perf-ae.js`（`KETANG_AE` 绑定） | ✅ graceful no-op |
| read module observe | `?timing=1` → `timer.observe` | ✅ |

---

## Phase G-5：合成监控升级 ✅

| 项 | 说明 |
|----|------|
| 默认 samples | 9 + warmup 2 |
| `--write-history` | `docs/ops/perf-history/YYYY-MM-DD.json` |
| `--check-baseline-graded` | FAIL/WARN/INFO |
| `--ingest-probe` | 写入 D1 探针表 |
| Cron | `.github/workflows/prod-latency.yml` 已升级 |

---

## Phase G-6：SLO 阶段目标（持续）

最终目标 `phase_g_targets_ms`；阶段门槛 `phase_g_stage_targets_ms` 见 baseline JSON。

---

## 相关文件

- 基线：[docs/ops/performance-baseline.json](../ops/performance-baseline.json)
- 探针历史：[docs/ops/perf-history/](./perf-history/)
- 合成探针：`test_prod_latency.py`
- 读模块：`functions/_shared/read-modules.js`
