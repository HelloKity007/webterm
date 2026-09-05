# WebTerm 深化开发规格说明书（Spec v1.2）

> 状态：**Reviewed / Ready for phased implementation**
> 日期：2026-09-04
> 代码基线：`HelloKity007/webterm`，分支 `dev-1.0.0`，HEAD `686d03e`
> 取代：`2026-09-04-WebTerm-Dev-Spec-v1.1.md` 作为后续实施与验收依据
> 实施计划：[2026-09-04-webterm-deep-development.md](../../exec-plans/active/2026-09-04-webterm-deep-development.md)

## 0. 本次审阅结论

v1.1 的产品方向成立：WebTerm 的近期核心仍是“同一账号、多个浏览器、同一套布局、同一批 tmux 会话”。但 v1.1 不能直接实施，原因是它把已完成能力、待强化能力和未完成架构混在一起，并包含数个不可同时满足的承诺。

本版做出以下修正：

1. **共享的是语义布局与远端会话，不是跨尺寸逐像素一致。** 同一 revision 下 pane 树、比例、tab 和会话身份一致；不同 viewport 允许像素尺寸不同。共享 tmux window 使用 `window-size smallest`，保证同时在线的最小 pane 仍能看到底部输入区；大客户端允许出现留白。
2. **会话恢复不等于浏览器 scrollback 原样恢复。** 重连后恢复当前 TTY 画面和远端进程；历史由 tmux history/copy-mode 保留。若要把完整历史重新灌入 xterm，需另立 snapshot/replay 规格。
3. **布局当前已经持久化在 SQLite。** 现有 `user_layouts`、revision 乐观锁、按用户 LayoutHub 广播和权威 GET 已完成；P0 不重做。
4. **当前 WS 已鉴权和校验连接权限，但发生在 HTTP 101 之后。** P0 修复点是握手前拒绝、严格 Origin、URL 中长寿命 JWT，以及并发写安全，不是“完全无鉴权”。
5. **P0 保持全量 snapshot + CAS，不引入未设计完成的增量 diff 合并。** 冲突返回 `409`，客户端拉取权威状态；可重放的单操作 rebase 以后再做。
6. **xterm.js 6 的 fallback 是 WebGL → 默认 DOM。** Canvas renderer 已从 xterm.js 6 移除，不规划不存在的 `CanvasAddon`。
7. **Lazy Mount 只适用于不可见 tab。** 8 个可见 pane 的 active tab 必须同时 mount，否则不满足同屏目标。
8. **P1 的 WS 多路复用先测量再落地。** 现有真实容量证据已覆盖 1,000 pane；24 条浏览器 WS 本身不是已证明的瓶颈。若实施，优先控制面单连接、数据面分片，避免所有终端共享一条 TCP 带来的队头阻塞与故障域放大。
9. **Codex/Claude 等全屏 CLI 的历史回看是独立的 P0 能力。** alternate screen 内的内容不会自然进入 xterm 主 scrollback；必须按 CLI 的原生渲染/历史机制与 tmux mouse forwarding 联合解决，并以真实 CLI 验收。

## 1. 已拍板决策

| ID | 决策 | 实施解释 |
|---|---|---|
| D1 | 多端共享模型为同账号多端 | 本期不做 invite/member/RBAC；布局隔离键保持 `userID` |
| D2 | 多路复用属于 P1 | M2 先做 benchmark/协议 spike，通过门槛后才迁移；不阻塞 P0 |
| D3 | tmux 最低版本 ≥ 3.1 | 这是产品支持基线；首次连接预检并缓存结果，不声称未经测试的未来版本永久兼容 |
| D4 | P0 使用 snapshot + revision CAS | `PUT /api/layout` 仍提交完整共享快照；冲突拉取权威版本 |
| D5 | 显式关闭与暂时离线语义分开 | 用户显式关闭 tab 立即幂等 kill；浏览器关闭、断网、服务重启不 kill tmux；P0 不启用自动 TTL |
| D6 | 一账号只对应一个共享布局 | 本期“workspace”是产品概念，不新增 workspace 表；多工作区另立规格 |

