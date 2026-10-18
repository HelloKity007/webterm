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

---

## 2026-10-16 点击唤回光标 + 切回标签 Panel 全空白

候选 `c2dee1b`，已部署 9444。生产 9443 未变更。

**现象**：panel 53 鼠标点击输入位置光标不出现；另有 panel 52/47 一类光标不见的问题。要求补做真实视觉场景测试。

**根因 A（点击不唤回）**：`handleSurfaceMouseUp` 的单击分支只 `replayTerminalLeftClick` + `focus()`，不像按键那样调用 `revealInputCursor`。视口停在历史上方时，点击输入区后光标行仍在视口外。

**根因 B（切回标签整屏空白）**：`restoreShellHistoryViewport` 用 `term.scrollToLine` 移动 xterm 视口，但不改外层滚动条；`refresh()` 再按 `viewportY` 算出 `element.style.top`。两者错位后（实测 `scrollTop=8274` 而 `viewportY=361`）整帧被画到可视区之外，Panel 全黑。历史锚点在切换标签时被重新应用，所以只在「读历史 → 切走 → 切回」后出现。

**修复**：

- `ThemedTerminal.tsx`：单击（非拖选、非双击选词）后 `revealInputCursor()`，与按键一致；拖选仍只选文本不跳视口。文档级 mouseup（拖出面板外松开）同路径。
- `desktopTerminalViewport.ts`：`refresh()` 里当渲染帧会落到可视区外时把滚动条拉回 `viewportY * cellHeight`；面板隐藏时（`clientHeight === 0`）不改写保存的位置。

**视觉场景测试**（新脚本 `scripts/verify-terminal-viewport-visuals.mjs`，输出 `runtime/terminal-visuals/<stamp>/`）：

覆盖 15 步：5 个标签逐个切换、输入、Enter、制造长历史、滚入历史、点击输入区、再滚入历史、按 Enter、切走切回历史标签、点击未用过的 Panel。每步断言「光标行是否在渲染帧内 / 是否在实时底部 / 轨道与视口是否同步 / 渲染帧是否在可视区内」并截图。

| 步骤 | 结果 |
|---|---|
| 01-switch-to-47/53/54/56/57 | PASS（切换后光标可见） |
| 02-after-typing / 03-after-enter | PASS |
| 04-after-history-built | PASS |
| 05-scrolled-into-history | PASS（按预期停在历史，光标不在） |
| 06-click-input-area-reveals-cursor | PASS（点击唤回光标，截图可见提示行 + 光标块） |
| 07-scrolled-again / 08-enter-reveals-cursor | PASS |
| 09-other-tab | PASS |
| 10-back-on-history-tab | PASS（修复前**整屏空白**；现在保留阅读位置 355–373 行正常显示，轨道与视口同步） |
| 11-click-untouched-panel | PASS |

两轮均 **15/15**；截图存 `runtime/terminal-visuals/20261016/`（gitignore，未入库）。

**限制**：

- 场景套件跑在 release-test（会向测试 Panel 写入临时内容）；生产未跑。
- 「读历史 → 切走 → 切回」保留阅读位置而不是跳回输入行；若希望切回来就唤回光标，可再加。
- 双击选词、拖选、右键菜单、Ctrl+右键 tmux 菜单未纳入本套件；手机端路径未覆盖。
- AGENTS.md 的终端动态视觉回归矩阵（双端字号、刷新后全量重跑等）本轮 NOT RUN。

---

## 2026-10-16 光标不在 `$` 后（Panel 一片空白只剩孤立光标块）

候选 `fdc57ef`，已部署 9444。生产 9443 未变更。

**现象**：panel 53 光标位置异常，按理应该在 `$` 后面。

**排查路径**（记录以免后人重走）：

1. DPR 1 下逐帧差分定位光标块：`$` 墨迹 x 185–192、光标块 x 193–201，同行、紧邻右侧 —— 此时位置是对的。
2. DPR 2 下看到文字与光标都按 2 倍绘制并被裁切，一度怀疑高 DPI 度量错位；用最小页面验证：Playwright 无头 Chromium 在 `deviceScaleFactor: 2` 下 `window.devicePixelRatio` 是 2，但 `ResizeObserver` 的 `devicePixelContentBoxSize` 仍按 CSS 像素上报（100×100 而非 200×200）。**这是无头浏览器假象，真实浏览器不受影响**，与本问题无关。
3. 改做**像素级**校验（帧差分找光标块 + 找 `$` 墨迹比对行/列）才复现：tab-53/56 的面板几乎没有文字，光标块孤零零画在空白处（tab-53 在第 18 行，最近的 `$` 在第 0 行），**光标离 `$` 有 17 行**。几何断言（viewportY/cursorRow 数学）此时依然全对 —— 只验数学不验像素会漏掉这一类。

