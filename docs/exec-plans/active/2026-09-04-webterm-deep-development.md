# WebTerm 深化开发分阶段实施计划（Spec v1.2）

> Status: 🟡 dev-1.0.4 — 移动端基线归并；剩余 P0 分阶段执行，未整体验收
> Created: 2026-09-04；Last synced: 2026-09-11
> Source spec: `docs/superpowers/specs/2026-09-04-WebTerm-Dev-Spec-v1.2.md`
> Target branch: `dev-1.0.4`（主仓库开发，不使用 worktree）
> Accepted production HEAD: `2df868a` / `rb-1.0.3`；用户确认“ok了”
> 本轮发布目标：9444 release-test；不自动推进生产或 rb-1.0.4

## 1. 目标

在不回退布局、tmux 会话、桌面交互与已验收移动端能力的前提下，归并 P0-MOB、建立可重复的移动端回归入口，并审计 M0/M3–M8 的剩余工作。工作区 Tab 已实现，不再列为下一新增功能。安全握手、断线恢复、布局增强、presence、广播组和完整性能验收仍按依赖执行，不因移动端已发布而整体打勾。

本计划只授权 P0 的设计与实现。P1/P2 先保留 backlog，不在 P0 顺手实现。

## 2. 开工前状态与约束

### 已验收基线

- 用户指定“pengguanzhen 已 commit 的提交视为验收通过”；当前验收边界为 `1cb938f`。
- 一屏 2×4（8 pane）、布局/会话 Tab 持久化、CLI 多屏历史、输入恢复、fullscreen 直接拖选复制和跨尺寸完整 grid 已完成。
- 双环境候选部署、批准、提升、回滚、受管重启和生产 secret 加载已完成。
- 已有 1,000 pane 容量 evidence；P0 日常门禁仍使用 24 shell，发布前可复跑大容量。
- 每个后续阶段仍需在最后一次修改后执行 fresh test/lint/build；历史提交验收不能代替新改动的回归。

2026-09-11 增量基线覆盖以上旧历史口径：`2df868a` 已同步 dev/rb-1.0.3 并部署9443，用户确认；88项 UI 测试及 lint/build/Go 通过。移动端已实现不等于完整 P0 或所有真机矩阵通过。详细需求以主 Spec 的 MOB-01–08 为准。

### 本轮审计与调整

| 问题 | 代码/证据 | 计划调整 |
|---|---|---|
| 旧版目标分支和“工作区 Tab 下一优先级”过时 | `2df868a`，M2 既有证据 | 更新分支/基线，M2 仅回归 |
| 手机依赖缩小完整 grid 的描述不实 | `MobileTerminalReader.tsx`、`useMobileViewport.ts` | 新增 M-MOB；阅读与原生输入分离、字号统一、触摸边缘历史、键盘恢复 |
| Control Mode 的传输完成被误读为 transcript/replay 完成 | `tmux_control.go` 与 reader 使用 SGR 历史导航 | 不宣称独立 Claude transcript 服务；主计划与补充计划注明边界 |
| WS 安全目标尚未落地 | `main.go` 仍注册 websocket.Handler；无 ws_ticket 模块 | M3 保留未完成，不由本次文档同步假装实现 |
| 自动重连仍有3次上限 | `useWebSocket.ts: MAX_RETRIES = 3` | M4 保留未完成，增加故障门禁后实施 |
| WebGL 已有实现 | `ThemedTerminal.tsx` WebglAddon / onContextLoss | M7 不重复安装；仍补性能与生命周期证据 |
| 双环境会话隔离已实现基础，不能重复开发或冒充新实测 | `main.go`注入`TmuxSocket`，`ws.go:scopeTmuxCommand`及`terminal_session_test.go` | 保留namespace实现；补跨环境不变量实测，preserve-terminal-sessions本身不等于隔离 |
| 临时QA脚本仅在 /tmp/runtime，无法从仓库复跑 | 1.0.3移动QA记录 | 将安全、参数化回归入口纳入版本控制；截图/日志写运行目录 |
| “100%”缺少分母 | 单测、模拟、真实浏览器、真机、容量是不同门禁 | 每项记 PASS/FAIL/NOT RUN；只报告实际执行结果，未跑不计PASS |

### M-MOB — dev-1.0.4 移动端收敛切片

