# WebTerm 会话层升级方案摘要：tmux Control Mode（-CC）

- 版本：v0.1（摘要级，供开发 agent 接手细化）
- 日期：2026-09-07
- 状态：方案已定案（用户拍板"就按 tmux -CC control 来做"），本摘要只给方向和关键决策，开发细节由后续 agent 细化
- 仓库：https://github.com/HelloKity007/webterm（当前开发分支以 `git branch --show-current` 为准，文档创建时为 `dev-1.0.2`）
- 关联文档：WebTerm-Dev-Spec-v1.1.md（整体产品 Spec，本方案是其中 F3 强化方向的具体落地）

---

## 1. 背景与目标

### 1.1 现状
WebTerm 会话层采用 **tmux attach 模式**：每个 pane 通过命令拼接创建/附加 tmux 会话（`tmux new-session -Ad -s wt-...` + `attach-session`，`window-size largest` 防缩屏），WebTerm 服务端作为"遥控器"把 tmux 的终端渲染结果转发给浏览器。

### 1.2 已识别问题
| 问题 | 影响 |
|---|---|
| 命令拼接 + attach，无结构化事件流 | 布局变更、pane 输出无法精准路由，只能整屏转发 |
| 新加入的端看不到历史输出 | 三端共享场景下，后打开的浏览器是"空白"的 |
| 依赖终端渲染/尺寸协调 | WezTerm 式 TTY 重绘错乱风险，resize 靠 `window-size largest` 兜底 |
| 会话状态只能靠 shell 命令查询 | 不便于精确控制（单 pane 捕获、事件感知） |

### 1.3 双环境隔离约束（P0，先于 Control Mode）

生产 `:9443` 与发布测试 `:9444` 不得共享同一远端 tmux server/socket。当前两环境虽然进程和数据库隔离，却使用相同的 session 名；测试 attach 时执行的 `window-size largest`、resize hook、mouse/copy-mode、history-limit 和 CLI 操作会修改生产正在使用的同一 session，从而造成生产字体、PTY 网格和滚动行为异常。

因此必须先为 release-test 注入独立 tmux socket（或等价 namespace），并为该 namespace 增加自动清理与审计；生产已有 session 保持原名和 PID，不迁移、不 kill。Control Mode 的 session registry 必须把 `environment/namespace` 纳入 key，禁止跨环境复用。

### 1.3 目标
- 底层**仍用 tmux**（金标准：会话持久化、多端 attach、断线/重启不丢）
- 把"怎么用 tmux"从 **attach 模式升级为 Control Mode（`tmux -CC`）**
- 获得：结构化事件流（`%output`/`%layout-change`）、服务端输出缓存补放、协议化 resize
- **必须兼容 claude CLI 等 TUI 应用**（见 §6）

---

## 2. 方案概述

### 2.1 什么是 tmux Control Mode
`tmux -CC` 启动控制模式：客户端不再渲染终端 UI，而是通过 stdin/stdout 与 tmux server 走**结构化文本协议**。tmux server 仍然管理真实 PTY（pane 里跑真实程序），客户端收到的是：

- `%output <pane-id> <data>`：pane 实时输出字节流（按 pane 路由）
- `%begin` / `%end`：批量输出帧（一批输出的起止标记）
- `%layout-change`：布局变更事件
- `%window-add` / `%window-close` 等：窗口生命周期事件
- 客户端命令通过 stdin 下发（如 `resize-window`、`send-keys`）

成熟参照：**iTerm2 集成 tmux**、libtmux（Rust）、psmux 均基于此协议。

### 2.2 架构变化（升级前后）

```
升级前（attach 模式）                        升级后（control mode）
浏览器 ←WS→ WebTerm服务端                   浏览器 ←WS→ WebTerm服务端
                  │  命令拼接 + attach                   │  控制通道(tmux -CC)
                  ▼                                    ▼
               tmux server（渲染后转发）              tmux server（结构化事件流）
                  │                                    │  %output pane-1: 数据
                  ▼                                    │  %output pane-2: 数据
               终端字节流                              │  %layout-change: ...
                                                        ▼
                                                 服务端按 pane 路由 + 缓存 + 广播
```