### D1 的已知代价

同账号模式无法提供可靠的人员身份、按人撤权、只读观众和按人审计。presence 中的设备名只能是便于辨认的自报标签，不能当作安全身份。P2 审计若要求追责到个人，必须先改变 D1；不能用同一个 `admin` 账号伪造多人问责能力。

## 2. 产品目标与边界

### 2.1 P0 目标

- **最高优先级：Codex、Claude Code 等交互式 CLI 在会话运行中可回看多屏历史内容，而不是只保留当前一屏。**
- 同一账号在 3 个桌面浏览器和 1 个移动 viewport 打开后，看到相同的 pane 树、比例、tab 标题、连接映射和终端会话。
- 8 个可见 pane 可共同操作；任一设备离线不影响其他设备或远端长任务。
- 网络中断后自动恢复布局控制通道和各终端通道，不要求刷新页面。
- 用户清楚看到终端在线端数、连接/重连状态和广播武装状态。
- 在定义过的负载与硬件基线上满足性能、内存和稳定性门槛。
- 所有 WS 在升级前完成认证、资源授权和 Origin 检查。

### 2.2 本期非目标

- 多账号协作、RBAC、invite/member、可靠的个人审计。
- RDP/VNC、Telnet、串口、云托管。
- CRDT/OT 或任意并发布局操作的自动无损合并。
- 浏览器 xterm scrollback 跨断线逐字节还原。
- 手机与桌面像素一致或桌面级 8 pane 操作体验。
- P2 AI、审计、危险命令阻断的直接实现；这些功能必须分别补安全与隐私规格。

## 3. 当前代码基线（2026-09-04）

| 能力 | 事实状态 | 代码依据 | P0 动作 |
|---|---|---|---|
| 布局持久化 | 已完成 | `store/layout.go`、`user_layouts` | 保持并补迁移/冲突 E2E |
| 多端布局通知 | 已完成 | `handler/layout_hub.go`、`/ws/layout` | 扩展为带类型的控制事件 |
| 布局冲突 | 已完成基础 | revision CAS，旧 revision 返回 `409` | 明确交互，不做 diff merge |
| tmux 持久终端 | 已完成基础 | `handler/persistent_terminal.go` | 版本预检、错误分类、生命周期强化 |
| 显式关闭会话 | 已完成 | `DELETE /api/terminal-sessions/{conn_id}` | 保持立即 kill 和幂等 |
| 连接容量 | 已完成并有证据 | SSH transport 分片；1,000 pane 实测 | 固化 24 路 P0 门禁 |
| 8 pane 模板 | 已有 2×4 基础 | `layoutPresets.ts`、Split 8 | 增加 4×2、入口和原子替换 |
| 拖动比例 | 未完成 | 树有 ratios，UI 无 divider drag | 实现拖动结束提交 |
| tab 重命名 | 已完成基础 | tab title/label 持久化测试 | 保持并做多端 E2E |
| 广播 | 部分完成 | 当前浏览器内 off/pane/all | 明确 active-visible 范围，增加共享组配置 |
| SFTP 跟随 cd | 已完成基础 | OSC 7 → `sftpCdPaths` | 移出新增功能，保留回归 |
| 自动重连 | 部分完成 | 最多 3 次指数退避 | 改为有界退避、无限生命周期、online 感知 |
| 心跳 | 无闭环 | 服务端发 JSON ping，客户端不 pong | 建立 ping/pong 与超时状态机 |
| presence | 未完成 | 无 registry | 新增短生命周期 registry |
| WebGL | 未完成 | xterm 6 默认 renderer，无 addon | 加 WebGL + context-loss 回退 |
| WS 安全 | 部分完成 | handler 内 JWT/资源授权 | 移到升级前，严格 Origin，短期 ticket |
| Codex/Claude CLI 历史 | 未达标 | Claude 当前只能看约一屏；已有 `tmux mouse on` 未提交改动 | 作为第一个 P0 阶段真实验收 |

基线注意：工作树已有与 tmux mouse 相关的用户未提交修改；实施阶段必须保留并在最新状态上增量开发，不得回滚。

## 4. P0 需求

