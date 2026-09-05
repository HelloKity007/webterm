# WebTerm 深化开发分阶段实施计划（Spec v1.2）

> Status: 🟡 Ready
> Created: 2026-09-04
> Source spec: `docs/superpowers/specs/2026-09-04-WebTerm-Dev-Spec-v1.2.md`
> Target branch: `dev-1.0.0`
> Baseline HEAD: `686d03e`

## 1. 目标

在不回退现有布局持久化、tmux 持久终端、容量分片、SFTP/DB/OneKey 能力的前提下，先解决 Codex/Claude 等 CLI 只能查看一屏历史的问题，再交付可实际用于“同账号三端 + 8 pane”的其余 P0：安全握手、断线恢复、布局拖动、presence、广播组、WebGL fallback 和可重复的性能/多端验收。

本计划只授权 P0 的设计与实现。P1/P2 先保留 backlog，不在 P0 顺手实现。

## 2. 开工前状态与约束

### 已验证基线

- `go test ./...`：通过。
- `npm --prefix ui test`：14 files / 39 tests 通过。
- `npm --prefix ui run lint`：通过。
- `npm --prefix ui run build`：通过。
- 已有 1,000 pane 容量 evidence；P0 日常门禁使用 24 shell，发布前可复跑大容量。

### 工作树保护

当前已有用户未提交修改：

- `handler/persistent_terminal.go`
- `handler/persistent_terminal_test.go`
- `scripts/verify-persistent-terminal.mjs`
- Spec v1.1

这些修改包含 tmux mouse 行为，属于既有工作。每阶段必须基于它们增量实现，禁止 reset、checkout 或覆盖。

### 通用工程规则

- 每个公开行为先记录 RED，再做最小 GREEN；重构后跑相关全测。
- 每阶段最多一个主题；数据库、协议和 UI 不在无关 PR 中顺带改。
- 所有新 WS 路径使用单写者；终端字节不静默 drop。
- 所有真实凭据只从环境读取，不进命令输出、日志、截图或 Git。
- 阶段验收在该阶段最后一次修改后执行；旧 evidence 不能代替 fresh run。

## 3. 阶段总览

| 阶段 | 范围 | 依赖 | 主要出口 |
|---|---|---|---|
| M0 | 基线冻结与测量夹具 | 无 | 可重复基线、协议测试工具、风险清单 |
| M1 | **Codex/Claude CLI 历史回看** | M0 | 真实 CLI 可回看 ≥5 屏、无鼠标协议污染 |
| M2 | WS 安全与单写者 | M1 | upgrade 前授权、Origin、ticket、无 race |
| M3 | tmux/SSH 保活与自动重连 | M2 | 断网/服务重启恢复、明确生命周期 |
| M4 | 布局模板、divider 与冲突 UX | M3 | 2×4/4×2、拖动同步、CAS 收敛 |
| M5 | presence 与共享广播组 | M4 | distinct client presence、8 pane 一次广播 |
| M6 | WebGL fallback 与性能稳定 | M3、M4 | 受控负载达到门槛、context loss 可恢复 |
| M7 | 三端系统验收与 P0 发布 | M1–M6 | 全门禁、证据包、回滚验证 |

M5 和 M6 在 M4 契约稳定后可并行开发，但合并前分别在最新共同基线上复验。**M1 是最高优先级阻塞阶段：真实 Claude/Codex 历史验收未通过，不进入 M2。**

## 4. M0 — 基线冻结与测试夹具

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

### RED 场景

- 当前未授权 WS 会先 upgrade，测试应失败。
- 当前 3 次重连后停止，长断网场景应失败。
- 当前无 renderer/performance observation，性能采集断言应失败。
- 当前 Claude CLI 只能看到约一屏内容，真实 CLI history marker 断言应失败。

### 出口门禁

- 原基线全绿；新增 harness 可稳定重现上述缺口。
- 负载 fixture 可在异常时可靠清理远端进程与临时用户。
- 不改产品行为。

## 5. M1 — Codex/Claude CLI 历史回看（最高优先级阻塞阶段）

实施状态（2026-09-04）：代码与 synthetic tmux/TUI 回归已完成；真实用户已确认 Claude fullscreen 历史 wheel/PgUp 可用。不同尺寸并发 attach、恢复输入和 CLI 复制粘贴优化已实现，待用户复验。证据见 `2026-09-04-webterm-cli-history-evidence.md`。

### 先做诊断矩阵

在同一个 WebTerm terminalID 中分别记录以下组合，不能先假定 `tmux mouse on` 已经解决：

| CLI/模式 | wheel | PgUp | transcript | xterm scrollbar | 是否污染输入 |
|---|---|---|---|---|---|
| shell main screen | 测 | 测 | N/A | 测 | 测 |
| Claude default inline | 测 | 测 | `/export`/session | 测 | 测 |
| Claude `/tui fullscreen` | 测 | 测 | Ctrl+O | 不应作为主路径 | 测 |
| Codex default TUI | 测 | 测 | Ctrl+T | 不应作为唯一依据 | 测 |
| Codex `--no-alt-screen` | 测 | 测 | Ctrl+T | 测 | 测 |

### 后端/tmux 任务