- [x] 从 `2df868a` 创建主仓库 `dev-1.0.4`，保留生产 `rb-1.0.3`。
- [x] 主 Spec 收录 MOB-01–08 和用户验收边界，修正旧手机缩放描述。
- [x] 主计划与 Control Mode 补充计划同步实现事实、未完成事项与验收分母。
- [x] 固化参数化移动浏览器回归脚本：`scripts/verify-mobile.mjs`；测试URL、字体一致、触摸标签、键盘几何开合、截图/结果；默认拒绝生产。
- [x] 在最后修改后跑 UI 全测/lint/build、Go race/shuffle/vet、diff check；本轮88项UI测试通过。
- [x] dev-1.0.4 `f52b6ec`部署9444并执行浏览器回归，6组smoke断言通过；详情见`docs/qa/2026-09-11-mobile-1.0.4.md`。后续仅证据文档提交仍需重新部署并复跑smoke。
- [x] 真机 IME/横竖屏/长历史压力等未跑项目已单列；此项完成指完成记录，不是测试通过。

M3–M8 是否全部纳入本次1.0.4完成范围，需要用户确认本轮交付分母；先完成上述无争议切片，不擅自删减主计划剩余需求或宣称整个P0完成。

### 工作树保护

2026-09-05 开始本次文档同步前工作树为干净状态；原记录的 tmux mouse 与 Spec 修改均已进入提交。后续仍禁止 reset、checkout 或覆盖用户新出现的无关修改。

### 通用工程规则

- 用户2026-09-11明确要求：冻结已验收`2df868a`行为作为防回归基线。新版本不得破坏既有功能；默认只部署9444，生产9443必须对本次候选重新取得用户明确批准。以往批准、测试通过或commit/push不构成生产发布授权。此约束同步至`AGENTS.md`。

- 每个公开行为先记录 RED，再做最小 GREEN；重构后跑相关全测。
- 每阶段最多一个主题；数据库、协议和 UI 不在无关 PR 中顺带改。
- 所有新 WS 路径使用单写者；终端字节不静默 drop。
- 所有真实凭据只从环境读取，不进命令输出、日志、截图或 Git。
- 阶段验收在该阶段最后一次修改后执行；旧 evidence 不能代替 fresh run。

## 3. 阶段总览

| 阶段 | 范围 | 依赖 | 主要出口 |
|---|---|---|---|
| M0 | 基线冻结、测量夹具与双环境 tmux 隔离 | 无 | 🟡 CLI/容量夹具已完成；先关闭 test→production tmux 污染 |
| M1 | Codex/Claude CLI 历史、复制与跨尺寸显示 | M0 | ✅ 已提交并按当前口径验收；转回归门禁 |
| M2 | 工作区 Tab | 已验收 8 pane 基线 | ✅ 上层多 Tab、固定编号、重命名、v1→v2、真实浏览器多端验收通过 |
| M3 | **WS 安全与单写者（下一优先级）** | M2 | upgrade 前授权、Origin、ticket、无 race |
| M4 | tmux/SSH 保活与自动重连 | M3 | 断网/服务重启恢复、明确生命周期 |
| M5 | 布局增强、divider 与冲突 UX | M2、M4 | 保持已验收 8 pane，补 1×1/4×2、拖动同步、CAS 收敛 |
| M6 | presence 与共享广播组 | M5 | distinct client presence、8 pane 一次广播 |
| M7 | WebGL fallback 与性能稳定 | M4、M5 | 受控负载达到门槛、context loss 可恢复 |
| M8 | 三端系统验收与 P0 发布 | M1–M7 | 全门禁、证据包；复用已验收双环境提升/回滚链路 |

M6 和 M7 在 M5 契约稳定后可并行开发，但合并前分别在最新共同基线上复验。M2 已完成，下一阶段按依赖进入 M3；pane 内现有会话 Tab、已验收的一屏 8 pane 和 M1 不重复开发。

## 4. M0 — 基线冻结与测试夹具

实施状态（2026-09-05）：部分完成。CLI synthetic fixture、真实会话 evidence 和容量 evidence 已提交并验收；WS 握手、故障注入和 renderer/performance 夹具在对应后续阶段补齐。

### M0-0 双环境 tmux 隔离（新增 P0 门禁）