### P0-CLI：Codex、Claude Code 与全屏 TUI 历史回看（最高优先级）

#### CLI-1 支持范围与定义

- 首批必须支持本机当前版本：Codex CLI `0.145.0`、Claude Code `2.1.246`；同时记录 tmux `3.5a`、Chrome/Edge 版本。升级 CLI 后通过兼容矩阵复验，不能笼统宣称“所有未来版本支持”。
- “可回看”定义为：CLI 进程仍在运行时，用户可以用鼠标/触控板或明确的键盘入口回到至少 5 个 viewport 之前的对话/命令输出，并能回到底部继续输入。
- 必须区分两个历史域：
  - **main screen history**：普通 shell 或 inline CLI 输出，由 xterm/tmux scrollback 承载，浏览器间可独立滚动。
  - **TUI retained history**：alternate screen/fullscreen 应用自己维护的对话历史，必须使用应用原生滚动/ transcript；不能假设 xterm 的 scrollbar 会出现。
- UI 应显示当前历史模式和可用入口，不能让用户面对“滚轮无反应”而没有解释。

#### CLI-2 Claude Code 路径

- 以 Claude Code 官方 fullscreen renderer 为首选兼容路径：普通 `claude` 会话可执行 `/tui fullscreen`，或由用户显式启用相应环境配置；WebTerm 不静默修改用户远端全局配置。
- tmux session 开启 mouse 后，xterm 必须把 SGR mouse wheel 正确送到 tmux，再由 tmux 转发给请求 mouse reporting 的 Claude fullscreen TUI。
- 必须支持并在 UI 帮助中列出：mouse wheel、`PgUp/PgDn`、`Ctrl+Home/Ctrl+End`；`Ctrl+O` transcript mode 与 `[` 写入 terminal scrollback 作为搜索/复制兜底。
- 若用户保持 Claude inline renderer，WebTerm 提供普通 xterm/tmux scrollback；若上游重绘已清掉历史，提示切换 fullscreen/transcript，不伪造“历史仍完整”。

#### CLI-3 Codex 路径

- 提供显式的“Codex 可回看模式”启动入口，等价于当前版本的 `codex --no-alt-screen`；入口只在空闲 shell 中由用户触发，不覆盖 shell alias、不修改 `~/.codex/config.toml`。
- 普通 `codex` TUI 保持可运行；其原生 `Ctrl+T` transcript 是 alternate-screen 下的回看兜底，并在 WebTerm 快捷帮助中可发现。
- 必须实际验证 `--no-alt-screen` 在本项目的 xterm.js 6 + tmux 链路中能产生超过 5 屏的可滚历史。若仍受上游 inline renderer 限制，只能把 Ctrl+T transcript 标为已支持，不能把 native scrollback 标为通过。
- Codex/Claude 的启动入口属于终端兼容能力，不扩展成通用 Snippets，也不得自动附加绕过 sandbox/permission 的危险参数。

#### CLI-4 鼠标、选择与多端语义

- 普通 wheel 优先遵循当前前台应用申请的 mouse protocol，不改变短会话和触控板手感。`Shift+wheel` 在 fullscreen TUI 中提供限速 `PageUp/PageDown` 兜底，在 main screen 中保留 terminal/tmux history override。
- 右键菜单、文本选择、复制粘贴和 IME 不能因 mouse forwarding 回归；不得把完整或半截 SGR mouse escape 写进 Claude/Codex composer。
- 同一 session 被不同尺寸客户端同时 attach 时，tmux grid 必须适配最小客户端，底部 composer 不得因大客户端抢占尺寸而被裁掉；大客户端留白是允许的正确性取舍。
- 提供显式“回到底部并恢复输入”动作：若处于 tmux copy-mode 则取消 copy-mode，否则向前台 CLI 发送原生 `Ctrl+End`；服务端必须重新派生 tmux target。
- inline/main-screen 的 xterm 滚动是浏览器本地视图，不影响其他端。fullscreen TUI 的原生历史导航可能改变共享 tmux 画面，UI 文档必须说明这是同一共享会话的行为。
- 断线重连后必须仍能通过 CLI 自身 transcript/session 恢复已保存对话；不承诺浏览器本地 xterm scroll offset 原样恢复。

