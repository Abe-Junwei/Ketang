# 最终总验收清单

在功能开发收尾后一次性执行（含原 P1-1 多人验收）。每项打勾并记录执行人与日期。

## 1. 多人协同（原 P1-1）

- [ ] 两台设备/两个浏览器同时登录不同账号
- [ ] A 办理入住 → B 房态/在住列表在轮询周期内更新
- [ ] B 换床 → A 看到新床位
- [ ] A 退房 → B 房务变为脏房
- [ ] 用斋、历史查询、CSV 导出两端均可用

## 2. 并发占床

- [ ] 两端同时对同一空床办理入住，仅一端成功
- [ ] 失败端提示清晰（非技术人员可理解）

## 3. 房态刷新

- [ ] 写操作后本端立即刷新（forceSync）
- [ ] 另一端在 board-version 轮询内看到变化（约 **3s** 内）

## 4. 权限矩阵（P1-2）

各角色重新登录后检查：

| 角色         | 菜单可见         | 禁止操作 API 返回 403 |
| ------------ | ---------------- | --------------------- |
| admin        | 全部             | —                     |
| zhike        | 住宿/预约/报表等 | 用户管理、备份恢复    |
| kitchen      | 用斋相关         | 入住/退房/备份        |
| housekeeping | 房务/房态        | 入住/用户/备份        |
| viewer       | 只读视图         | 全部写操作            |

- [ ] 管理员修改角色权限后，新登录账号行为与配置一致
- [ ] 高级知客（is_advanced）额外获得备份/用户/基础设置权限

## 5. 备份恢复（P0）

- [ ] 导出 JSON 完整
- [ ] 恢复演练后数量与基线一致
- [ ] 主流程：房态、在住、报表正常

## 6. 发布安全（P0/P1-3）

```bash
bash scripts/build_pages_release.sh
python3 scripts/post_deploy_check.py --base https://wulingkt.net --allow-access-block
```

- [ ] 白名单产物无 docs/test/data
- [ ] 敏感路径 403/404
- [ ] 核心静态资源可访问（Access 环境在已登录浏览器抽查）

## 7. 性能基线（P1-3）

```bash
python3 test_prod_latency.py --base <Pages预览或内网> --samples 3 \
  --check-baseline docs/ops/performance-baseline.json
```

- [ ] login_role P95 ≤ 15s
- [ ] read-model 首次 P95 ≤ 25s
- [ ] read-model 304 P95 ≤ 5s
- [ ] board-version P95 ≤ 5s

## 签字

| 项目   | 执行人 | 日期 | 备注 |
| ------ | ------ | ---- | ---- |
| 总验收 |        |      |      |

通过后方可视为正式版上线就绪（对外大规模使用、长期运维基线冻结）。