9443 production 与 9444 release-test 必须使用不同的远端 tmux socket/namespace。2026-09-11核对：`main.go`已经为release-test注入`webterm-release-test`，`WSHandler.TmuxSocket`与`scopeTmuxCommand`已经实现，相关单测存在。不重复实现这部分；仍需以跨环境不变量测试证明attach/resize/关闭全过程隔离。`-preserve-terminal-sessions`只隔离测试布局清理，不能单独作为namespace的证明。

出口条件：在同一连接快照上，release-test 的 attach/resize/滚动/输入/关闭操作不会改变 production session 的 options、window size、history、pane PID 或输出；production 现有 session 不迁移、不 kill。

### 目的

先把“如何证明”做好，避免功能完成后才发现 45fps、断网、握手状态或多端一致性无法复现。

### 实施任务

1. 保存 `git status --short`、依赖版本、Go/Node/Chrome/tmux 版本和当前 LAN 配置的脱敏摘要。
2. 给现有 WS handler 建立可断言 HTTP upgrade 前状态的测试 harness。
3. 扩展浏览器 fixture：三个独立 browser context/process + mobile viewport；每端注入独立 `clientID`。
4. 新增受控 terminal output fixture：每 pane 64 KiB/s、可停止、带序号，禁止无界 `yes`。
5. 新增性能采集器：frame interval、page error、layout revision latency、renderer/memory observation。
6. 固化共享 snapshot 比较器，只比较 Spec 的共享字段。
7. 增加 synthetic alternate-screen/mouse-reporting TUI fixture，并准备真实 Codex 0.145.0、Claude Code 2.1.246 的临时无敏感内容验收会话。

### 主要文件

- `handler/*_test.go`：WS pre-upgrade harness。
- `scripts/`：新增多端协同与 8-pane perf 脚本。
- `ui/src/components/layout/layoutPersistence*.ts`：共享字段比较/fixture。
- `docs/exec-plans/active/*-evidence.md`：阶段 evidence。

### 剩余 RED 场景

- 当前未授权 WS 会先 upgrade，测试应失败。
- 当前 3 次重连后停止，长断网场景应失败。
- 当前无 renderer/performance observation，性能采集断言应失败。
- CLI 历史原 RED 已由 M1 关闭，保留为后续阶段不得回归的固定门禁。

### 出口门禁

- 原基线全绿；新增 harness 可稳定重现上述缺口。
- 负载 fixture 可在异常时可靠清理远端进程与临时用户。
- 不改产品行为。

## 5. M1 — Codex/Claude CLI 历史、复制与跨尺寸显示（已验收）

实施状态（2026-09-05）：`955d265`–`e14aacf` 与 `d1ef4ab` 已提交；按用户指定口径视为验收通过。历史导航、恢复输入、Claude 长会话兜底、fullscreen 直接拖选复制、选择快照和“大屏铺满 + 小屏完整缩放”均转为回归门禁。证据见 `2026-09-04-webterm-cli-history-evidence.md`。

### 先做诊断矩阵

在同一个 WebTerm terminalID 中分别记录以下组合，不能先假定 `tmux mouse on` 已经解决：

| CLI/模式 | wheel | PgUp | transcript | xterm scrollbar | 是否污染输入 |
|---|---|---|---|---|---|
| shell main screen | 测 | 测 | N/A | 测 | 测 |
| Claude default inline | 测 | 测 | `/export`/session | 测 | 测 |
| Claude `/tui fullscreen` | 测 | 测 | Ctrl+O | 不应作为主路径 | 测 |
| Codex default TUI | 测 | 测 | Ctrl+T | 不应作为唯一依据 | 测 |
| Codex `--no-alt-screen` | 测 | 测 | Ctrl+T | 测 | 测 |

### 已实施的后端/tmux 内容（保留回归）

1. session-scoped `mouse on` 已提交并验证；设置只作用于 WebTerm session，不修改用户其他 tmux session。
2. 检查 tmux mouse/copy-mode 与两个 attach client 的作用域，记录 history navigation 是否会改变其他端画面。
3. 如需 terminal action，增加受控的 history/copy-mode action；服务端重新派生 session target，不接受客户端传 tmux 名或任意命令。
4. 普通 shell 的 tmux history 保持 200,000 行；解决全局 `history-limit` 副作用时不得降低本阶段能力。

### 已实施的前端内容（保留回归）