#### CLI 验收

- 普通 shell 输出 5,000 条带序号行，可滚到首个 marker、复制，并一键回到底部。
- Claude Code 2.1.246 生成至少 5 屏无敏感内容的测试对话：wheel 和 PgUp 均能看到早期 marker，Ctrl+End 回到底部后可继续输入；Ctrl+O transcript 可打开和退出。
- Codex CLI 0.145.0 生成同等测试对话：可回看模式能通过 xterm scrollback 找到早期 marker；默认 TUI 的 Ctrl+T transcript 能找到早期 marker。
- Claude/Codex 各执行 100 次 wheel/trackpad 事件，composer 中无 `\x1b[<...` 等 mouse protocol 文本。
- 同一 tmux session 两端 attach 时，滚动/退出历史模式不 detach、不 kill、不创建新 terminalID；另一端可继续看到会话。
- 1 pane 与 8 pane 各跑一次真实浏览器验收；CI 使用可控 synthetic TUI fixture，发布门禁再跑真实 Codex/Claude，凭据仅从环境读取。

### P0-SEC：WebSocket 握手与写通路

#### SEC-1 握手前授权

- 新增受 JWT 保护的短期 WS ticket 获取接口。ticket 默认 30 秒失效、单次使用，并绑定 `userID + endpoint + connID + terminalID/clientID`。
- 浏览器连接 `/ws/ssh`、`/ws/sftp`、`/ws/db`、`/ws/layout` 前先获取 ticket；重连获取新 ticket。
- 服务端在 upgrade 前验证 ticket、用户状态、连接访问权和参数；失败返回 HTTP `401/403/404`，不得先 `101` 再发错误帧。
- 迁移期可保留 query JWT 兼容开关，生产默认关闭，并保证 access log 不记录 token/ticket query。

#### SEC-2 Origin 与输入边界

- 浏览器 WS 仅允许配置的 HTTPS origin，默认要求 `Origin.host == Host`；无 Origin 的非浏览器客户端默认拒绝，可由仅测试配置开启。
- 设置 payload 上限；resize 必须满足有效 cols/rows 上限；未知 action 返回 typed error。
- `terminal_id`、`client_id` 只作为经校验的逻辑 ID，绝不直接进入 shell。

#### SEC-3 单写者

- 每条 WS 只有一个 writer pump。stdout、stderr、heartbeat、presence/error 都进入同一出站队列。
- 终端字节不得通过“丢最旧消息”缓解背压，因为这会截断 VT escape sequence。慢消费者超过队列预算时断开并给出可观测原因，客户端重连到 tmux。

#### SEC 验收

- 无/过期/错 scope ticket 在升级前得到正确 HTTP 状态。
- 跨 Origin 被拒；合法 Caddy origin 成功。
- race 测试下并发 stdout/stderr/heartbeat 无并发写错误。
- 日志、测试工件和 URL 截图中无 JWT、凭据或可重放 ticket。

### P0-REL：终端可靠性与生命周期

#### REL-1 tmux 预检

- 首次连接目标时执行 `tmux -V`，解析稳定版版本号；低于 3.1、缺失或无法解析时返回稳定错误码和中文修复提示。
- 预检结果以连接身份短期缓存；连接配置变更后失效。
- WebTerm 对现有远端 tmux server 的全局 option 影响必须审计。若保留 `set-option -g history-limit`，必须记录其副作用；首选稳定的 WebTerm 专用 socket/namespace，但迁移不得让现有 session 静默丢失。

#### REL-2 两层保活

- 应用层：客户端每 20 秒 ping，服务端回 pong；45 秒没有有效入站/出站确认则关闭该 WS。
- SSH 层：每个活跃 transport 周期发送 OpenSSH keepalive；连续失败后使该 transport 上的 WS 明确断开并允许重建。
- ping/pong 不写进 xterm，不和终端数据混为一谈。

#### REL-3 重连状态机

