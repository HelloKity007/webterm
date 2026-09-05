# WebTerm P0-CLI 历史回看开发证据

日期：2026-09-04
对应阶段：`2026-09-04-webterm-deep-development.md` 的 M1
状态：实现与合成回归完成；真实 Codex/Claude 浏览器验收待测试账号/临时无敏感会话

## 已实现

- 每个 WebTerm tmux session 开启 `mouse on`，不修改其他 session 的 mouse 选项。
- xterm scrollback 提升到 20,000 行，并在用户重新输入时回到底部。
- 普通滚轮继续由 xterm 按协商的 mouse protocol 透传。
- `Shift+wheel` 不手写 SGR escape；浏览器重放一个去掉 Shift 的真实 WheelEvent，再由 xterm 生成协议，避免 `S-WheelUpPane` 无绑定导致无响应。
- 终端右上角新增“历史”入口，明确区分 tmux 历史与 Claude/Codex 自带 transcript：
  - Claude Code：`/tui fullscreen`、wheel、`PgUp/PgDn`、`Ctrl+Home/End`、`Ctrl+O`、`[`。
  - Codex CLI：默认 TUI 的 `Ctrl+T`，以及显式 `codex --no-alt-screen` 启动入口。
- Codex 启动入口发送固定 WS action；服务端根据派生的 tmux session target 检查 `pane_current_command`，只在已知空闲 shell 中键入并执行固定命令。客户端不能提交任意 tmux target 或 shell 命令。
- 历史帮助层移到 xterm 事件捕获区之外，不影响右键、选择、复制粘贴和终端鼠标协议。

## 自动化结果

命令：

```text
./scripts/verify-cli-history.sh
```

结果：

```json
{"shellMarkers":5000,"historySize":4981,"mouseReports":100,"rawComposerBytes":0}
```

说明：tmux 的 `history_size` 不包含当前 viewport，因此约为 5,000 减当前可见行数；`capture-pane -S -` 已同时断言首尾 marker 存在。

其余门禁：

```text
go test ./...                 PASS
npm --prefix ui test         PASS (16 files, 44 tests)
npm --prefix ui run lint     PASS
npm --prefix ui run build    PASS
git diff --check             PASS
```

## 尚未冒充完成的真实验收

当前进程环境未提供 `WEBTERM_BASE_URL`、`WEBTERM_LOADTEST_USERNAME`、`WEBTERM_LOADTEST_PASSWORD`，因此未运行需要真实浏览器、远端 SSH 连接和登录态的场景，也未发送任何可能产生模型费用的 Claude/Codex prompt。

发布前仍需完成：

1. Claude Code 2.1.246：至少 5 viewport marker，wheel/PgUp、Ctrl+End 后输入、Ctrl+O transcript 的打开/退出。
2. Codex CLI 0.145.0：`--no-alt-screen` 的 tmux 历史 marker，以及默认 TUI `Ctrl+T` transcript。
3. 两浏览器 attach 同一 terminalID；1 pane 与 8 pane；每个 CLI 100 次真实 trackpad/wheel；截图或视频证据。
4. 右键菜单、文本选择、复制粘贴、中文 IME 和断线重连的浏览器回归。

## 试用部署

- 2026-09-04 17:29（America/Adak）重新执行 `make build`，生成包含新前端资源的 Go 单二进制。
- 通过仓库 PID 管理脚本重启 WebTerm 与 Caddy；未执行任何 tmux kill 命令。
- 新进程：WebTerm PID `4077789`，Caddy PID `4077790`。
- 后端 `127.0.0.1:8888/api/health` 返回 `{"status":"ok"}`。
- LAN HTTPS `:9443/api/health` 从允许网卡访问返回 HTTP `200`；首页引用新构建资源 `assets/index-CXamUl76.js`。
- 真实用户复测发现 fullscreen Claude 的 `PgUp/PgDn` 正常而 wheel 无效。现场检查确认 Claude pane 为 `alternate_on=1`、`mouse_any_flag=1`，WebTerm session 也为 `mouse on`；根因是用户现有 `~/.tmux.conf` 的 `WheelUpPane` 覆盖未检查 `mouse_any_flag`，把第一次 wheel 导入 tmux copy-mode。
- 修复未改写用户 tmux 配置：WebTerm session 使用 `@webterm_mouse_passthrough=on` 标记，WheelUp wrapper 仅在“标记存在且前台程序申请 mouse”时透传；未标记 session 和普通 shell 保持原绑定语义。
- 隔离回归先显式安装同类 legacy WheelUp 绑定，再验证 5,000 行 shell history 与 fullscreen synthetic TUI 100/100 mouse reports，结果通过。
- 2026-09-04 17:42 重新部署修正版；LAN HTTPS health 再次为 HTTP `200`。现存八个 `wt-*` session 已在线补充标记，没有 kill、重建或清空会话。
