# 性能与稳定性优化方案

Status: draft — 待确认后实施。数据采集于 2026-10-12，覆盖生产 9443 与测试 9444。

## 现状数据

| 指标 | 当前值 | 评估 |
|---|---|---|
| 孤立 tmux server | **57 进程 / 55 socket，全部 0 session** | 严重 |
| session_logs 行数 | **413,631 行**（SSH 408K + SFTP 5.3K） | 无上限增长 |
| session_logs 大小 | 24MB（DB 主体） | 40 天数据 |
| runtime/ 目录 | **9.0GB**（QA 录像/截图/诊断） | 磁盘膨胀 |
| 预留泄漏实例 | 4 个（9 月遗留） | 低 |
| DB WAL | 4MB 未 checkpoint | 中 |
| 前端 chunk > 500KB | 3 个（PersistentTerminalTab 528K、xlsx 484K、pdf 424K） | 中 |
| 系统内存 | 125GB / 60GB 可用 | 充裕 |
| Go 进程 RSS | 生产 66MB / 测试 50MB | 正常 |
| Caddy 配置 | 无显式连接/超时限制 | 防御性缺失 |

## 优化项

### P0 — 孤立 tmux server 清理（稳定性）

**问题**：每个 terminal 使用独立 tmux server + socket；session 结束后 server 进程与 socket 文件残留。当前 55 个 socket 全部空转（0 session），57 个 tmux 进程占用内存与 FD。随使用时间线性增长。

**方案**：新增 `scripts/cleanup-orphan-tmux.sh`，由 systemd timer 周期执行（或集成到 watchdog）：
1. 遍历 `~/.local/state/webterm/webterm-production/*` 和 `webterm-release-test/*` 下的 socket
2. 对每个 socket 执行 `tmux -S <sock> list-sessions`，若 0 session 则 `kill-server` 并删除 socket 文件
3. **保护**：跳过 `webterm-production-durable`（legacy 共享 socket）和 `webterm-release-test-fixed`（测试固定 socket）；只处理 `terminal_instances.state IN (closed, reserved)` 对应的 socket
4. 记录清理数量到 journal

**预期收益**：消除 50+ 僵尸进程；FD 不再线性增长。

### P0 — session_logs 保留策略（稳定性/DB）

**问题**：413K 行无清理逻辑，40 天增长到 24MB；持续写入会使 WAL 膨胀、查询变慢。

**方案**：
- 启动时清理 30 天前的 session_logs（一次性，< 1s）
- 可选：保留最近 30 天或最近 10K 行，先删后 VACUUM
- 在 `store/` 添加 `PruneSessionLogs(retentionDays)` 并在 main.go 启动时调用

**预期收益**：DB 从 25MB 回到 < 5MB；查询延迟下降；WAL 不再累积。

### P1 — runtime/ 磁盘清理（运维）

**问题**：9GB QA 产物（录像/截图/诊断 JSON），全部在 30 天内修改过（近期 QA 密集），但长期占满磁盘。

**方案**：
- `scripts/cleanup-runtime.sh`：保留最近 7 天的 QA 证据，删除更早的目录（保留 `release-gate/` 最近 5 次）
- 加入 `webterm-watchdog.timer` 或独立 `runtime-cleanup.timer`（每天一次）
- **手动确认后执行**：首次运行前 `du -sh runtime/*/` 列出将删除项

**预期收益**：释放 ~6-7GB 磁盘。

### P1 — 前端 bundle 优化（性能）

**问题**：3 个 chunk 超 500KB。`xlsx`（484K）和 `pdf`（424K）是文件预览用的第三方库，`PersistentTerminalTab`（528K）是终端主包。

**方案**：
- xlsx / pdf 已在代码分割中，但可在文件预览真正打开时才 `import()` —— 检查 `FilePreview.tsx` 是否已按需加载；若未加载则改为动态 import
- PersistentTerminalTab 大是因为包含 xterm.js + WebGL addon；可考虑将 WebGL addon 延迟到首次渲染后加载
- 不阻塞本次发布，作为后续优化项

**预期收益**：首屏 JS 减少 ~900KB（xlsx+pdf 延迟后）。

### P2 — DB WAL checkpoint（稳定性）

**问题**：WAL 4MB 未 truncate；长期运行可能增长。

**方案**：在 session_logs 清理后执行 `PRAGMA wal_checkpoint(TRUNCATE)`；或在 watchdog 中每小时执行一次。

**预期收益**：WAL 稳定在 < 1MB。

### P2 — Caddy 显式超时（防御性）

**问题**：Caddyfile 未配置连接/读写超时，使用默认值。WebSocket 长连接场景下无上限。

**方案**：在 Caddyfile 添加：
```
{
	servers {
		protocols h1 h2
		timeouts read_body 30s read_headers 10s write 0s
	}
}
```
WebSocket 场景 `write 0s`（不限制）；普通 HTTP 30s 读超时。

**预期收益**：防止慢连接耗尽资源。

### P3 — 预留实例清理（DB 卫生）

**问题**：4 个 9 月的 `reserved` terminal 实例从未激活，长期占用 terminal ID 空间。

**方案**：启动时将超过 24h 的 `reserved` 实例标记为 `closed`。

## 实施顺序

| 阶段 | 内容 | 环境 | 预计工作量 |
|---|---|---|---|
| 1 | tmux 孤立清理 + session_logs 保留 + WAL checkpoint | 生产+测试 | 半天 |
| 2 | runtime/ 清理（首次手动确认） | 主机 | 1 小时 |
| 3 | 预留清理 + Caddy 超时 | 生产+测试 | 1 小时 |
| 4 | 前端 bundle 懒加载 | 测试环境先行 | 半天 |

阶段 1-3 风险低、收益明显，可一次发布；阶段 4 独立验证后再上。