1. 增加 history mode indicator/help，区分“终端历史”和“CLI 内部 transcript”。
2. 正确透传 Claude fullscreen 请求的 SGR wheel；加入 `PgUp/PgDn`、`Ctrl+Home/End` 的可发现入口，不能抢走 CLI 已声明的 key handling。
3. 定义并测试 `Shift+wheel` history override；若 tmux/CLI 组合不能安全工作，显示明确替代入口，禁止发送猜测性的 escape sequence。
4. 增加“Codex 可回看模式”显式启动入口，发送 `codex --no-alt-screen`；只允许用户在空闲 shell 主动触发，不写用户 dotfiles，不添加权限绕过参数。
5. Claude 帮助入口说明 `/tui fullscreen`、Ctrl+O transcript 和 `[` 写入 scrollback；不静默设置远端全局 `CLAUDE_CODE_NO_FLICKER`。
6. 保持普通右键为 WebTerm 菜单、Ctrl+右键 tmux 操作、Shift+drag 文本选择、复制粘贴和中文 IME；fullscreen mouse-reporting CLI 另提供不向远端发送鼠标事件的显式“选择并复制”模式。

### 自动化与真实 CLI 验收基线

1. synthetic fixture 覆盖 alternate screen、DEC alternate scroll、SGR mouse 1000/1002/1003/1006、关闭 mouse mode 和异常退出清理。
2. Claude 2.1.246 临时 session 生成 ≥5 屏 numbered marker；wheel/PgUp 找到早期 marker，Ctrl+End 后继续输入，Ctrl+O transcript 可打开退出。
3. Codex 0.145.0 临时 session 同样生成 ≥5 屏 marker；`--no-alt-screen` 用 xterm scrollback 回看，默认 TUI 用 Ctrl+T 回看。
4. 两个 CLI 各注入 100 次 wheel/trackpad，读取 composer/终端输出，证明无 raw SGR sequence。
5. 两浏览器 attach 同一 session，历史操作后 terminalID/tmux session 不变、无 detach/kill；记录是否共享改变 TUI viewport。
6. 1 pane 与 8 pane 各执行；真实凭据不回显，临时 session 和测试输出可清理。

### 出口门禁

- Spec `CLI-*` 全绿，或明确记录某条上游限制并提供已验证的原生 transcript fallback；不能以“tmux history_size > 0”代替用户实际看见早期内容。
- 当前用户报告的 Claude“一屏历史”场景有 before-fail/after-pass 截图或视频与 marker 证据。
- Codex/Claude 版本、tmux/浏览器版本和操作路径写入 evidence。
- mouse、右键、选择、复制、IME、持久 attach 既有回归全绿。

## 6. M2 — 工作区 Tab（已完成，保留回归）

实施状态（2026-09-05）：已完成并在发布测试环境通过。实现 schema v2、v1 无损迁移、固定编号、重命名、默认空白/显式复制、多端独立 active workspace；证据见 `2026-09-05-webterm-workspace-tabs-evidence.md`。

### 产品与数据任务

1. 明确层级：`workspace tab → pane layout → session tabs`。工作区 Tab 使用独立 `id/index/name`；pane 内会话 Tab 保留现有 `id/title/labelNumber/connId`。
2. 将 layout schema 从 v1 单一 `{tree, panes}` 升级为 v2 `workspaceTabs[]`；每个工作区 Tab 保存 `id/index/name/layout`，不新增数据库表。
3. 编写纯函数 v1 → v2 迁移：现有布局成为第一个工作区 Tab，所有 pane、会话 Tab、terminalID、connId 和 labelNumber 原样保留；迁移幂等且失败不写半成品。
4. 工作区 Tab 的 `index` 在当前用户集合内唯一，创建时分配，在生命周期内不因重命名、切换、刷新或同步改变。
5. 工作区 Tab 集合、索引、名称和每项布局属于共享字段；`activeWorkspaceTabId`、focused pane 和 pane 内 active session Tab 保持浏览器本地。
6. 新建支持“空白”和“复制当前布局”两种模式，默认“空白”；空白模式创建空白 1 pane，复制模式生成新的 workspace/pane ID。复制后的 terminalID 策略在实现前写入 Decision Log，硬约束是不误杀原会话。

### UI 任务

