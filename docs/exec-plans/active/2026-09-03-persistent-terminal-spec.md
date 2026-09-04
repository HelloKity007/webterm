# SPEC — 服务端持久终端会话

- Tier: 3（远程命令执行、用户隔离、会话生命周期）。
- Spec approval: not obtained (autonomous run)。用户明确要求在所有 Web 端关闭后仍保留会话；本文件记录实施边界供事后审阅。
- Setup plan:
  - Tools to install: none；本机受管 SSH 目标已验证存在 `/usr/bin/tmux` 3.5a。
  - Git: 不创建提交；保留已有未提交工作。
  - Files the gauntlet will add: `handler/persistent_terminal.go`、`handler/persistent_terminal_test.go`、本规格的 evidence 报告；复用既有浏览器测试工具。
  - New dependencies: none。

## Failure model

| Failure mode | Defence |
| --- | --- |
| 重开网页得到新 shell，任务丢失 | 以稳定 tab ID 派生 tmux session，SSH exec 使用 `tmux new-session -A` |
| 不同应用用户或连接 attach 同一远程 tmux | session 名包含用户 ID、连接 ID 和不可执行的 tab ID 摘要；单元测试隔离性 |
| tab ID 被恶意构造成远程命令 | SHA-256 十六进制摘要；tmux 参数只由受控字符构成 |
| 旧客户端没有 tab ID，多个 pane 意外共享 | WebSocket 缺少 `terminal_id` 时明确拒绝 |
| 远端无 tmux 时看似成功却不持久 | 执行 tmux 失败会透传为可见的远端错误；不回退到普通 shell |
| 永久 tmux 累积资源 | 会话持续到远程 shell `exit` 或远端管理员清理；作为已知运维限制记录，不做静默 TTL 杀进程 |

## Scenarios

```gherkin
Feature: 可重连的服务端终端
  Scenario: 相同用户、连接和 tab 重开后恢复同一 shell
    Given 用户 7 在连接 12 的 tab "ssh-12-a" 已创建终端
    When  所有浏览器 WebSocket 关闭后同一 tab 再次连接
    Then  两次 SSH exec 都 attach 相同受控 tmux session

  Scenario: 不同用户或不同 tab 不共享 shell
    Given 两个终端的用户 ID、连接 ID 或 tab ID 任一不同
    When  服务端派生 tmux session 名称
    Then  名称不同且仅含 tmux 安全字符

  Scenario: 缺失稳定 tab ID 被拒绝
    Given SSH WebSocket 请求未带 terminal_id
    When  服务端处理连接
    Then  返回明确错误且不创建 SSH shell
```

## Must NOT

- 不改变现有连接授权、`max_sessions`、SSH host-key 校验或布局 per-user 隔离。
- 不把 tmux session 名或 tab ID 当成 shell 片段拼接执行。
- 不声称终端 IO 会在多个浏览器间同时镜像；同一持久 shell 只应由一个活跃 attach 使用。
- 不将 tmux、密码、token 或终端内容写入持久数据库或日志。

## Revisions

- 2026-09-03: 初版。持久性位于 SSH 目标机的 tmux，而非 WebTerm 进程内存；因此 WebTerm 重启后仍可 attach，但远端主机重启/用户删除 tmux session 后无法恢复。
