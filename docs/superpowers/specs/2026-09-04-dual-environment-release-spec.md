# WebTerm 双环境发布 Spec

> 状态：实施中。本文覆盖原 LAN 单点部署 Spec 中“不启用 9444”的旧决策。

## 目标

同时运行一个稳定生产环境和一个发布测试环境。候选版本必须先在发布测试环境完成验收，验收的同一二进制才允许提升到生产。部署、提升和回滚均不得执行 `tmux kill-session`，既有 Claude/Codex/Bash 会话继续运行。

## 拓扑

| 环境 | LAN 入口 | Go 监听 | 二进制 | 数据库 |
|---|---|---|---|---|
| production | `https://192.168.11.87:9443/` | `127.0.0.1:8888` | `webterm` | `webterm.db` |
| release-test | `https://192.168.11.87:9444/` | `127.0.0.1:8889` | `runtime/release/webterm` | `runtime/release/webterm.db` |

Caddy 对两个入口使用相同证书和 `192.168.11.0/24` allowlist。Go 端口只监听 loopback。
release-test 页面顶部必须显示“发布测试环境”和候选 commit 短 SHA；production 不显示该标识，降低误操作环境的风险。

## 状态与 tmux 边界

- 发布数据库在每次候选部署时通过 SQLite backup API 从生产库生成一致性快照。测试对用户、布局、连接和 session log 的写入不会进入生产库。
- 快照保留相同的 `user_id`、`connection_id` 和 tab `terminal_id`，但 release-test **不得再 attach 到 production 的 tmux server/session**。测试环境必须使用独立的 tmux socket（或等价的环境命名空间），避免 `window-size`、resize hook、mouse/copy-mode、history-limit 和 CLI 操作跨环境污染。
- release-test 使用 `-preserve-terminal-sessions` 只表示测试环境关闭标签页不清理测试自己的远端 tmux session；它不能再被解释为“允许操作生产 tmux session”。
- 测试环境首次打开快照中的 pane 时，在自己的 namespace 创建对应测试 session。测试输入、clear-history、CLI 操作只作用于测试 session；生产中已有的 Claude/Codex/Bash session 不得被测试流量改变。
- 如需验证“同一生产 session 的多端共享”，必须在 production 入口执行，或显式启用单独的共享验收开关；普通 release-test 验收默认不允许跨环境共享。
- 停止或替换任一 WebTerm 进程只关闭该进程的 SSH/WebSocket attach。tmux server 和 pane 不属于部署进程，不得由发布脚本停止。

## 发布门禁

1. 在干净的 `dev-*` 分支运行 `scripts/release-deploy.sh`。
2. 脚本执行 UI test/lint/build、`go test ./...`，构建带完整 Git SHA 的候选二进制，刷新隔离数据库快照并部署到 `:9444`。
3. 人工在 `:9444` 验证；通过后运行 `scripts/release-approve.sh`，将批准记录绑定到当前候选 SHA。
4. 为同一 SHA 创建并推送 `rb-*` 发布分支。
5. 运行 `scripts/release-promote.sh`。脚本要求候选 SHA、批准 SHA、`rb-*` 分支 tip 三者完全一致，然后复制已经测试的二进制并只重启 production Go 进程。
6. 生产健康检查必须同时返回 `environment=production` 和候选 SHA。上一生产二进制保存在 `runtime/production/webterm.previous`。
7. 如需回滚，运行 `scripts/release-rollback.sh`；只替换 production 二进制并重启 production Go，release-test 和 tmux 均不动。

## 验收标准

- `:9443/api/health` 与 `:9444/api/health` 同时为 `200`，分别报告 production 与 release-test。
- production/test 使用不同数据库文件；测试关闭 tab 不执行远端命令。
- 已存在的 tmux session 在部署 test、提升 production、回滚 production 前后名称和 pane PID 不变。
- release-test 的 tmux socket/namespace 与 production 不同；在 test 中 attach、resize、滚动、输入和关闭 pane 后，production session 的 window size、options、hooks、history 和 pane PID 均不变。
- 未执行 approve、approve SHA 过期、或没有精确 `rb-*` tip 时，promotion 必须失败且生产进程不变。
- promotion 使用候选二进制的字节副本，不在 promotion 阶段重新构建。