- 退避采用 full jitter，基数 1 秒、上限 30 秒；只要组件仍 mounted 且用户仍登录就继续，不在 3 次后永久放弃。
- 浏览器 offline 时暂停拨号，online 后立即尝试；401/403 不重试并转入需重新登录/授权状态。
- 重连成功后重新发送实际 cols/rows、重新 attach 同一 `terminalID`，布局控制通道拉取权威 revision。
- xterm 实例在短时重连期间保留；最终卸载才 dispose。

#### REL-4 生命周期

- 关闭/断网只 detach；明确点击关闭 tab 才调用 DELETE 并 kill。
- P0 不自动按“无人在线 24h”清理，以免误杀长任务。孤儿枚举、手动清理和可选 TTL 放入 P1 独立设计。

#### REL 验收

- 断网 30 秒和 5 分钟后恢复，页面无需刷新，终端回到同一 tmux session。
- 服务端重启后重新登录/有效 token 下自动恢复；远端任务不中断。
- 空闲 30 分钟连接保持，或在中间设备主动断链时自动重建。
- 显式关闭 tab 在所有 attach 端结束该 session；重复 DELETE 仍成功。

### P0-LAYOUT：8 pane 与多端一致性

#### LAYOUT-1 一致性定义

同一 revision 必须一致的字段：

- pane tree、direction、ratios；
- pane ID 与每个 pane 的 tabs；
- tab ID、type、title、labelNumber、connId；
- P0 新增的 broadcast group 配置。

浏览器本地字段不得共享：focused pane、active tab、临时 zoom、滚动位置、selection、输入法状态、移动端只读偏好。

#### LAYOUT-2 schema 与 API

- 沿用当前 `{tree, panes, focusedPaneId}` 模型，不替换成 v1.1 中把连接直接塞进 pane node 的第二套模型。
- `PUT /api/layout` 沿用 `{schema_version, revision, layout}`；服务端保存共享字段并返回新 revision。
- 需要新增字段时升级到 schema v2，并提供 v1 → v2 的纯函数迁移、向后读取测试和失败回退；不得静默丢 tab。
- P0 不创建 workspace/member 占位表。真正引入多工作区时再按使用场景设计 schema。

#### LAYOUT-3 模板、拖动与冲突

- 提供 1×1、2×4、4×2；自定义继续使用 split 操作。`3×3+1` 实际是 10 pane，不属于“8 pane 模板”，移出 P0。
- 套模板是一次原子布局变更；若目标 pane 已有 tab，必须保留在确定的第一个新 pane，其他 pane 初始为空。
- divider 拖动期间只更新 CSS；每 animation frame 至多更新一次视觉比例；pointer-up 后 normalize ratios 并触发一次 500ms 防抖保存。
- 收到 `409`：停止本地自动保存 → GET 权威布局 → 提示已采用另一端修改。P0 不声称自动合并两个并发布局操作。

#### LAYOUT 验收

- 两个独立桌面浏览器与一个移动 viewport 对同一 revision 的共享字段深比较相等。
- A 端拖动结束后 B 端 p95 1 秒内取得新 revision；拖动期间不产生 resize/API 风暴。
- A/B 同时修改时只产生一个权威 revision 序列；失败端明确提示且最终收敛。
- 服务端重启后布局 revision 和共享字段保持。

### P0-COLLAB：presence 与广播

#### COLLAB-1 presence

- `clientID` 是 sessionStorage 级随机 ID；刷新保留、关闭浏览器 tab 后失效。可选 device label 存 localStorage，仅显示且需转义。
- registry 键为 `userID + terminalID`，因为当前一个 pane 可有多个 tab，而 tmux 身份实际属于 tab/terminal。
- 在线数按 distinct `clientID` 计，不按瞬时 socket 数计；重连 grace 期默认 15 秒，避免数字闪烁。
- `/ws/layout` 控制通道扩展 typed event：`layout_revision`、`presence_snapshot`、`presence_delta`、`server_shutdown`。慢客户端的 layout revision 仍只保留最新值。

#### COLLAB-2 广播范围