1. 在 pane 网格之上新增工作区 TabBar，显示 `<index>: <name>`；与每个 pane 内现有会话 TabBar 在组件、样式和可访问名称上明确区分。
2. 提供新增、切换和重命名入口。新增时可选“空白”或“复制当前布局”且默认选中“空白”；重命名只改 `name`，Enter 提交、Escape 取消、失焦提交，空白名称保持原值。
3. 切换只改变当前可见 pane 网格；隐藏工作区 Tab 内的 tmux session 保持存活，不能触发终端关闭 API。
4. 允许工作区 Tab 重名，以固定索引区分；长名称视觉截断但保留完整 tooltip/accessible name，HTML 特殊字符按文本显示。
5. 第一切片不实现工作区 Tab 删除、排序、搜索和跨浏览器窗口拖拽；新增时“复制当前布局”已经实现，不得与后续单独的复制管理操作混淆。

### 必测场景

- 用生产布局副本执行 v1 → v2：原一屏 8 pane 成为工作区 Tab 1，所有 pane/会话 Tab/terminalID/tmux session 和输出连续。
- 不改变新增选项时创建空白 1 pane；主动选择“复制当前布局”时复制 pane 布局且所有新 workspace/pane ID 唯一。
- 创建至少 3 个工作区 Tab，索引唯一且始终显示；`3: workspace` 重命名后成为 `3: production`。
- 三个工作区 Tab 各自保存不同 pane 布局；反复切换、刷新和服务重启后分别恢复。
- 两个浏览器看到相同的工作区 Tab 集合、索引、名称和布局，但可停留在不同 active workspace Tab。
- 切换工作区 Tab 不触发 `DELETE /api/terminal-sessions/...`，隐藏 Tab 的远端进程继续运行。
- 重复名、空白名、超长名、HTML 特殊字符、并发重命名冲突和迁移失败路径均有自动化覆盖。

### 出口门禁

- Spec `TAB-*` 与 `E2E-TAB-1` 全绿；“空白/复制”两种创建路径和默认空白均有自动化覆盖，复制模式的 terminalID 策略已在 Decision Log 拍板。
- 基础 1 pane/8 pane、CLI 历史/复制、跨尺寸缩放和显式关闭语义不回归。
- fresh UI tests、lint、production build、Go layout/session tests 和数据库副本迁移验证全绿，evidence 写入独立阶段工件。

## 7. M3 — WS 安全、ticket 与单写者

### 后端任务

1. 新建短期 ticket service：随机 token、TTL、single-use、route/resource binding、过期清理。
2. 新增 `POST /api/ws-tickets`，在 REST JWT 上下文中先校验用户和资源权限。
3. 用可返回 HTTP 状态的握手 wrapper 替代直接 `websocket.Handler` 注册；校验 ticket 和严格 Origin 后才 upgrade。
4. SSH/SFTP/DB/layout 四类 WS 迁移；保留测试专用或配置化 legacy query JWT，生产默认关闭。
5. 新建 WS outbound pump；stdout、stderr、heartbeat、error 统一串行发送。
6. 设置 payload/resize 上限和 typed error code；慢消费者超预算断开，不 drop terminal bytes。
7. 把 JWT signing secret 迁入稳定配置；LAN check 拒绝缺失/弱 secret，开发模式显式 warning。

### 前端任务

1. API client 增加 ticket 获取和错误类型。
2. `useWebSocket` 在每次 connect/reconnect 前异步获取新 URL/ticket。
3. 401/403 进入 non-retryable 状态；清理 URL、console 与错误 UI 中的 token。

### 建议模块边界

- `auth/`：稳定 JWT 配置，不承载 WS ticket 生命周期。
- `handler/ws_ticket.go`：REST handler 与资源授权。
- `handler/ws_upgrade.go`：Origin/ticket/upgrade adapter。
- `handler/ws_outbound.go`：单写者与背压。
- `ui/src/hooks/useWebSocket.ts`：连接状态机，URL factory 而非固定 URL。

### 必测场景

- ticket single-use、过期、错 endpoint、错 conn、错 terminal、跨用户。
- 未授权/跨 Origin 在 101 前返回 401/403。
- connection update/delete 后旧 ticket 不能越权。
- stdout + stderr + heartbeat 并发，`go test -race` 无报告且帧完整。
- URL/日志脱敏测试。

### 出口门禁

- Spec `SEC-*` 全绿。
- 现有真实 SSH/SFTP/DB/layout smoke 全绿。
- 生产配置不接受 legacy JWT query；无凭据泄漏 evidence。

## 8. M4 — tmux 预检、SSH keepalive 与自动重连

