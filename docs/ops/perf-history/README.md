# 生产探针历史 | Prod latency probe history

`test_prod_latency.py --write-history` 写入 `docs/ops/perf-history/YYYY-MM-DD.json`（时间序列）；不覆盖 `performance-baseline.json` 的 `observed_production`。

推荐：

```bash
python3 test_prod_latency.py \
  --base https://wulingkt.net \
  --samples 9 --warmup 2 \
  --check-baseline-graded \
  --write-history \
  --ingest-probe
```

每周 Cron（`.github/workflows/prod-latency.yml`）自动追加 history + D1 `perf_probe_samples`。

对比字段：`network_gap_ms`、`cf_colo`、`server_timing`、`read_lodgers_active_ms` vs 旧 bulk `lodgers_records`。
