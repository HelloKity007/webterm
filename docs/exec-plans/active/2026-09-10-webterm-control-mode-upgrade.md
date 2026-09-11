# WebTerm Control Mode / 独立视口升级计划

## 目标

在不更换 React 技术栈、不中断已有 tmux 会话的前提下，使同一终端会话在移动端和桌面端同时打开时，各自保持独立的显示视口。普通 SSH shell 使用浏览器本地 scrollback；Claude/Codex fullscreen TUI 使用应用历史或服务端 Control Mode 回放，不再把大屏的 tmux window size 当作移动端的显示尺寸。

## 现状证据

- 当前 WebTerm 通过 SSH PTY 直接 `tmux attach-session`，并设置 `window-size largest`。
- 每个浏览器收到同一 tmux window 的重绘字节；移动端只在前端缩放，无法改变 tmux 已经按最大客户端生成的行列。
- 当前已有 alternate-screen 检测、SGR mouse 转发、Codex `--no-alt-screen` 入口和 200,000 行 tmux history，但没有 Claude 专用 transcript/replay 服务。
- 参考 X-Workbench 使用 `scrollback: 5000`、独立滚动状态和 Claude `copy-mode` API；alternate history 与 main-screen history 分离。

## 分阶段实现

### M1：渲染与输出管线（已完成）

- xterm WebGL renderer，WebGL context loss 自动回退 DOM。
- WS 输出按 animation frame 合并，减少高频全屏重绘造成的前端帧爆炸。
- 保留 ZMODEM、中文输入、选择复制和现有 tmux mouse 语义。

出口：UI tests、lint、build、Go tests 全绿；无 WebGL 浏览器仍可连接。

### M2：main-screen 独立滚动（基础能力已完成，真实长历史验收进行中）

- 为每个 terminal key 建立服务端输出 ring buffer/快照接口，重连时按客户端 viewport 回放。
- Bash 普通 buffer 由 xterm 本地 `scrollToLine` 承载，滚轮/触摸不发送 ArrowUp/ArrowDown。
- resize 只更新当前 transport 的 viewport，不让移动端的测量结果覆盖共享 tmux window。

出口：Linux/Windows SSH 各生成 5,000 行 marker；移动端触摸和桌面滚轮都能回到首个 marker，输入命令历史不变化；两端同时连接不互相改变 pane 内容。

### M3：Claude/Codex Control Mode（传输骨架已完成，应用级历史验收进行中）

- Claude fullscreen：识别 alternate screen，提供 copy-mode open/seek/close/realtime 状态协议；历史滚动通过 transcript/replay 数据，不依赖 xterm scrollbar。
- Claude 输入区保持 live viewport；Ctrl+End/“返回实时”取消回看并恢复输入。
- Codex：保留默认 TUI，提供 `--no-alt-screen` 可回看入口；默认 TUI 使用 Ctrl+T transcript 作为兜底。
- wheel/touch 请求 16–60fps 合并，禁止把 `SGR mouse` 文本泄漏到 composer。

出口：Claude Code 2.1.246 长会话至少 5 屏 marker；wheel、PgUp/PgDn、Ctrl+Home/End、Ctrl+O 均有证据；移动端和 3440×1440 同时连接时输入框、换行和历史均不重叠。

### M4：多端与资源回收

- WS/SSH channel 生命周期与 terminal lease 解耦，关闭 panel/tab 时安全回收；历史 ring buffer 有上限和 TTL。
- 同一 tmux session 双端 attach、滚动、退出回看不会 detach/kill 或创建新 terminalID。

## 自动化验收

1. `npm --prefix ui test -- --run`
2. `npm --prefix ui run lint`
3. `npm --prefix ui run build`
4. `go test ./...`
5. synthetic shell/TUI fixture：5,000 marker、100 wheel、无 raw mouse 泄漏。
6. 真实 Chromium：iPhone 390×844 与桌面 3440×1440 同时连接 tab 1/panel 6；截图、xterm grid、滚动位置、输入区和 WS 帧间隔均记录。
7. 只有以上全部通过后，才运行 `scripts/release-deploy.sh` 部署测试环境；生产环境不自动升级。

## 风险与决策

- 仅调 CSS、font size 或 `window-size smallest` 不能解决共享 tmux 尺寸冲突，不能作为最终方案。
- 现存 alternate-screen Claude 会话没有可由 tmux 直接恢复的历史；必须通过 Claude transcript、受控重启回放或新会话录制验证，不能伪造完整历史。
- WebGL 是性能优化，不替代 Control Mode；无 GPU 时必须保留 DOM fallback。

## 2026-09-10 验证记录

- 测试环境版本 `a60df91d79309480fc4a588ab16dfeacfcebf787` 已通过 UI 74/74、lint、build、Go tests。
- 真实 Chromium 390×844 移动视口启用实验 flag 后，8 个 Control Mode SSH WebSocket 均建立，收到真实 pane `%output` 数据且无错误帧。
- `capture-pane` 首屏回放和 pane-id 预取已加入；最新浏览器验证中首个控制 pane 在输入前收到 1 个 capture 帧，键盘操作后实时帧数增加到 22 个。
- 真实 Chromium 桌面视口默认仍走 raw PTY，确保现有生产路径不受实验 Control Mode 影响。
- 发现并修复控制连接中旧 `client-attached/client-resized/window-resized` hook 干扰，以及错误的 `%refresh-client/%send-keys` 入站前缀。
- 尚未将 Control Mode 默认开启；仍需完成 Claude 长会话、中文输入、滚轮/触摸回看、桌面+移动端同时连接的浏览器自动化断言后，才可视为 M3 完成。
