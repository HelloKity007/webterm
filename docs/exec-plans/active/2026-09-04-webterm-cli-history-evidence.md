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

## 不同尺寸并发 attach 与 CLI 输入/剪贴板优化

- 用户在同一共享布局同时保留 8-pane 小窗口和较大单 pane/tab。现场 `tmux list-clients` 显示同一 session 同时存在 `44x19` 与 `94x30` 客户端（另一个 session 还存在 `103x40`）；原 `window-size largest` 把共享 grid 设为大客户端尺寸，小 pane 只显示左上区域，Claude 底部 composer 因而在可视区之外。这不是历史丢失或 Claude 退出。
- session sizing 改为 `window-size smallest`：所有同时在线客户端都能看到完整共享 grid 和底部输入区；较大客户端在小 pane 在线期间允许留白。现有 tmux session 可在线修改，无需 kill 或新建。
- 新增受控 `resume_terminal_input` WS action。服务端只使用派生 session 名：处于 tmux copy-mode 时执行 `send-keys -X cancel`，否则发送 Claude/Codex 原生 `Ctrl+End`，用于回到底部继续输入。
- “终端 / CLI 历史”面板新增明确的复制、粘贴和恢复输入按钮；复制仍基于 xterm 选区，粘贴通过浏览器 Clipboard API 后交给 xterm paste，保留右键菜单与 `Ctrl+Shift+C/V` 入口。
- 现存八个 WebTerm session 已在线设置为 `window-size smallest`，没有 kill、重建或清空；tab 6 对应 pane 现场仍为 `pane_current_command=claude`、`alternate_on=1`，共享 window 已变为最小客户端可完整显示的 `44x18`。
- 2026-09-04 18:15（America/Adak）重新构建并部署优化版：WebTerm PID `273941`、Caddy PID `273942`；后端 health 正常，LAN HTTPS health 为 HTTP `200`，首页资源为 `assets/index-Bn1Ckjjj.js`。
- 优化后 fresh 门禁：`go test ./...` PASS；UI `16 files / 45 tests` PASS；lint/build PASS；synthetic CLI 为 `{"shellMarkers":5000,"historySize":4982,"mouseReports":100,"rawComposerBytes":0}`。真实 tab 6 composer 与复制粘贴由用户继续验收。

## Claude fullscreen 长会话滚动背压

- 用户复验确认输入框恢复；短 Claude 会话可滚到开头，但 tab 6 长会话持续向上滚动会暂时卡住，先下滚再上滚才能继续。
- 只读现场检查：tab 6 为 `pane_current_command=claude`、`pane_in_mode=0`、`alternate_on=1`、`mouse_any_flag=1`、`history_size=0`，排除 tmux copy-mode 与 tmux history 边界。
- 当前 Claude Code 为 2.1.246。上游 `anthropics/claude-code#80033` 记录 2.1.216 引入 fullscreen scroll stutter，`#84712` 记录长会话整屏 repaint 累积后单次 wheel 可延迟 1–3 秒；两项目前均未给出已发布修复。
- 用户继续测试期间，普通滚轮在未部署任何新代码时自行恢复并可到达会话开头，进一步证明是临时 repaint 卡顿而非历史断层。
- WebTerm 兼容收窄为无侵入兜底：普通 wheel 保持不变；`Shift+wheel` 在 alternate-screen 使用 120ms 限速的标准 `PageUp/PageDown` 序列，main-screen 仍走 tmux history 路径。
- fresh 门禁：UI `16 files / 46 tests` PASS；lint/build PASS；`go test ./...` PASS；synthetic CLI 为 `{"shellMarkers":5000,"historySize":4981,"mouseReports":100,"rawComposerBytes":0}`。
- 2026-09-04 18:30（America/Adak）部署兜底版：WebTerm PID `396173`、Caddy PID `396174`；LAN HTTPS health 为 HTTP `200`，首页资源为 `assets/index--p3o_U6V.js`。部署后 tab 6 仍为 `claude`、`pane_in_mode=0`、`alternate_on=1`，会话未重建。