### 2.3 核心变化点（一句话各）
1. **会话建立**：`tmux new-session` 保持 detach 创建，WebTerm 服务端用 `tmux -CC attach-session -t <name>` 建立**控制通道**（每会话一条控制连接）
2. **输出路由**：解析 `%output <pane-id>`，按 pane 分发到对应 WebSocket 客户端
3. **历史补放**：服务端先用 `capture-pane -e -p -S -` 获取带 ANSI 的一致性快照，再以序列号衔接实时 `%output`；仅回放原始环形缓冲不足以保证从 ANSI/alternate-screen 边界恢复。
4. **布局**：订阅 `%layout-change` 事件，与现有 LayoutHub revision 广播对接
5. **输入**：客户端输入经服务端 → 控制通道 → `send-keys -t <pane-id>` 进对应 pane；多端输入走现有输入仲裁（F4/ADR-5）
6. **resize**：`resize-window -t <win> -x <cols> -y <rows>` 协议化下发，替代依赖 attach 的 `window-size largest`

---

## 3. 关键设计点（概要，细化由开发 agent 完成）

### 3.1 控制通道管理
- 每 tmux 会话一条 `tmux -CC` 连接（长驻，Go 协程读写）
- 读循环：解析 `%` 前缀事件行 → 分发到 pane 路由表
- 写循环：命令下发（加锁，避免交错）
- 断线重连：控制通道断开不影响 pane 内程序（tmux server 仍持会话），自动重 attach

### 3.2 输出缓存与补放
- 每 pane 一个环形缓冲（字节流，建议 512KB~1MB，可配）
- 新 WS 客户端接入流程：补放缓冲 → 之后实时事件流
- 注意：补放的是**原始字节流**，xterm.js 重放即可自同步画面（ANSI 自描述），无需服务端渲染
- 内存上限、淘汰策略需细化（与 Spec §9.2 内存治理对齐）

### 3.3 输入通路
- 浏览器 → WS → 服务端 → control channel `send-keys -t <pane-id>`
- 多端同时输入：按现有输入仲裁规则（谁输入谁主导，可配置只读/广播模式）
- 大粘贴/二进制安全：send-keys 处理转义需细化

### 3.4 resize 与布局
- 布局树（Spec §6.3）仍是权威；`%layout-change` 事件与布局树 diff 对齐
- resize 协议化：服务端按布局树尺寸下发 `resize-window`，消除 attach 模式下的 SIGWINCH 协调问题

### 3.5 会话生命周期
- 创建：detach 创建 → 建立控制通道
- 关闭 pane/会话：`kill-pane`/`kill-session` 命令化
- 孤儿清理：沿用现有机制，控制通道断开后的清理策略需细化

---

## 4. 与现有代码的对接点

| 现有模块 | 改造 |
|---|---|
| `handler/persistent_terminal.go` | tmux 命令构造 → 控制通道建立 + 事件解析 |
| `handler/layout_hub.go` | 布局广播对接 `%layout-change` 事件 |
| `handler/terminal.go`（pane 转发） | 输出按 pane 路由 + 环形缓冲补放 |
| `main.go` | WS 路由不变（仍每 pane 一条 `/ws/ssh/{conn_id}`，D2 决策） |
| 前端 xterm.js | 基本不变（仍收字节流），补放协议需前端配合 |

---

## 5. 分阶段实施路径（概要）

| 阶段 | 内容 | 验收要点 |
|---|---|---|
| P0-1 | 控制通道建立 + `%output` 事件流按 pane 路由 | 单 pane 实时输出正确，8 pane 并行无串流 |
| P0-2 | 环形缓冲 + 新端补放 | 后开浏览器能看到历史，画面与旧端一致 |
| P0-3 | 输入通路（send-keys）+ resize 协议化 | 键盘/粘贴正常；resize 后各端画面正确 |
| P1 | `%layout-change` 对接布局广播；多端仲裁完善 | 布局变更全端同步；多端输入不串扰 |
| P1+ | 性能压测（复用现有 run-multicclient-capacity.mjs）、异常恢复验证 | 8 pane × 3 端稳定 |

实施顺序补充：P0-0 先完成双环境 tmux namespace 隔离并通过“测试操作不改变生产 session”回归；未通过 P0-0，不得在 `:9444` 使用真实生产会话验证后续阶段。

---

## 6. claude CLI 兼容性（已确认，结论先行）

**结论：兼容，无阻塞。**

