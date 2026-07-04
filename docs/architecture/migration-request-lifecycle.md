---
title: 迁移与请求生命周期专项
status: active
updated: 2026-07-04
---

# 迁移与请求生命周期

## 问题本质

生产请求热路径曾承担 **migration discovery**（逐列 `PRAGMA table_info`、`CREATE IF NOT EXISTS`、自动 ALTER）。在 Cloudflare D1 上每次检查都是远程往返，冷 isolate 会把管理写拖到十几二十秒。

业内约束：

1. 生产 schema 变更走版本化 migration（部署生命周期）。
2. 生产请求只做 O(1) ready gate，不做 migration discovery。
3. fallback / repair 与业务请求显式隔离。
4. 写尾（version / sync log / patch）可观测、可合并。

## 当前状态（2026-07-04，已落地）

| 项 | 状态 |
|---|---|
| Phase 0 观测 | `admin/records` 分段 `init_ms` / `auth_ms` / `biz_ms`；`test_admin_write_latency.py` |
| Phase B ready | `app_meta.schema_ready_version` 单次查询；未盖章时一次性列校验后盖章 |
| Phase D light | ready 后仅内存标记，零 DDL / 零 version 探测 |
| Phase A 入口 | 统一 `ensureDatabaseReady`；业务 `allowMigrationFallback: false` |
| Phase C 热路径 | PRAGMA/ALTER 仅 `runMigrationsOrRepair`；`test_migration_hot_path.py` 守门 |
| Phase E 写尾 | 写 + bump + sync log + version 读同一 D1 batch；`patchRow` 免回读 |
| Phase F 运维 | `POST /api/v1/admin/migrate`（admin）；备份/定时任务仍允许 migration fallback |
| Phase G 守门 | `test_migration_hot_path.py` + `test_phase_g_fast_paths.py` |

生产探针（`58840c8` 后）：warm `init_ms` p50=0；create `biz_ms` p50≈**400ms**（server total ≈600–900ms）；外部 create p50≈3.0s（探针机到边缘的网络往返约占 2s，服务端已 &lt;1s）。

客户端（`eventApplyOptimistic`）：在线新增/编辑/删除营期在 API 返回前即关闭弹窗并更新列表；创建时用临时 id，成功后以 `deletions` 替换为服务端真实行。

## 目标架构

```text
部署/运维迁移 → schema_ready_version = N
API 请求 → ensureDatabaseReady（isolate cache / 单次 ready 查询）
  → ready: 业务读写
  → not ready: 显式 migration 分支或明确错误（生产业务默认不自愈）
业务写 → write tail（batch version/sync/patch）→ 返回
```

## 阶段计划

| 顺序 | 阶段 | 内容 | 验收 |
|---:|---|---|---|
| 0 | 观测 | records 分段计时；`test_admin_write_latency.py` | 能拆出 init/auth/biz |
| 1 | ready 标记 | `app_meta.schema_ready_version`，probe 降为 1 次查询 | cold `init_ms` 下降 |
| 2 | light path 归零 | ready 后内存标记，不再 DDL/version 探测 | warm `init_ms` ~0 |
| 3 | 迁移外移 | PRAGMA/ALTER 仅 migrations；热路径零 DDL | grep 守门 |
| 4 | 统一入口 | `ensureDatabaseReady` 替换分叉 init | 入口一致性测试 |
| 5 | 写尾合并 | version/sync log batch；减少 patch 回读 | warm create &lt; 2s |
| 6 | 运维与守门 | migrate endpoint/脚本；冷暖探针阈值 | 防回归 |

## 探针

```bash
python3 test_admin_write_latency.py --base https://wulingkt.net --resource event --samples 2
```

输出字段：`login_ms`、`create_*_ms`、`init_ms`、`auth_ms`、`biz_ms`、`delete_*_ms`。

过渡目标：cold create &lt; 5s，warm create &lt; 3s。  
最终目标：cold `init_ms` &lt; 300ms，warm create &lt; 2s。

## 原则备忘

- 生产业务请求不自动修 schema。
- `addRemoteColumnIfMissing` / `PRAGMA table_info` 只允许出现在 migration/repair。
- migration 失败不写 `schema_ready_version`。
- 回滚业务代码不回滚 schema（forward-only）。
