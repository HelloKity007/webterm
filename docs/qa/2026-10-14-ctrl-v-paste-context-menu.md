# 2026-10-14 Ctrl+V 粘贴与右键菜单可视区域

候选 `21bad1f`（分支 `dev-1.1.2`），已部署测试环境 9444。生产 9443 未做任何变更。

## 变更

- `ui/src/components/terminal/terminalInteractions.ts`：Ctrl+V 从 xterm 手中接管，但不 `preventDefault`，让浏览器原生 paste 事件走 xterm 既有粘贴路径（与 Ctrl+Shift+V 同一条）。此前 xterm 把 Ctrl+V 映射成 `^V`(0x16) 并取消 keydown，原生 paste 被整体抑制。Ctrl+Shift+V 保持不变。
- `ui/src/components/common/contextMenuPosition.ts`（新）：`resolveContextMenuPosition` 按菜单实测尺寸优先向对侧翻转，放不下再夹取到视口内。
- `ui/src/components/common/ContextMenu.tsx`：`useLayoutEffect` 测量后定位，首帧前完成，贴边锚点不再把菜单弹出可视区；超高菜单限高滚动。

## 证据

- 单测 `ui` 237 通过（含 `contextMenuPosition.test.ts`、`ContextMenu.test.tsx` 贴底翻转、`terminalInteractions.test.ts` Ctrl+V 路由与不取消事件）；`npm run lint` 干净；`go test ./...` 通过。
- `./scripts/release-deploy.sh` 完成；post-deploy release-gate `PASS`，服务版本 `21bad1f011f9b1616aaa6ba8a4cda981328abbd7`，测试地址 `https://192.168.11.87:9444/`。
- 部署后只读探针（焦点用 DOM `focus()`，粘贴载荷在 `WebSocket.send` 处丢弃，未向任何远端会话写入）：
  - 贴底右键：视口 1360×900，点击 y=886，菜单 rect `top=329 bottom=886`，整体在视口内并向上展开。修复前按锚点直接 `top:886`，下半截落在可视区外。
  - Ctrl+V：恰好 1 次原生 paste 事件，内容等于剪贴板标记；发出的数据不含 0x16，即未再发送 `^V`。
- `scripts/verify-terminal-context-menu.mjs` 在隔离本地实例（同一候选二进制、独立库、临时用户）上跑通至 tmux history-limit 断言为止，含本次新增的贴底菜单与 Ctrl+V 校验。

## 脚本维护

`scripts/verify-terminal-context-menu.mjs` 多处与现行产品脱节，本轮一并同步，未删除有效断言：

- 终端身份改由 `POST /api/terminal-sessions/{conn_id}` 分配（伪造 layout id 会被身份校验拦截，终端永不 attach）。
- 会话名改按 `handler/persistent_terminal.go` 的 `wt-<user>-<conn>-<hash16>` 推导。
- 已移除的 `window['webterm-ws-<id>']` 输入钩子改为真实键盘输入（`sendToTerminal` / `pressInTerminal`）。
- 就绪条件改为 WebSocket 已建立（WebGL 渲染下 `.xterm-rows` 无文本，不能当就绪信号）。
- 「展开 SFTP」按钮已被统一「文件」工作区取代，改等 ActivityBar 的「SSH 终端」。
- 选区浮层由 `ffc82db` 有意移除，原「TUI 拖选须保留视觉快照」改为现行设计等价判据：复制内容正确、复制后无残留 `xterm-selection`。

## 未覆盖 / 已知限制

- history-limit 断言在共享 default tmux socket 上读到 500000（用户 `~/.tmux.conf`），产品隔离 socket 下为 200000；属环境差异，断言未改，该阶段及其后阶段本轮 NOT RUN。
- release-test 开启 `-test-auto-login`，页面加载即用 admin 覆盖会话，脚本的临时用户流程在 9444 上无法直接使用，故 9444 侧证据来自上述只读探针。
- AGENTS.md 要求的终端动态视觉回归矩阵（双端同会话字号、刷新后全量重跑、手机交互、标签拖动排序等）本轮 NOT RUN。
- Ctrl+V 现不再向远端发送 `^V`(0x16)；需要字面 `^V` 的终端场景需改用其它输入方式。