### 后端任务

1. 抽象 remote command runner 与 tmux version parser；稳定错误码：`TMUX_MISSING`、`TMUX_TOO_OLD`、`TMUX_VERSION_UNKNOWN`。
2. 连接配置变更时使预检缓存失效；缓存不能绕过每次资源授权。
3. 审计 `set-option -g history-limit` 对远端用户 tmux 的影响；形成 ADR：专用 socket/namespace 或兼容保留方案。
4. 为每个 SSH transport 建立 keepalive lifecycle；失败时标记 transport dead 并终止相关 session，让浏览器重连。
5. 完成 app ping/pong、activity deadline、shutdown event；所有发送走 M3 pump。
6. 保持显式 tab close 立即 kill，普通 detach 不 kill；删除 API 继续幂等。

### 前端任务

1. 重构 `useWebSocket` 为状态机：connecting/open/backoff/offline/auth-failed/disposed。
2. full-jitter 1–30 秒、无限生命周期重试；浏览器 offline 暂停，online 立即恢复。
3. ping/pong 不写终端；重连后发真实 resize，控制通道重新 GET revision。
4. 用 pane overlay/status bar 表达连接状态，不向终端缓冲区反复写“重连中”污染 shell 输出。

### 必测场景

- tmux 3.0/3.1/3.10、缺失和异常版本文本。
- 断网 30 秒、5 分钟；服务端 restart；SSH transport 被服务端断开。
- mounted 状态持续重试，unmount 后无 timer/socket 泄漏。
- refresh/detach 不 kill；明确 close kill 且重复 close 成功。
- tmux mouse 既有测试保持通过。

### 出口门禁

- Spec `REL-*` 全绿。
- Playwright 实际 tmux session ID/marker 证明重连到同一会话。
- 30 分钟 idle soak 无 ghost session/transport 泄漏。

## 9. M5 — 布局增强、divider 与冲突收敛

### 数据与协议任务

1. 冻结现有 schema v2 工作区共享/本地字段；广播组需要升级 schema 时，先定义新版本与 round-trip 迁移，不重复迁移至已经存在的v2。
2. 统一 API 字段为现有 `schema_version/revision/layout`，删除实现文档中的 `baseRevision` 第二套叫法。
3. 服务端错误返回稳定 code（如 `LAYOUT_CONFLICT`），前端不匹配中文 message。

### UI 任务

1. 保持已验收的一屏 2×4（8 pane）行为；在其基础上增加 4×2、1×1，并提供明确模板入口。
2. 模板替换保留原 pane tabs，新增 pane 空置；一次操作、一次 snapshot save。
3. 实现 grid divider pointer drag：rAF 合并、ratio clamp/normalize、pointer capture、键盘可访问调整。
4. 拖动期间只改 CSS；结束后统一 fit 和防抖保存。
5. 409 时暂停当前 save、拉取权威布局、提示冲突；不得保存循环。
6. 保持 focused pane/active tab/zoom/scroll 本地，不发布到其他端。

### 必测场景

- preset 结构、ID 唯一、tab 保留、空 pane 规则。
- divider mouse/touch/keyboard，ratio 边界，小 viewport。
- 每次 drag 的 PUT 次数上限、terminal resize 次数上限。
- 双客户端同时修改：1 success + 1 conflict，最终深比较一致。
- 旧 schema 数据、失效连接过滤、服务重启恢复。

### 出口门禁

- Spec `LAYOUT-*` 全绿。
- A→B layout sync p95 ≤ 1 秒。
- 无 pane remount、terminalID 改变或 tmux session 重建。
- axe/键盘检查覆盖 divider 与模板入口。

## 10. M6 — presence 与广播组

### 后端任务

1. 新增并发安全 registry，键为 `userID + terminalID + clientID`，带 15 秒重连 grace 和到期清理。
2. 扩展 layout/control hub 为 typed events；presence snapshot 用于首连，delta 用于后续。
3. 任何 disconnect、auth failure、session end、server shutdown 路径都能释放 registry；重复释放幂等。
4. 用户隔离测试确保 presence 不跨 user 泄漏。

### 前端任务