**根因**：隐藏的 Panel（`display:none`）其 WebGL 画布会丢失绘制缓冲；切回来时 `fitWhenVisible` 因网格未变直接 return，没有任何重绘，于是面板空白、只剩光标闪烁层画的一个孤块。

**修复**：`ThemedTerminal.tsx` 的 IntersectionObserver 在面板重新可见时 `term.refresh(0, term.rows - 1)` 整缓冲重绘。

**证据**（`scripts/verify-terminal-cursor-alignment.mjs`，输出 `runtime/terminal-cursor-align/<stamp>/`）：

| 标签 | 修复前 | 修复后 |
|---|---|---|
| 47 / 54 / 57 | 光标紧邻 `$` 同行 | PASS |
| 53 | 面板空白，光标块在第 18 行，`$` 在第 0 行 | PASS（光标块 x 193–201，`$` 墨迹 x 188 同行紧邻） |
| 56 | 光标块与 `$` 差 2 行 | PASS |

修复后 **5/5 aligned**，截图可见 `x99-pc(87) 03:08:20 $` 后紧跟光标块。

**方法论补充**：像素级校验已入仓库（`verify-terminal-cursor-alignment.mjs`），与几何套件（`verify-terminal-viewport-visuals.mjs`）互补——后者此前在面板空白时仍报 PASS，因为只算坐标不看像素。

**限制**：仍只覆盖 release-test；双击选词、右键菜单、Ctrl+右键 tmux 菜单、手机端未纳入；AGENTS.md 动态视觉回归矩阵本轮 NOT RUN。

---

## 2026-10-17 切走再切回工作区后长历史 Panel 从 0 重放

候选 `0ddb7e5`，已部署 9444。生产 9443 未变更。

**现象**：tab2 的 panel 47 历史很长；先切到 tab1 再切回 tab2 时，内容没有直接显示在之前滚动到的历史位置，要点击其他标签或滚动一下才回来。

**根因**：面板隐藏（`display:none`）时浏览器把外层滚动条归零，而 xterm 自己的视口仍停在保存的历史行。实测切换后 77ms：`scrollTop=0`、`viewportY=467`、`xtermTop=-1008px` —— 滚动条在历史开头、xterm 视口在原位置，两者错位；354ms 后才被后续渲染纠正。终端本身并未重建（缓冲与 spacer 都在），所以历史越长、重放越慢，用户看到的「从 0 刷历史」就越久。

**修复**：IntersectionObserver 判定面板重新可见时，先 `desktopViewportRef.refresh()` 按 xterm 视口把滚动条对齐回保存行，再整缓冲重绘（后者是上一轮修空白面板用的）。

**证据**（同一探针，切换后逐帧采样）：

| | 修复前 | 修复后 |
|---|---|---|
| 首帧 t+72ms | `scrollTop=0`（历史开头） | `scrollTop=9219`（= 保存位置） |
| t+347ms 起 | 才回到 9219 | 保持 9219 |
| 视觉 | 先见历史开头再跳 | 首帧即历史 437–455 行 |

`viewportY=439` 与 `visibleFirstRow=439` 一致，首帧截图即停在保存的历史行。

**限制**：同屏多 Panel 一起隐藏/显示、以及刷新页面后的「重放+锚点恢复」路径未逐一回归；AGENTS.md 动态视觉回归矩阵正在跑，见下节。

---

## 2026-10-17 终端动态视觉回归矩阵（候选 `0ddb7e5`）

脚本 `scripts/verify-terminal-visual-matrix.mjs`，证据 `runtime/terminal-visual-matrix/20261017/`（截图未入库）。
浏览器 Chrome/Playwright 无头，DPR 1（另跑 390×844@3 与 844×390@3 手机仿真）。测试环境 9444。
**每轮均独立执行，结果不跨刷新沿用。** 测试前标签排列已核对并保留（过程中自动化动过两次顺序，均已按原样还原：ws1 pane=[49,54,50,51,52]，ws2 pane=[47,53,54,56,57]、[46,55]）。

| 行 | 测试前 | 普通刷新后 | 强刷后 |
| --- | --- | --- | --- |
| fill/readability 1920×1080 | PASS | **FAIL** | PASS |
| fill/readability 3440×1440 | PASS | PASS | PASS |
| Panel 标签（5 次点击 + 5 次 A→B→A） | PASS | PASS | PASS |
| 历史上/下 ×5（含滚轮步进与回底部） | PASS | PASS | PASS |
| 页面滚动 上/下/上 ×5 | PASS | PASS | PASS |
| 双显示 + 对端字号稳定 | PASS | PASS | PASS |
| 手机竖屏 | PASS | PASS | PASS |
| 手机横屏 | PASS | PASS | PASS |
| 连续输入（跨折行） | NOT RUN | NOT RUN | NOT RUN |
| 拖拽重排/还原 | NOT RUN | NOT RUN | NOT RUN |
| 工作区关闭 | NOT RUN | NOT RUN | NOT RUN |