- P0 广播目标严格定义为“当前共享布局中，每个可见 pane 的 active SSH tab”；不承诺向未 mount 的隐藏 tab 发送。
- group 成员使用 `terminalID`；source/leader 是 source terminal，不是人员权限角色。
- group 配置随布局共享；focused/source device 等临时状态本地保存。
- 输入由发起设备恰好发送一次到每个目标 session。其他观察设备通过各自 attach 的 tmux 看到结果，不二次转发。
- 广播开启时所有客户端显示醒目、可访问的 armed 状态；粘贴多行命令前二次确认可配置。

#### COLLAB 验收

- 两设备连接同一 terminal 显示 2 端；关闭一端后在 grace 期结束显示 1。
- 快速重连不出现 0→2→1 抖动，也不会残留 ghost client。
- 8 pane 广播命令每个目标只执行一次；关闭广播后相互独立。
- 同账号的另一设备可以输入，因此 UI 不得把“观看”宣传成安全只读。

### P0-PERF：渲染与容量

#### PERF-1 renderer

- 使用与 `@xterm/xterm@6` 匹配的 `@xterm/addon-webgl`。
- `WebglAddon` load 失败或 `onContextLoss` 时 dispose addon 并回到 xterm 默认 DOM renderer；不得白屏或重建远端 session。
- 一个可见 pane mount 一个 active terminal；同 pane 的 inactive tab 可卸载 WebGL，但保留远端 tmux session。
- 避免频繁创建/销毁 WebGL context；记录 context loss 次数和 active renderer 供测试观察。

#### PERF-2 resize 与输出

- ResizeObserver 只调度一次 rAF；只有 cols/rows 变化才发送 resize。
- divider 拖动期间不连续 fit，pointer-up 后统一 fit；服务端对重复尺寸幂等。
- 先测量 xterm 自身 write batching，再决定是否增加应用层 batching；不得未经数据再套一层 rAF 导致额外延迟。

#### PERF-3 可复现门槛

基线环境必须在 evidence 中记录 CPU、内存、OS、Chrome 版本、viewport 和是否硬件加速。负载使用受控 fixture，不运行无界 `yes`。

| 指标 | P0 门槛 |
|---|---|
| 8 pane 输出 | 每 pane 64 KiB/s、持续 60 秒；桌面 Chrome p95 frame interval ≤ 22.2ms（约 45fps），无白屏/页面错误 |
| 输入回显 | LAN、100 个带序号 echo，p95 ≤ 100ms |
| 浏览器内存 | 8 pane 稳态 30 分钟无持续线性增长；末 10 分钟相对前 10 分钟增长 ≤ 10%，同时记录绝对值不伪装跨机器阈值 |
| 服务端容量 | 3 客户端 × 8 pane = 24 活跃 shell；无数据串线、无 race、无超 transport channel 上限 |
| 布局同步 | 拖动完成到其他客户端应用新 revision，p95 ≤ 1s |

首次基线若证明硬件无法达到门槛，必须保存原始数据并走决策记录调整，不能只降低数字后宣称通过。

## 5. P1 范围与进入条件

P1 只有在 P0 全部验收、稳定运行一轮后开始。每项应独立 spec/PR，避免捆成一次高风险发布。

| ID | 能力 | v1.2 修订后的进入条件 |
|---|---|---|
| P1-1 | Snippets | 默认只插入不自动执行；变量逐个确认；敏感值不进日志 |
| P1-2 | Tab Manager | 先定义 tab/pane/浏览器窗口移动语义；保持 terminalID 不变 |
| P1-3 | 端口转发 | 默认仅绑定 loopback；定义端口冲突、所有者、重启恢复、LAN 暴露确认和关闭语义 |
| P1-4 | WS 多路复用 | benchmark 证明现状瓶颈；协议支持 per-channel flow control、单写者、故障隔离和渐进回退 |
| P1-5 | 会话管理 | 列出 tmux session、最后活动时间、手动清理；TTL 默认关闭 |

SFTP 跟随 cd 已有 OSC 7 基础，不再算 P1 新功能；P0/P1 只补多端、错误和路径权限回归。

### 多路复用建议

优先考虑“一个控制 WS + 多个/分片终端数据 WS”，而不是所有终端输出塞入一条 TCP。只有以下全部满足才迁移：