1. 建立 sessionStorage `clientID` 和可选本地 device label；escape 后显示。
2. 在 terminal/tab title 附近显示 online count 与 tooltip，避免把 socket 数称为“人数”。
3. schema v2（若采用）保存 `broadcastGroup`；source terminal 与 source device 仍为本地态。
4. 广播只覆盖每个可见 pane 的 active SSH tab；去重 terminalID，源端之外每目标只 send 一次。
5. 增加明显 armed 状态、关闭快捷入口和多行 paste 确认。

### 必测场景

- join/leave、refresh grace、网络抖动、重复 socket、abrupt close、server shutdown。
- 跨用户隔离，device label XSS。
- 8 目标一次广播、隐藏 tab 不执行、重复 terminalID 去重、DB tab 排除。
- 另一设备输入仍可生效；产品文案不宣称强制只读。

### 出口门禁

- Spec `COLLAB-*` 全绿。
- 多端录屏/截图和 server counter 共同证明 presence 与广播一次性。
- registry 在 soak 后回到零，无 goroutine/timer leak。

## 11. M7 — WebGL fallback 与性能稳定

### 实施任务

1. 核验已安装的 `@xterm/addon-webgl` 与现有 load/context-loss fallback；不重复实现已交付基础，补齐性能/资源释放门禁。
2. 封装 renderer lifecycle：load、active renderer observation、context loss、dispose、DOM fallback。
3. 可见 pane active tab 同时 mount；不可见 tab 才释放 WebGL，且 terminalID/tmux 不变。
4. 合并 ResizeObserver 到 rAF；cols/rows 未变不发；drag 结束才 fit。
5. 运行 M0 fixture 再决定是否需要应用层 output batching；每项优化单独保留 before/after trace。
6. 进行 30 分钟 tab churn + output soak，关注 WebGL context 数、context loss 和内存斜率。

### 必测场景

- WebGL 支持/禁用/load throw/运行中 context loss。
- 8 pane 连续输出与输入同时发生；一个 pane 高流量不拖死其他 pane。
- 反复 split/close/restore 后 renderer 数与 pane 数一致。
- DOM fallback 下 resize、中文、emoji、selection、ZMODEM smoke 不回归。

### 出口门禁

- Spec `PERF-*` 全绿或有经批准的门槛调整 Decision Log。
- 没有白屏、page error、持续线性内存增长。
- before/after 原始 trace 和环境信息入 evidence，不只写结论。

## 12. M8 — 三端整体验收与发布

### 系统场景

1. 生产 build + Go + Caddy LAN 配置启动，验证 loopback/allowlist/certificate。
2. 三个独立桌面客户端 + mobile viewport，以同一账号恢复 8 pane。
3. 先复验工作区 Tab 的固定编号、重命名、切换和 v1 布局迁移，再复验 Claude/Codex 多屏历史，之后依次执行：layout drag、冲突、presence、广播、30 秒断网、5 分钟断网、服务重启、WebGL fallback。
4. 验证 A 关闭后 B/C 不中断；A 重开恢复，且不覆盖 B/C 当前权威布局。
5. 运行 24 shell gate；资源允许时复跑现有 1,000 pane non-regression。
6. 在数据库副本验证升级和旧二进制回滚；远端 tmux session 不因部署切换被 kill。

### 最终命令

```text
go test -race ./... -count=1
go test -shuffle=on ./... -count=1
go vet ./...
npm --prefix ui test
npm --prefix ui run lint
make build
./scripts/lan-up.sh check
git diff --check
```

再运行 M0 建立的 multi-client、fault、capacity、performance 脚本。命令中的 secret 只能通过未回显环境注入。

### P0 Done When

- Spec E2E-1 至 E2E-9、E2E-TAB-1、PERF-1 全部有 fresh evidence。
- 所有功能 requirement 能映射到自动测试或明确的人工/环境验收。
- 无 token/密码/私钥进入 Git、日志、截图、trace。
- 已知限制写入 README/部署文档：同账号限制、tmux ≥ 3.1、手机阅读/原生输入分离与历史保留边界、显式 close 语义；手机阅读裁切不再作为可接受限制。
- 有升级步骤、回滚步骤和数据兼容证明。

## 13. P1/P2 Backlog（不属于本计划 Done）

- P1：Snippets、pane 内会话 Tab Manager、端口转发、会话管理、条件式 WS mux spike。P1 的会话 Tab Manager 与 M2/P0 的上层工作区 Tab 不是同一能力。
- P2：AI、可追责审计、危险命令软门禁、移动端权限模型。