**FAIL 说明（普通刷新后 1920×1080）**：共享 tmux 网格在双显示并存时被对端（3440×1440）拉高拉宽，
本地面板出现 `grids 103x24/113x18/114x18/93x32`、缺口 `r9,9,9,9,9,-81,-90,99 b7,7,7,7,7,133,133,-161`。
即清单所指的「共享网格宽高比冲突」——要求报告而非用拉伸字形掩盖。同轮 3440×1440 与其余两轮均 PASS。

**NOT RUN 说明**：

- 连续输入：需要一次性面板承载长按输入，自动化未能创建（+ 菜单路径未通）。
- 拖拽重排/还原：必须移动操作者自己的标签，自动化两次打乱顺序且无法按原样还原，故停做并还原布局；需在一次性布局上人工验证。
- 工作区关闭：破坏性，清单要求一次性测试账号/会话；未对操作者工作区执行。

**结论**：8/11 行三轮稳定 PASS；1 行在普通刷新后 FAIL（共享网格冲突，已报告）；3 行 NOT RUN。
按清单「任何缺失行都阻止全量视觉验收通过」，**本轮未达成全量视觉验收**。

---

## 2026-10-18 视觉矩阵补测（候选 `617c3b4`）

**新增/修复**：

- `automaticTerminalGeometry`：协商网格≠本端容量时强制重新主张尺寸（原先“已持有控制”短路，对端离开后网格永不回落）；面板可见、窗口聚焦时回收。逐个激活 8 个 Panel 后全部回到本端容量 `103x23`。
- `scripts/verify-terminal-visual-matrix-rows.mjs`：连续输入（一次性标签长按 1.5s，6 个中间帧）、拖拽重排（HTML5 拖放，`onDrop` 需落在目标右半侧才重排）+ 布局 API 精确还原。
- `scripts/verify-terminal-workspace-close.mjs`：屏蔽 `/api/auth/test-session` 后用一次性管理员账号，验取消保留、确认移除、末次关闭生成空工作区、强刷后仍在。

**矩阵结果（三轮独立：测试前 / 普通刷新后 / 强刷后）**：

| 行 | 测试前 | 普通刷新后 | 强刷后 |
| --- | --- | --- | --- |
| fill/readability 1920×1080 | PASS | PASS | PASS |
| fill/readability 3440×1440 | PASS | PASS | PASS |
| Panel 标签（5 点击 + 5 A→B→A） | PASS | PASS | PASS |
| 历史滚动 ×5 | PASS | PASS | PASS |
| 页面滚动 ×5 | PASS | PASS | PASS |
| 双显示 + 对端字号稳定 | PASS | PASS | PASS |
| 手机竖屏 / 横屏 | PASS | PASS | PASS |

另由独立 runner 覆盖：**连续输入 PASS**、**拖拽重排/还原 PASS**（5/5 重排、顺序精确还原）、
**工作区关闭 4 PASS / 1 NOT RUN**（取消保留 ✓、确认移除 ✓、末次关闭生成空工作区 ✓、强刷后仍在 ✓；「关闭期间对端新增 Panel 需重新确认」需第二客户端注入，NOT RUN）。

**fill 行说明**：先前的 FAIL 是上一轮手机/对端上下文把共享网格撑大后的残留；测量前先逐个激活 Panel 回收网格，三轮均回到 `103x24`（3440×1440 下各 Panel 网格随本地容量不同但缺口均 ≤12px）。

**布局**：测试全程两次打乱标签顺序，已按测试前记录还原并核对（ws1 `[49,54,50,51,52]`、ws2 `[47,53,54,56,57]`、`[46,55]`），一次性标签/账号均已清理。

---

## 2026-10-18 拖选到边缘自动滚动（候选 `6126174`）

**现象**：Bash 面板或 Claude/Codex CLI 面板里，鼠标拖动选择时无法向上/向下滚动，只能选中当前一屏内容。

**根因**：拖动选择只在 mousemove 里按指针位置延长选区，视口不动。指针到达面板上/下边缘后，同一位置映射到的缓冲行不再变化，选区就停在一屏之内。

**修复**：拖选过程中指针进入上/下边缘带（约 32px，随面板高度 12% 自适应，下限 16、上限 32）时启动 70ms 的自动滚动，每拍按 3 行滚动并用当前位置重算选区；松开按键或拖出边缘即停止。覆盖三处拖动路径：面板内拖动、拖出面板外的文档级拖动、以及“选择并复制”模式。

**证据**（9444，panel 47，400 行历史）：

| 量 | 值 |
| --- | --- |
| 拖动前视口 | `scrollTop=7497` |
| 拖动中（指针抵住上边缘 2.4s） | `7497 → 5544`，松开后 `5040` |
| 选中内容 | **120 行**（242–360），远超一屏 19 行 |
| 自动复制提示 | `已复制 (476)` |

Bash 与 Claude/Codex CLI 面板共用同一选择路径，行为一致。单测 249 通过、lint 干净、release-gate PASS。