- 24 pane 基准中连接/CPU/内存有可重复的显著收益；
- 一个高吞吐 pane 不会阻塞其他 pane 的输入和 resize；
- 单 channel 关闭不会终止整个 workspace；
- 新旧协议可灰度并可回退。

## 6. P2 必须另立规格

- **AI 侧栏**：先定义数据出站、脱敏、模型供应方、提示注入边界和用户确认；默认不发送终端内容。
- **审计回放**：同账号前提下只能审计账号/设备标签，不能审计真实人员；需定义事件格式、加密、保留期、容量和删除。
- **危险命令阻断**：正则无法可靠理解 shell alias、换行、变量展开和编码，不能作为安全控制宣传；若继续，定位为可绕过的提示/软门禁。
- **移动端**：默认只读只是客户端偏好，不是权限；需要真正只读必须先有服务端授权模型。

## 7. API 与事件契约（P0 目标）

### REST

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/layout` | 当前用户权威布局与 revision |
| PUT | `/api/layout` | 完整共享 snapshot + 当前 revision，CAS 保存 |
| POST | `/api/ws-tickets` | 获取短期、route-bound、单次 WS ticket |
| DELETE | `/api/terminal-sessions/{conn_id}?terminal_id=...` | 用户显式关闭持久 session，幂等 |

### 控制 WS 事件

```json
{"type":"layout_revision","revision":13}
{"type":"presence_snapshot","terminals":{"ssh-1":2,"ssh-2":1}}
{"type":"presence_delta","terminalId":"ssh-1","online":1}
{"type":"pong","seq":42}
{"type":"server_shutdown","retryAfterMs":1000}
{"type":"error","code":"FORBIDDEN","message":"..."}
```

终端 P0 继续沿用现有每 pane WS 数据格式；不提前伪装成 P1 的 `sid` mux 协议。协议变更必须保留 typed error code，UI 不依赖中文字符串判断错误类型。

## 8. 数据模型

P0 继续使用现有 `user_layouts(user_id, schema_version, revision, layout_json, updated_at)`。新增持久表不是 F1 的前置任务。

presence、WS ticket 和活跃连接属于短生命周期状态，存内存并有过期清理；不写 SQLite。若服务多实例化，需先另立共享协调层规格，本期单进程部署不做。

JWT signing secret 必须来自稳定的生产配置/环境变量，使服务重启后已有登录可按策略继续有效；不得每次启动随机生成后又承诺无感重连。开发模式可以临时 secret，但必须有明显 warning，LAN 生产预检必须拒绝弱/缺失 secret。

## 9. 统一验收场景

| 场景 ID | 场景 | 必须证据 |
|---|---|---|
| E2E-1 | 3 桌面 + 1 mobile viewport 同账号打开 8 pane | 共享 snapshot 深比较、每端截图、24 shell 状态 |
| E2E-2 | A 拖 ratio，B/C 收敛 | revision 时序、API 次数、p95 延迟 |
| E2E-3 | A/B 并发改布局 | 一个成功、一个 409、最终 snapshot 一致、用户可见提示 |
| E2E-4 | 断网 30 秒/5 分钟后恢复 | 同 terminalID/tmux session、无需 reload |
| E2E-5 | 服务重启 | 远端任务继续、JWT/重新鉴权语义符合配置、布局不丢 |
| E2E-6 | presence join/leave/reconnect | distinct client 计数，无 ghost |
| E2E-7 | 广播到 8 active-visible terminals | 每个目标恰好执行一次，armed UI 截图 |
| E2E-8 | WebGL 禁用/context loss | DOM fallback、终端继续、无白屏 |
| E2E-9 | 非法 WS | upgrade 前 401/403、Origin 拒绝、日志无 token |
| PERF-1 | 受控 8 pane 输出 | trace、帧间隔、memory timeline、环境清单 |
| E2E-CLI-1 | Claude fullscreen 历史 | 早期/末尾 marker、wheel/PgUp/Ctrl+End、无 raw mouse sequence、截图 |
| E2E-CLI-2 | Codex inline + transcript | `--no-alt-screen` scrollback 与默认 TUI Ctrl+T 两条证据 |

所有 E2E 必须跑实际生产 build 和 Go 服务；纯 DOM locator 不能替代终端可见内容检查。涉及真实凭据的测试只能从环境注入，工件需脱敏。

## 10. 发布门禁

- `go test -race ./... -count=1`
- `go vet ./...`
- `npm --prefix ui test`
- `npm --prefix ui run lint`
- `make build`
- P0 多端 E2E、断网/重启 E2E、24 shell 容量、8 pane 性能均通过
- `git diff --check` 通过，且最后一次验证发生在最后一次代码修改之后
- 新旧数据库迁移在副本上验证；失败可回滚二进制且不破坏 layout/tmux session
- 发布说明明确 D1 的共享账号限制、tmux ≥ 3.1、小屏裁切语义和显式关闭会 kill session

## 11. 风险登记

| ID | 风险 | 处理 |
|---|---|---|
| R1 | 同账号无法问责 | 产品文案明确；需要问责时先做身份模型 |
| R2 | 小屏在 tmux largest 下裁切 | 手机定位为查看/基本操作；不承诺像素一致 |
| R3 | 远端全局 tmux option 污染 | M1 审计 namespace 与兼容迁移，未解决前记录限制 |
| R4 | xterm 6/WebGL context loss | context-loss fallback、少 churn、真实浏览器 soak |
| R5 | snapshot CAS 冲突覆盖体验 | 明确 409/权威拉取；自动 merge 延后 |
| R6 | WS 单通道慢消费者 | 单写者、容量上限、断开重连，不截断字节 |
| R7 | P1 mux 扩大故障域/HOL | benchmark gate，控制面/数据面分离或分片 |
| R8 | 工作树已有未提交代码 | 开工前保存状态，禁止覆盖无关改动 |

## 12. 参考依据

- [xterm.js 官方仓库与 addons](https://github.com/xtermjs/xterm.js/)：WebGL 是可选 GPU renderer。
- [xterm.js 6.0.0 release](https://github.com/xtermjs/xterm.js/releases/tag/6.0.0)：Canvas renderer 已移除，建议 DOM 或 WebGL。
- [WebglAddon API](https://github.com/xtermjs/xterm.js/blob/master/addons/addon-webgl/typings/addon-webgl.d.ts)：提供 `onContextLoss`。
- [tmux Advanced Use — window sizes](https://github.com/tmux/tmux/wiki/Advanced-Use#window-sizes)：`largest` 下小客户端只显示窗口的一部分。
- [tmux Getting Started — options](https://github.com/tmux/tmux/wiki/Getting-Started#list-of-useful-options)：`history-limit` 与 mouse 属于 session 级配置语义。
- [Go x/net/websocket package](https://pkg.go.dev/golang.org/x/net/websocket)：`Server.Handshake` 可做 Origin/握手检查；默认 Handler 只解析 Origin，不等价于同源授权。
- [Claude Code 官方 Fullscreen rendering](https://code.claude.com/docs/en/fullscreen)：alternate screen 只渲染可见消息，mouse/PgUp/Ctrl+Home 等由 Claude 内部处理，Ctrl+O transcript 可搜索/写入 scrollback。
- [Claude Code 官方 Terminal configuration](https://code.claude.com/docs/en/terminal-config)：fullscreen 与普通 terminal scrollback 是两种不同渲染路径。
- [Codex CLI 配置源码](https://github.com/openai/codex/blob/main/codex-rs/core/src/config/mod.rs)：`tui.alternate_screen = "never"` 对应 inline 模式；本机 `codex --help` 同时提供 `--no-alt-screen`。

## 13. 变更记录

- v1.2：按仓库代码、现有 evidence 和上游官方资料完成审阅；修正 baseline、API、布局 schema、WS 鉴权事实、tmux/scrollback/小屏语义、xterm 6 fallback、冲突模型和性能验收；将 Codex/Claude CLI 历史回看提升为最高优先级 P0；形成可执行分阶段计划。
- v1.1：原始深化开发草案，保留作决策背景。