依据：
1. claude CLI 跑在 tmux pane 的 PTY 上，对客户端类型（attach/control）完全透明；control mode 只改变客户端↔tmux 通信方式，不改 pane 内运行环境
2. control mode 下客户端拿到的是 pane 原始字节流（`%output`），WebTerm 前端 xterm.js 是完整 ANSI 终端模拟器，可正确渲染 claude CLI 的全屏交互界面（alt-screen、光标、颜色、鼠标、快捷键）
3. Claude Code 官方推荐在 tmux 中运行以获持久会话，control mode 是同一性质的程序化 attach

注意点（需在细化中处理，均非阻塞）：
- **多端同时输入会干扰 claude 的线性对话**：必须依赖输入仲裁（谁输入谁主导，其余只读）
- claude CLI 输出量大、动态重绘频繁：补放缓冲大小与重放性能需压测（建议作为 P1 性能项）
- 鼠标/粘贴：claude CLI 支持鼠标交互，WebTerm 需保证 xterm.js 鼠标事件正确转发
- 复制粘贴大文本走 send-keys 的转义处理需细化

---

## 7. 风险与开放问题

| # | 风险/问题 | 说明 |
|---|---|---|
| R1 | 控制通道协议解析的边界情况 | `%` 前缀转义、输出内嵌 `%` 行的处理，需参考 iTerm2/libtmux 实现 |
| R2 | 多 pane 高频输出时广播风暴 | 需要背压/节流策略（与 Spec §9.3 网络优化对齐） |
| R3 | 补放 + 实时流的衔接竞态 | 补放期间新输出到达的时序处理需细化 |
| R4 | 老版本 tmux 事件差异 | 已定 D3：最低 tmux ≥ 3.1，启动预检 |
| O1 | 是否保留 attach 模式作为降级路径 | 建议保留开关（control 失败回退 attach），待细化决策 |
| O2 | 每会话一条控制通道 vs 全局一条 | 当前建议每会话一条（隔离性好），多会话开销可接受 |

---

## 8. 交接给开发 agent 的输入清单

开发 agent 接手时，需基于以下输入细化：

1. 本摘要（方案方向与决策）
2. **WebTerm-Dev-Spec-v1.1.md**（整体 Spec：§5.2 后端模块、§6.2 WS 协议、§6.3 布局树、§9 性能、§10 安全、§12 里程碑）
3. 现有代码（本地克隆，分支 dev-1.0.0）：
   - `handler/persistent_terminal.go`（tmux 命令构造现状）
   - `handler/layout_hub.go`（布局广播现状）
   - `handler/terminal.go` 及 pane 转发逻辑
   - `main.go`（WS 路由注册，注意 §10.3 的 WS 鉴权缺口）
4. 已定决策（勿推翻）：
   - D1 同账号三端共享（userID 维度）
   - D2 WS 仍每 pane 一条 `/ws/ssh/{conn_id}`（多路复用归 P1/M2）
   - D3 tmux ≥ 3.1，启动预检
   - 本次新增：**会话层升级为 tmux Control Mode（-CC），底层仍为 tmux**
5. 细化产出建议：
   - 控制通道协议解析模块设计与接口签名
   - 环形缓冲数据结构和补放时序
   - `%layout-change` ↔ LayoutHub 的对接设计
   - 输入仲裁在 control mode 下的具体规则
   - P0 阶段的实现拆解与测试用例

---

## 9. 参考资料

- tmux Control Mode 协议（%output/%begin/%end/%layout-change）：https://tmuxai.dev/tmux-control-mode/
- iTerm2 tmux Control Mode 集成技术报告（协议细节）：https://gist.github.com/cyclic-elevator/1c51cb994138df7e18e9a68699798ff2
- psmux Control Mode 文档（-C/-CC 差异）：https://github.com/psmux/psmux/blob/HEAD/docs/control-mode.md
- libtmux（Rust，control mode 参考实现）：https://docs.rs/libtmux/
- tmux vs Zellij 选型依据（内存/无头控制对比）：https://www.commandinline.com/tmux-vs-zellij-comparison/ 、https://jpk.io/dev-tools/zellij-terminal-multiplexer-review/
- 同类 Web 终端以 tmux 为底层的参照：https://github.com/AJV009/tui-browser 、https://github.com/AaronFei/terminal-web