1. 保留并验证当前未提交的 session-scoped `mouse on` 改动；确认设置只作用于 WebTerm session，不修改用户其他 tmux session。
2. 检查 tmux mouse/copy-mode 与两个 attach client 的作用域，记录 history navigation 是否会改变其他端画面。
3. 如需 terminal action，增加受控的 history/copy-mode action；服务端重新派生 session target，不接受客户端传 tmux 名或任意命令。
4. 普通 shell 的 tmux history 保持 200,000 行；解决全局 `history-limit` 副作用时不得降低本阶段能力。

### 前端任务

1. 增加 history mode indicator/help，区分“终端历史”和“CLI 内部 transcript”。
2. 正确透传 Claude fullscreen 请求的 SGR wheel；加入 `PgUp/PgDn`、`Ctrl+Home/End` 的可发现入口，不能抢走 CLI 已声明的 key handling。
3. 定义并测试 `Shift+wheel` history override；若 tmux/CLI 组合不能安全工作，显示明确替代入口，禁止发送猜测性的 escape sequence。
4. 增加“Codex 可回看模式”显式启动入口，发送 `codex --no-alt-screen`；只允许用户在空闲 shell 主动触发，不写用户 dotfiles，不添加权限绕过参数。
5. Claude 帮助入口说明 `/tui fullscreen`、Ctrl+O transcript 和 `[` 写入 scrollback；不静默设置远端全局 `CLAUDE_CODE_NO_FLICKER`。
6. 保持普通右键为 WebTerm 菜单、Ctrl+右键 tmux 操作、Shift+drag 文本选择、复制粘贴和中文 IME。

### 自动化与真实 CLI 验收

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

## 6. M2 — WS 安全、ticket 与单写者

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

## 7. M3 — tmux 预检、SSH keepalive 与自动重连

### 后端任务

1. 抽象 remote command runner 与 tmux version parser；稳定错误码：`TMUX_MISSING`、`TMUX_TOO_OLD`、`TMUX_VERSION_UNKNOWN`。
2. 连接配置变更时使预检缓存失效；缓存不能绕过每次资源授权。
3. 审计 `set-option -g history-limit` 对远端用户 tmux 的影响；形成 ADR：专用 socket/namespace 或兼容保留方案。
4. 为每个 SSH transport 建立 keepalive lifecycle；失败时标记 transport dead 并终止相关 session，让浏览器重连。
5. 完成 app ping/pong、activity deadline、shutdown event；所有发送走 M2 pump。
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

## 8. M4 — 布局模板、divider 与冲突收敛

### 数据与协议任务

1. 冻结现有 schema v1 共享/本地字段；若广播组需要 v2，先写迁移函数和 round-trip 测试。
2. 统一 API 字段为现有 `schema_version/revision/layout`，删除实现文档中的 `baseRevision` 第二套叫法。
3. 服务端错误返回稳定 code（如 `LAYOUT_CONFLICT`），前端不匹配中文 message。

### UI 任务

1. 在现有 2×4 基础上增加 4×2、1×1；提供明确模板入口。
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

## 9. M5 — presence 与广播组

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

## 10. M6 — WebGL fallback 与性能稳定

### 实施任务

1. 安装与 xterm 6 匹配的 `@xterm/addon-webgl`，记录 lockfile 变化和许可证。
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

## 11. M7 — 三端整体验收与发布

### 系统场景

1. 生产 build + Go + Caddy LAN 配置启动，验证 loopback/allowlist/certificate。
2. 三个独立桌面客户端 + mobile viewport，以同一账号恢复 8 pane。
3. 先复验 Claude/Codex 多屏历史，再依次执行：layout drag、冲突、presence、广播、30 秒断网、5 分钟断网、服务重启、WebGL fallback。
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

- Spec E2E-1 至 E2E-9、PERF-1 全部有 fresh evidence。
- 所有功能 requirement 能映射到自动测试或明确的人工/环境验收。
- 无 token/密码/私钥进入 Git、日志、截图、trace。
- 已知限制写入 README/部署文档：同账号限制、tmux ≥ 3.1、mobile 裁切、显式 close 语义。
- 有升级步骤、回滚步骤和数据兼容证明。

## 12. P1/P2 Backlog（不属于本计划 Done）

- P1：Snippets、Tab Manager、端口转发、会话管理、条件式 WS mux spike。
- P2：AI、可追责审计、危险命令软门禁、移动端权限模型。

每项开始前从 Spec v1.2 的进入条件生成独立规格和实施计划；不得因为列在 backlog 就直接编码。

## 13. Decision Log

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

## 14. Progress Notes

- [2026-09-04] 计划创建。完成代码事实核对、现有 evidence 核对、官方 xterm/tmux/Go websocket 资料核对。
- [2026-09-04] 基线通过：Go 全测；UI 14 files / 39 tests；lint；production build。
- [2026-09-04] 尚未开始产品代码实现；M0 为第一个执行阶段。
- [2026-09-04] 用户追加最高优先级：Codex/Claude 等 CLI 必须能回看多屏历史。已将其设为 M1 阻塞门，并按本机 Codex 0.145.0、Claude 2.1.246、tmux 3.5a 建立真实验收矩阵。
