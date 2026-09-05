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
- 曾将 session sizing 改为 `window-size smallest`，让所有在线客户端看到完整共享 grid；用户复验否决了大屏留白表现，因此该方案不再作为目标实现。
- 新增受控 `resume_terminal_input` WS action。服务端只使用派生 session 名：处于 tmux copy-mode 时执行 `send-keys -X cancel`，否则发送 Claude/Codex 原生 `Ctrl+End`，用于回到底部继续输入。
- “终端 / CLI 历史”面板新增明确的复制、粘贴和恢复输入按钮；复制仍基于 xterm 选区，粘贴通过浏览器 Clipboard API 后交给 xterm paste，保留右键菜单与 `Ctrl+Shift+C/V` 入口。
- 现存八个 WebTerm session 曾在线切换到 `window-size smallest` 进行诊断，没有 kill、重建或清空；tab 6 对应 pane 现场仍为 `pane_current_command=claude`、`alternate_on=1`，证明问题来自共享尺寸而不是会话丢失。
- 2026-09-05 用户确认最终目标为“大屏铺满 + 小屏完整缩放”。整改使用 `window-size largest`，tmux 通过受控 terminal title 向所有 attach 客户端广播权威 grid；浏览器先测量本地原生 grid，大屏保持配置字号，小屏用自适应字号、行距和字距渲染同一完整 grid。session hooks 与固定 `follow_terminal_input` action 只保留为 attach/resize 过渡期兜底；该 action 只使用服务端派生的 tmux target，不接受客户端 session 名或 shell 命令。
- 生产 9443 与测试 9444 共用既有 tmux 时，旧生产进程仍可能在重连命令中写回 `window-size smallest`。新版本的 session attach/resize hooks 必须再次锁定 `largest`，使双环境并行期间的旧客户端不能覆盖测试版共享尺寸策略。
- OpenCLI 对八个既有长会话的现场检查进一步发现：`tmux new-session -Ad` 在 session 已存在时会直接 attach，因此同一 shell command 中排在它后面的尺寸、title 和 hook 配置永远不执行。启动序列改为 `has-session || new-session -d`，完成幂等配置后再显式 attach；既有 session 不 kill、不重建。
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

## Fullscreen CLI 选择并复制

- 普通 shell 的 xterm 选区、`Ctrl+Shift+C` 与右键复制已有真实浏览器证据；Claude/Codex 开启 mouse reporting 后，依赖合成 `Shift+drag` 的强制选择在实际 TUI 中仍不稳定。
- 终端右上角、右键菜单和历史帮助新增“选择并复制”。启用后 WebTerm 从当前 xterm viewport 计算 0-based buffer cell，使用 `Terminal.select(startColumn, startRow, length)` 建立线性选区；mouse down/move/up 在捕获阶段终止，不发给 CLI。松开后立即读取 `Terminal.getSelection()` 并写入 Clipboard API，成功或失败均显示状态。
- 该模式一次拖动后自动退出，普通 wheel、Claude/Codex mouse interaction、tmux menu 与既有普通选择路径保持不变。
- 新增反向/跨行 selection range 单测，以及真实浏览器 synthetic alternate-screen + SGR mouse fixture：门禁需断言剪贴板包含指定 TUI 行，且 WS 上行没有 `SGR mouse` 序列。
- fresh 自动化：UI `16 files / 47 tests` PASS；lint/build PASS；`go test ./...` PASS；synthetic CLI history/mouse 为 `{"shellMarkers":5000,"historySize":4981,"mouseReports":100,"rawComposerBytes":0}`。需要登录态的 fullscreen clipboard Playwright 门禁因没有独立测试账号未在真实用户布局运行，等待用户在现有 Claude/Codex 会话手工验收。
- 2026-09-04 18:40（America/Adak）部署：WebTerm PID `487815`、Caddy PID `487816`；LAN HTTPS health 为 HTTP `200`，首页资源为 `assets/index-CGzRF6Wt.js`。未登录 Playwright smoke 返回 HTTP `200`、标题 `WebTerm`、无 page/request error；无登录态视觉 baseline，因此交互视觉结论为 INCONCLUSIVE。部署后 tab 6 仍为 `claude`、`pane_in_mode=0`、`alternate_on=1`，会话未重建。
- 用户在 tab 6 复验发现第一次实现松开鼠标后原生 xterm 选区立即消失，复制仍不可确认。根因边界收窄为 Claude fullscreen 持续切换/重申 mouse protocol 或重绘时，xterm selection service 会执行 `clearSelection()`；因此不能在 mouseup 后再次依赖 `Terminal.getSelection()`。
- 修正为拖动每一步在调用 `Terminal.select()` 后同步保存文本快照；mouseup 复制函数直接接收快照值。另按 viewport cell 生成 WebTerm 自己的多行半透明选区层，即使 xterm 原生 selection 被清理仍保留视觉反馈；后续 `Ctrl+Shift+C` 与右键复制也会回退到快照。
- 修正后 fresh 门禁：UI `16 files / 48 tests` PASS；lint/build PASS；`go test ./...` PASS；synthetic CLI history/mouse 仍为 `{"shellMarkers":5000,"historySize":4981,"mouseReports":100,"rawComposerBytes":0}`。Playwright fullscreen fixture 增加视觉快照持续存在断言。
- 2026-09-04 18:48（America/Adak）部署快照修正版：WebTerm PID `567934`、Caddy PID `567935`；LAN HTTPS health 为 HTTP `200`，首页资源为 `assets/index-BI4xmyEO.js`；未登录 Playwright smoke 为 HTTP `200`、标题正确、无 page/request error。tab 6 仍为运行中的 Claude fullscreen，未重建会话。
- 用户随后在原 tab 6 长 Claude fullscreen 会话完成真实验收：通过“选择并复制”拖选内容后可成功复制。该会话未重建，验证了文本快照方案可跨 Claude 重绘保留复制内容。

