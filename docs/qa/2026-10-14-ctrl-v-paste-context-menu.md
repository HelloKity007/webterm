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

---

## 2026-10-15 发布测试环境后台终端身份绑定

候选 `51cf2f6`（`dev-1.1.2`），已部署 9444。生产 9443 未变更。

**背景**：测试库是生产库快照，快照里的身份是 `environment=production` + 生产隔离 socket，而 release-test 服务要求 `release-test` + `webterm-release-test-fixed`，因此每个 Panel 点开都会报
`terminal identity is missing, inactive, or no longer matches this connection`。未点开的 Panel 又因为懒挂载根本不做校验，所以「点了才提示」。

**变更**（仅 release-test，生产仍保持 fail-closed 弹窗）：

- `ui/src/components/terminal/terminalRecovery.ts`：单 Panel 恢复流程——先探测身份，再 adopt 绑定既有远端会话（adopt 永不新建会话），绑不上才新建并替换；同一 terminal id 只跑一次。
- `ui/src/components/layout/workspaceLayout.ts`：`replaceWorkspaceTabIdentity` 在所有工作区里原位改写 Panel 的 terminal id（含未打开的工作区）。
- `ui/src/components/layout/SplitPane.tsx`：布局应用后对**全部工作区**预热（含未切换到的），改写同时落在已挂载 pane 缓存与持久化工作区，`paneActiveCache` 一并更新，保持当前选中 Panel 不变。

**证据**（`https://192.168.11.87:9444/`，只读探针 + UI 点击，未输入任何终端内容）：

- 部署后页面加载即触发预热：25 个 SSH Panel（工作区 3572 与 730 合计）在 **03:24:15–03:24:19 共 4 秒**内全部完成绑定，DB 中新增 25 条 `release-test`+`active` 身份，无需切换工作区、无需点击 Panel。
- 切到 tab2（730）后逐个点开 Panel（45/48/迁移基线1、hdcp1 等）：`role="alert"` 覆盖层为空，页面不含 identity 文案，未出现「连接已断开」。
- 单测 248 通过（含 `terminalRecovery.test.ts` 6 例、`workspaceLayout.test.ts` 新增 `replaceWorkspaceTabIdentity` 3 例）；lint 干净；`go test ./...` 通过。
- post-deploy release-gate PASS，版本 `51cf2f672d95d545f7480aae7755de63c7d0ee9b`。

**限制**：

- 自动绑定只覆盖 release-test；生产遇到身份失效仍弹窗，需人工选择（adopt / 新建 / 移除）。
- 「绑定既有会话」指 release-test 自己 socket 上的既有会话；生产隔离 socket 上的会话测试端无法访问，绑不上时按授权自动新建独立终端（不恢复原进程）。
- 每次 `release-deploy.sh` 重拍快照后，预热会在下次打开页面时重新补齐，无需人工干预。
- AGENTS.md 的终端动态视觉回归矩阵本轮 NOT RUN。

---

## 2026-10-16 输入行被画出可视区（长历史 Panel 切标签后光标消失）

候选 `5fb454c`，已部署 9444。生产 9443 未变更。

**现象**：tab2 panel 47（长历史）从其它标签切回来后输入光标不见了，要按 Enter 才出现；panel 52 甚至按 Enter 也不出现「光标行」。

**根因**：`desktopTerminalViewport` 的滚动轨道高度是「历史 spacer + xterm 元素高度」，而 xterm 元素高度取的是屏幕行高整数倍（19×21=399px），面板可视高度是 406px，于是轨道末端比 `baseY * cellHeight` 短 7px。`applySurfaceScroll` 用 `floor(scrollTop / cellHeight)` 映射视口行号，「滚到底」就落到 `baseY - 1`：xterm 被 `top:-21px` 上移一行，实时底部那行（提示行 + 输入光标）被画在空白尾巴里，不可见。

**放大条件**：历史越长 spacer 越高，切换标签时布局/历史锚点恢复触发 scroll 事件就越容易命中这个映射；历史短时轨道根本不滚动，所以只在长历史 Panel 上出现。Enter 之所以「有时管用」，是 `revealCursor` 直接 `scrollToBottom` 把 `viewportY` 拉回 `baseY`；但随后的 scroll 事件又按 floor 映射回 `baseY - 1`，把修正推翻——这就是 panel 52 按 Enter 也没用的原因。

**修复**（`ui/src/components/terminal/desktopTerminalViewport.ts`）：

- `refresh()` 把 xterm 元素高度下限设为 `surface.clientHeight`，轨道末端精确等于 `baseY * cellHeight`。
- `scrollPosition(…, maxPixels)` 在滚动条末端（`>= maxPixels - 1`）吸附回实时底部，不再落 `baseY - 1`。

**证据**（同一复现脚本前后对比，只在测试环境写入临时终端内容）：

| 状态 | 修复前 | 修复后 |
|---|---|---|
| 切标签回来 `xtermTop` | `-21px` | `0px` |
| xterm 元素 | 465–864（底部 21px 空白） | 479–885（贴满面板） |
| 输入行 | 整行不可见（截图 `p47-2`） | `x99-pc(87) … $` + 光标块可见 |
| panel 52 按 Enter | 光标行不出现 | 光标行 + 光标块可见 |

- 单测 249 通过（新增 `scrollPosition` 末端吸附 1 例）；lint 干净；`go test ./...` 通过。
- post-deploy release-gate PASS，版本 `5fb454c0a93d60737863aaccbfe6a6baeb3169ef`。

**限制**：AGENTS.md 的终端动态视觉回归矩阵本轮 NOT RUN；移动端滚动路径（`localViewportRevealRow`）未改，建议手机端顺手看一眼长历史滚动。