每项开始前从 Spec v1.2 的进入条件生成独立规格和实施计划；不得因为列在 backlog 就直接编码。

## 14. Decision Log

| 日期 | 决策 | 原因 |
|---|---|---|
| 2026-09-04 | 用 Spec v1.2 取代 v1.1 作为实现依据 | v1.1 与现有代码和上游 xterm/tmux 行为有多处不一致 |
| 2026-09-04 | P0 不做布局增量 merge | 当前协议是 snapshot CAS；先保证确定收敛 |
| 2026-09-04 | P0 不做 orphan TTL | 避免误杀明确要求长期存活的任务 |
| 2026-09-04 | xterm 6 fallback 为 DOM | Canvas renderer 已移除 |
| 2026-09-04 | mux 增加 benchmark gate | 24 WS 未证明是瓶颈；单 TCP 有 HOL/故障域风险 |
| 2026-09-04 | presence 按 terminalID/clientID | 当前会话身份属于 tab，不是 leaf pane；socket 数不等于端数 |
| 2026-09-04 | CLI 历史回看成为第一个 P0 阻塞阶段 | 用户当前 Claude CLI 只能查看一屏，直接影响核心使用场景 |
| 2026-09-04 | CLI 原生历史优先、tmux/xterm 兜底 | alternate screen 不会自然进入 xterm 主 scrollback，必须按实际 renderer 路由 |
| 2026-09-05 | pengguanzhen 已 commit 的功能改动视为验收通过 | 按用户指定的计划同步口径更新已完成项，不重复排期 |
| 2026-09-05 | 一屏 8 pane 完成后优先实施工作区 Tab | 新层级位于 pane 网格之上，早于 WS 安全、重连和布局增强 |
| 2026-09-05 | 工作区 Tab 编号与名称分离 | 固定数字索引用于稳定识别，重命名只改变名称；pane 内会话 Tab 保持现状 |
| 2026-09-05 | 新建工作区 Tab 可选空白或复制，默认空白 | 默认操作保持轻量且不意外复制现有布局；需要时由用户显式选择复制 |
| 2026-09-05 | 复制布局生成新的 pane、会话 Tab 与 terminalID | 当前 `Tab.id` 即 terminalID；生成全新身份可避免关闭副本时误杀原 tmux 会话，仅复用连接、标题和显示编号 |

## 15. Progress Notes

- [2026-09-11] `2df868a`生产版本用户确认；创建dev-1.0.4。主Spec追加MOB-01–08，归并横滑标签、换行、触摸历史、去白线、统一字号和键盘视口恢复；同步主/补充计划，不将剩余P0自动视为验收。

- [2026-09-04] 计划创建。完成代码事实核对、现有 evidence 核对、官方 xterm/tmux/Go websocket 资料核对。
- [2026-09-04] 基线通过：Go 全测；UI 14 files / 39 tests；lint；production build。
- [2026-09-04] 计划创建时尚未开始本计划的新产品代码实现；M0 为当时第一个执行阶段。
- [2026-09-04] 用户追加最高优先级：Codex/Claude 等 CLI 必须能回看多屏历史。已将其设为 M1 阻塞门，并按本机 Codex 0.145.0、Claude 2.1.246、tmux 3.5a 建立真实验收矩阵。
- [2026-09-05] 验收边界推进到 `1cb938f`。M1 的历史、输入恢复、fullscreen 复制和跨尺寸缩放均已提交并按用户口径验收；双环境发布链路也已完成。
- [2026-09-05] 用户确认一屏 8 pane 已实现；下一步优先实现工作区 Tab。Spec 与本计划均补充工作区 Tab 可重命名、前置固定数字索引、v1→v2 无损迁移和多端验收标准，并与既有 pane 内会话 Tab 明确区分。
- [2026-09-05] 用户拍板新建工作区 Tab 同时提供“空白”和“复制当前布局”，默认“空白”；原待确认项关闭。
- [2026-09-05] M2 完成：schema v2、v1→v2、工作区 TabBar、固定编号、重命名和两种创建模式均已实现；复制生成全新 terminalID，避免误杀原 tmux。
- [2026-09-05] 真实 Chrome 自动化以 8-pane v1 布局完成迁移/复制、双浏览器、移动 viewport、刷新和 9444 服务重启复验；0 session DELETE、0 页面/控制台/HTTP 错误。M3 成为下一优先级。