## Fullscreen CLI 直接拖选复制

- 为省去先点“选择并复制”的步骤，普通左键按下先进入 5px 手势判定：短按会向 xterm 重放完整的 mouse down/up，Claude/Codex 的点击仍可用；超过阈值则直接走已验收的 viewport cell 文本快照，松开自动复制且不向远端 TUI 泄漏鼠标报告。
- 显式“选择并复制”按钮仍保留为兼容兜底；`Ctrl+drag` 等带修饰键的操作保持交给 xterm/TUI。
- fresh 门禁：UI `16 files / 50 tests` PASS；lint/build PASS；`go test ./...` PASS。浏览器交互 fixture 已改为先验证 fullscreen TUI 短按收到完整 SGR click，再验证无预先点击按钮的直接拖选不会泄漏 SGR mouse；当前环境未提供独立测试账号，部署后的登录态 fixture 待用户真实会话复验。
- 2026-09-04 18:59（America/Adak）部署：WebTerm PID `666594`、Caddy PID `666595`；LAN HTTPS health 为 HTTP `200`，首页资源为 `assets/index-CJvdZtme.js`。匿名桌面与 375px 移动端 Playwright smoke 均为 HTTP `200`、标题正确、无 page/request error；无视觉基线，因此视觉回归结论为 INCONCLUSIVE。现有 Claude/Codex tmux pane 均仍存活。
- 用户复验发现 Bash/main-screen 复制后错误保留了为 Claude 重绘准备的快照层，且不透明背景遮住文字。修正为 main-screen 自动复制后立即清除 xterm 选区且不生成快照层；只有 alternate-screen fullscreen TUI 保留快照视觉反馈，并将覆盖层设为 `0.45` 透明度，避免遮挡前景文字。
- 修正后 UI `16 files / 51 tests`、lint、build 全部 PASS。2026-09-04 19:09（America/Adak）重新部署：WebTerm PID `779536`、Caddy PID `779537`，LAN health HTTP `200`，首页资源为 `assets/index-CkqG2ty5.js`；原 Claude alternate-screen pane 仍存活。
- 用户确认 main-screen 自动清除与 fullscreen 文字可见行为正常，并要求进一步提高透明度；快照覆盖层 opacity 从 `0.45` 调淡至 `0.28`。
- 调淡后 UI `16 files / 51 tests`、lint、build 全部 PASS；部署进程为 WebTerm PID `911803`、Caddy PID `911805`，LAN health HTTP `200`，首页资源为 `assets/index-BT8fFUcj.js`。
