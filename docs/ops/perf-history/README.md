# 生产探针历史 | Prod latency probe history

`test_prod_latency.py --write-report docs/ops/perf-history/YYYY-MM-DD.json` 写入时间序列报告；不覆盖 `performance-baseline.json` 的 `observed_production`。

推荐 Cron 每周追加一份 JSON，便于对比 external gap 与 RUM 趋势。
