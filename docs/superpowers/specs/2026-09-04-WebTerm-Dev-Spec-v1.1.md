# WebTerm 深化开发规格说明书（Spec v1.1）

> **审阅状态（2026-09-04）**：本稿保留为原始讨论记录；代码核对与技术调研后的实施基线见 [Spec v1.2](./2026-09-04-WebTerm-Dev-Spec-v1.2.md)。后续开发与验收不得继续引用本稿中已被 v1.2 修正的接口、渲染器或一致性口径。

> 定位：基于自研仓库 `HelloKity007/webterm`（分支 `dev-1.0.0`，母本 `xufanchn/webterm`）的下一阶段开发规格。本文档用于指导后续功能、性能、架构三方面的深化开发，可作为 PRD + 技术设计 + 验收标准的统一输入。
>
> 状态：Draft v1.1 · 日期：2026-09-04 · 关联仓库：https://github.com/HelloKity007/webterm
>
> ## Decision Log（v1.1，已拍板）
> - **D1 · 多端共享模型 = 同账号三端**：不做多账号 RBAC。多端 = 同一账号在多个浏览器/设备登录，共享该账号的布局、广播与 tmux 会话。invite/member/角色体系推迟到未来多账号场景再引入（数据表仅预留，不实现逻辑）。
> - **D2 · WS 多路复用**：放到 **P1（M2）** 实施，P0 保持每 pane 一条 `/ws/ssh/{conn_id}` 连接。
> - **D3 · tmux 版本**：**支持最新版本**，最低要求 **≥ 3.1**（`window-size largest` 可用），启动预检显式声明。

---

## 1. 背景、定位与目标

### 1.1 背景（为什么自研）

用户在真实部署中验证过三条现成路线，均无法满足核心诉求：

| 方案 | 结论 | 失败点 |
|---|---|---|
| WezTerm 桌面端 | 放弃 | 多客户端共享同一 TTY 时，分栏 resize（SIGWINCH）未正确同步，右下 pane 重绘错乱 |
| Apache Guacamole | 不满足 | 会话共享为**主从式**（主人断开→共享链接全失效）；分栏为自动等大平铺，**无手动布局、无布局同步** |
| sshwifty 等 Web 终端 | 排除 | 仅多标签切换，无同屏分屏、无多端同步 |

核心诉求（多次重申）：
> **一个标签分栏 8 个窗格，环境装 Linux 主机，3 台 Windows 终端连接同一环境，看到相同布局、内容同步、可共同操作；手机可查看（不强求）。**

结论：**"8 窗格工作区 + 布局/内容全同步"只能自研**。当前自研版已实现：tmux 持久化终端（多端 attach 同一远端会话）、LayoutHub 布局同步（revision 广播 + 权威拉取）、SFTP/DB/广播/OneKey/连接管理、Caddy 局域网 HTTPS。

### 1.2 产品定位

**WebTerm = 面向小型运维/开发团队的"多端协同 Web 终端工作台"**：

- 浏览器即终端（零客户端，Windows/macOS/手机均可用）
- 一个工作区 = 一个 8 窗格（可扩展）的可共享布局
- 会话跨浏览器/断线持久，多端实时同屏、可协同操作
- 部署简单：单 Go 二进制 + Caddy 反代，局域网内自托管

### 1.3 差异化价值主张（护城河）

| 能力 | 现状市场（Guacamole/WezTerm/竞品） | WebTerm 目标 |
|---|---|---|
| 布局同步 | 无（平铺不可手动布局） | 工作区级布局树，多端**逐像素一致** |
| 会话共享 | 主从式（主人断→全断） | 广播式（tmux attach，无主从，任何一端断开不影响他人） |
| 多端协同 | 无 | 同屏 + 同步输入 + 在线端可见（同账号多端） |

### 1.4 目标与非目标

**目标**
- 8 窗格布局模板（2×4 / 4×2 / 自定义），可拖动调整、可重命名、可持久化
- 同账号多浏览器（3 台 Windows + 手机）进入同一工作区，布局与内容实时一致
- 会话持久化：浏览器关闭/断网重连后会话仍在（tmux 会话层）
- 性能：8 窗格同开流畅（≥45fps），长时运行内存稳定

**非目标（本期不做）**
- 不做 RDP/VNC 图形协议（保留 SSH/Telnet 扩展空间）
- 不做完整堡垒机审计体系（审计为 P2 可选）
- 不做云服务（自托管）
- 移动端仅保证"可查看/基本操作"，不承诺桌面级体验
- **不做多账号 RBAC / 邀请 / 成员权限**（D1：同账号模式，多账号体系留待后续）

---

## 2. 用户与核心场景

### 2.1 目标用户
- 小型运维/研发团队（3~10 人），管理 1~N 台 Linux 主机
- **多端模式 = 同一账号在多台设备登录**（D1）：3 台 Windows + 1 台手机用同一账号，共享同一布局与会话
- 典型硬件：1 台 Linux 服务端（x99 等）+ 多台 Windows 客户端 + 手机（可选）

### 2.2 核心场景（Story）

**S1 · 同账号三端协同排障**
1. 管理员在 Windows A 用账号 `admin` 登录 WebTerm，进入工作区（8 窗格：4 个 pane 连 x99 的不同 shell，2 个连 claude 容器，2 个监控日志）
2. 同事在 Windows B / 手机浏览器用同一账号 `admin` 登录 → **自动看到相同 8 格布局**，内容实时同步
3. 管理员在 pane#1 执行命令，所有人看到输出；同事在 pane#3 协助输入
4. 管理员关闭浏览器下班，同事继续操作，会话不中断

**S2 · 会话长期存活**
1. 打开 pane 运行长任务（tail -f 日志 / 编译）
2. 浏览器关闭 / 网络闪断 / 电脑休眠
3. 重新打开 → 自动重连到原 tmux 会话，屏幕内容与 scrollback 完整恢复

**S3 · 教学/演示**
1. 主讲人开启广播模式，输入同步到全部 8 个 pane（或选中 pane 组）
2. 观众端不做任何操作，只观看（同账号下天然可见）

### 2.3 场景验收（可测试）
- [ ] 同账号在 Windows A / Windows B / 手机浏览器同时打开 WebTerm，布局渲染一致（视觉对比截图）
- [ ] A 端拖动分割条调整布局 → B 端 1 秒内同步
- [ ] A 端关闭浏览器 → B 端会话与布局不丢；A 重开 → 恢复且不覆盖 B 的当前状态
- [ ] 8 pane 并发滚动大日志（如 `yes | head -100000` 级输出），无明显卡顿（帧率可测）

---

## 3. 功能需求规格

### 3.1 功能总览与优先级

| 编号 | 功能 | 优先级 | 现状 | 说明 |
|---|---|---|---|---|
| F1 | 同账号多端布局/会话同步 | **P0** | 已有基础（LayoutHub 按 userID + tmux attach） | 强化为完整多端协同 |
| F2 | 多端在线端可见性（presence） | **P0** | 无 | pane 标题栏显示在线端数 |
| F3 | 持久化终端（tmux 会话层） | **P0** | 已有 | 强化：预检/重连/清理 |
| F4 | 同步输入 / 广播 | **P0** | 有广播（上游） | 升级为 pane 组/leader 模式 |
| F5 | 8 窗格布局模板与拖拽 | **P0** | 有分屏 | 补模板、拖拽、重命名、布局持久化 |
| F6 | 心跳 + 断线自动重连 | **P0** | 无（依赖浏览器重载） | 关键可靠性 |
| F7 | xterm WebGL 渲染降级链 | **P0** | 未确认（xterm 5.x） | 性能关键 |
| F8 | 端口转发管理 | P1 | 无 | SSH tunnel |
| F9 | 命令片段 Snippets + 宏 | P1 | 无 | Termius/Xshell 式 |
| F10 | Tab Manager（多标签检索/重组） | P1 | 有多标签 | 增强 |
| F11 | SFTP 跟随 cd | P1 | 有 OSC7 基础 | WindTerm 式 |
| F12 | WS 多路复用（单连接多通道） | P1 | 每 pane 一连接（D2） | 架构演进 |
| F13 | AI 侧栏（报错解释/命令生成） | P2 | 无 | Warp/Tabby 式 |
| F14 | 审计录制回放 + 高危命令阻断 | P2 | 无 | JumpServer 式 |
| F15 | 移动端触控优化 | P2 | 响应式基础 | Termius/Blink 式 |

### 3.2 P0 详细规格

#### F1 · 同账号多端布局/会话同步（核心护城河）
**目标**：同一账号在多个浏览器登录，共享同一套布局与会话。
- **复用现有机制**：`LayoutHub` 已按 `userID` 隔离订阅（revision 广播 + 权威拉取）；持久化终端已按 `wt-<userID>-<connID>-<hash>` 命名 tmux session。同账号多端天然共享——这正是 D1 选同账号模式的原因：**现有架构无需引入 workspace/member/invite 即可成立**。
- **强化点**：
  1. 布局 revision 持久化到 DB（当前可能仅内存），浏览器重开/服务端重启后不丢
  2. 多端并发修改布局的冲突合并（后写覆盖 + 增量 diff 提交，见 ADR-3）
  3. pane 级状态（title、connId、terminalId、broadcastGroup）随布局一并持久化
- **验收**：
  - [ ] 同账号 Windows A / B / 手机三端同时打开，布局一致
  - [ ] 任一端改动布局，其他端 1 秒内同步
  - [ ] 服务端重启后，布局与会话可恢复（tmux 会话在远端，天然存活）

#### F2 · 多端在线端可见性（presence）
**目标**：明确"当前有哪几个终端连着这个工作区"，便于协同。
- `SessionRegistry` 记录每个 pane 的订阅者（wsConn 集合），按 userID 归组
- pane 标题栏显示：`pane 标题 · 2 端在线`；WS 广播 `presence` 事件（进入/离开）
- **验收**：
  - [ ] 两台浏览器同时开着 pane#1，标题栏显示 2 端在线
  - [ ] 关闭一台，显示变 1 端

#### F3 · 持久化终端（强化）
现状：每个 pane 通过 `tmux new-session -Ad -s wt-<uid>-<connid>-<sha256(terminalId)[:8]>` + `attach-session` 实现多端 attach，`window-size largest` 防重连缩屏，`history-limit 200000`。

**强化项**：
1. **启动预检**（D3）：连接建立时执行 `tmux -V`，版本 < 3.1 或不存在 → 返回明确错误（"目标主机需 tmux ≥ 3.1，请安装"），不静默失败
2. **心跳保活**：SSH 会话空闲时服务端周期性轻量探测（SSH keepalive），防 NAT 断链
3. **孤儿会话清理**：pane 关闭 / 全部端离开且超过 TTL（如 24h）后 `tmux kill-session`（现有 close 命令已幂等）
4. **重连恢复**：前端断线重连后凭 `terminalId` 重新 attach 同一 session
- **验收**：
  - [ ] 无 tmux（或版本过低）的主机连接时给出可读错误
  - [ ] 浏览器关闭 30 秒后重开，原 pane 内容与 scrollback 完整
  - [ ] 空闲 10 分钟不断链

#### F4 · 同步输入 / 广播（pane 组）
- 上游已有"广播到分屏内/全局"。升级：
  - 每个 pane 有 `broadcastGroupId`（默认自身）
  - 广播模式：leader pane 输入 → 转发到组内所有 pane 的 tmux session
  - 支持"全部 8 格一键广播"（8 pane 同组）与"选中 pane 组"
- 仲裁：广播开启时，组内非 leader 输入被忽略（可选"任何人可输入"）
- **验收**：
  - [ ] 一键广播：pane#1 输入 `uptime`，8 个 pane 全部执行
  - [ ] 广播关闭后各 pane 独立

#### F5 · 8 窗格布局模板与拖拽调整
- 布局树（JSON，见 §6.3）：递归 split 结构
- 模板：`2x4`（2 行 4 列）、`4x2`（4 行 2 列）、`3x3+1`、`1x1`（单格）、自定义
- 拖拽：分割条拖拽调整 pane 尺寸（前端防抖 + 服务端同步尺寸比例）
- pane 操作：重命名（显示在 pane 标题栏，同步到多端）、关闭、放大（zoom）、新建
- **验收**：
  - [ ] 一键套用 2×4 模板创建 8 格
  - [ ] 拖拽调整后布局持久化，重开恢复
  - [ ] 多端实时看到拖拽结果同步

#### F6 · 心跳 + 断线自动重连（前端）
- 心跳：客户端每 30s 发 `{"type":"ping"}`，服务端 `pong`；连续 3 次无响应判定断线
- 重连：指数退避（1s/2s/4s...上限 30s），重连后：
  - 重新 attach tmux 会话（F3）
  - 重新拉取布局 revision（若落后则全量拉取）
  - 恢复 pane 尺寸（resize 消息重发）
- 前端断线期间显示"连接中…"横幅，不销毁 xterm 实例（保留缓冲区）
- **验收**：
  - [ ] 拔网线 30 秒内自动重连成功，无手动刷新
  - [ ] 重连后布局与 pane 内容一致

#### F7 · xterm WebGL 渲染降级链
- 引入 `@xterm/addon-webgl`；渲染器选择链：**WebGL → Canvas → DOM**（按浏览器支持降级）
- WebGL 失败（如禁用 GPU）时静默回退 Canvas/DOM，不白屏
- 配合 F5 的 8 pane 场景，GPU 渲染收益最明显
- **验收**：
  - [ ] Chrome 下 8 pane 同时滚动大输出，帧率 ≥ 45fps（DevTools 可测）
  - [ ] 禁用 WebGL 后仍可用（回退 DOM，帧率可降但不出错）

### 3.3 P1 详细规格（要点）

| 编号 | 功能 | 关键规格 |
|---|---|---|
| F8 | 端口转发 | 连接级配置 `local_port → remote:port`；服务端监听本地端口并桥接 SSH channel；Web UI 建/删/查看状态 |
| F9 | Snippets | 表 `snippets(id,user_id,name,command,created_at)`；pane 内弹出选择器一键填入；支持 `{arg}` 变量 |
| F10 | Tab Manager | 多标签搜索（按主机/名称）；拖拽重组 tab 组；跨窗口移动（浏览器多窗口场景） |
| F11 | SFTP 跟随 | 终端 pane 收到 OSC7 cwd 变更 → SFTP 面板切到同目录（防抖 500ms） |
| F12 | WS 多路复用 | 单一 `/ws/workspace/{wsid}` 承载：布局事件 + N 个 SSH 通道（`sid` 路由）+ 心跳；减少连接数、统一广播（D2：P1 再做，P0 保持每 pane 一连接） |

### 3.4 P2 详细规格（要点）

| 编号 | 功能 | 关键规格 |
|---|---|---|
| F13 | AI 侧栏 | 可选接入（可复用用户 x99 上的 claude 容器能力）；选中终端报错文本 → 侧栏解释/给命令；不要求内置模型 |
| F14 | 审计 | 服务端记录输入流（ASCII 流式写入文件/SQLite）；回放为"重放模式"终端；可选高危命令正则拦截（如 `rm -rf /`、`reboot`）——默认关闭，配置开启 |
| F15 | 移动端 | 触屏键盘栏（Tab/Esc/Ctrl/方向键）、文本输入模式（放大输入框）、pane 切换手势、只读默认 |

---

## 4. 非功能需求（NFR）

### 4.1 性能指标（目标值，需压测确认）

| 指标 | 目标 | 备注 |
|---|---|---|
| 渲染帧率（8 pane 大输出） | ≥ 45fps（桌面 Chrome） | WebGL 渲染器 |
| 输入→回显延迟（局域网） | ≤ 100ms 端到端 | 局域网内应远低于此 |
| 单 pane 内存 | ≤ 150MB（scrollback 5000 行 + WebGL） | 见 §9.2 |
| 服务端并发 | 单用户 ≥ 24 路（8 pane × 3 端） | 已有容量测试脚本，固化为基线 |
| WS 消息吞吐 | 服务端广播 ≤ 1000 msg/s 不丢 | revision 合并兜底 |

### 4.2 可靠性
- 心跳 + 指数退避重连（F6）
- 会话持久化（F3）：浏览器/网络/服务端进程三态下，tmux 侧会话不丢
- 服务端优雅退出：SIGTERM 时广播通知，不 kill 远端 tmux 会话

### 4.3 安全性
- 认证：JWT（已有）；**WS 握手需校验鉴权（现状缺口，P0 必修，见 §10.3）**
- 凭据：AES 加密存储（已有），密钥来自 env（`WEBTERM_ENCRYPTION_KEY`）
- 主机密钥：host key 校验 + known_hosts（已有）
- 注入防护：tmux session 名由受控字符 + SHA256 生成（已有），保持
- 传输：Caddy HTTPS + 局域网 IP 白名单（已有，`192.168.11.0/24`）

### 4.4 可扩展性
- D1 同账号模式：当前以 userID 为维度；未来多账号只需增加 workspace/member 层（表已预留），协议层不变
- 协议层预留 Telnet/串口 扩展（当前 SSH/SFTP/DB 三个 WS 端点）
- 前端状态纯 zustand，可扩展新 pane 类型

### 4.5 兼容性
- 浏览器：Chrome/Edge/Firefox（WebGL 支持检测）
- 目标主机：Linux，**tmux ≥ 3.1**（D3）
- 部署：Go 单二进制 + Caddy（已有 lan-up.sh 一键脚本）

---

## 5. 架构设计

### 5.1 总体架构

```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│  Windows A    │   │  Windows B    │   │  手机浏览器   │
│ (同账号:admin) │   │ (同账号:admin) │   │ (同账号:admin)│
└──────┬───────┘   └──────┬───────┘   └──────┬───────┘
       │  HTTPS 9443 (Caddy, LAN whitelist)  │
       └───────────────┬────────────────────┘
                       ▼
        ┌──────────────────────────────┐
        │   WebTerm Server (Go, :8888) │
        │  ┌─────────────────────────┐ │
        │  │ HTTP/REST (auth,CRUD)   │ │
        │  │ WS /ws/ssh /ws/layout   │ │
        │  │  ├─ LayoutHub (per-user)│ │
        │  │  └─ SessionRegistry     │ │
        │  │      (paneId→tmux,subs) │ │
        │  │  SSH Pool (sshmgr)      │ │
        │  │  Persistence (SQLite)   │ │
        │  └─────────────────────────┘ │
        └──────────────┬──────────────┘
                       │ SSH (x/crypto/ssh)
        ┌──────────────▼──────────────┐
        │  Target Linux (x99 等)       │
        │  sshd + tmux (每 pane 一会话) │
        └─────────────────────────────┘
```

### 5.2 后端模块（对应现有包结构）

| 模块 | 职责 | 现状 → 演进 |
|---|---|---|
| `handler/layout*.go` | 布局 CRUD + Hub | 保持按 userID；revision 持久化到 DB |
| `handler/persistent_terminal.go` | tmux 会话命令构造 | 增加预检（tmux ≥ 3.1）、孤儿清理 |
| `handler/ws*.go` | SSH/SFTP/DB WS 端点 | P0 补 WS 鉴权；P1 增加多路复用（F12） |
| `handler/quick_connect.go` | 本机快捷连接 | 保持 |
| `sshmgr` | SSH 连接池 | 增加 keepalive、并发上限 |
| `store` | SQLite | 新增 layout 持久化、snippets 表 |
| `auth` | JWT | 保持 |

### 5.3 前端模块（React + TS + zustand）

| 模块 | 职责 |
|---|---|
| `components/layout/*` | 布局树渲染、分割条拖拽、模板、TabBar、Workspace |
| `store/layout.ts` | 布局状态 + revision + 乐观更新 + 冲突合并 |
| `store/terminal.ts` | xterm 实例池、active pane、scrollback 配置、重连状态 |
| `hooks/useWebSocket.ts` | WS 生命周期、心跳、指数退避重连、消息路由 |
| `components/terminal/*` | pane 组件（WebGL 降级链、fit 防抖、广播开关） |

### 5.4 关键设计决策（ADR）

#### ADR-1：tmux 作为"远端会话层"（保留，不替换）
- **决策**：每个 pane 对应一个远端 tmux session，多端 `attach-session` 实现同屏 + 持久化；布局/UI 完全由 Web 前端负责。
- **理由**：与"不要 tmux"的原始诉求不矛盾——tmux 不参与 UI 分屏，只做会话承载（tmate 同款模式）。相比自研 PTY 复用（复杂）和 Mosh（需服务端+UDP，局域网内收益低），tmux 是成本最低、最稳的共享+持久化方案。
- **代价**：目标主机必须装 tmux ≥ 3.1（D3，预检显式化）；`window-size largest` 依赖该版本。

#### ADR-2：WebSocket 连接模型（分阶段）
- **现状**：每 pane 一条 `/ws/ssh/{conn_id}`，8 pane = 8 连接。
- **P0 保持**：简单、已工作，先完成功能正确性。
- **P1 演进**（D2，F12）：`/ws/workspace/{wsid}` 单连接多路复用，`sid` 路由通道 + 布局事件 + 心跳合一。理由：多端广播需要统一通道；连接数随 pane×端线性增长，3 端×8 pane=24 连接对浏览器和服务端都不友好。
- **协议**：消息携带 `sid`，见 §6.2。

#### ADR-3：布局同步协议（revision 广播 + 权威拉取，保留并强化）
- **现状**：`LayoutHub.Publish(userID, revision)` 只广播 revision 号；客户端 `GET /api/layout` 拉权威布局。阻塞浏览器只保留最新 revision（channel cap=1）。
- **理由**：避免广播全量布局的开销，revision 合并天然抗风暴。
- **强化**：revision 持久化到 DB + 单调递增；客户端对 `revision <= 本地` 的更新忽略（防乱序）；布局变更以服务端确认的 revision 为准（乐观更新回滚机制）。
- **冲突合并**：同时拖拽不同 pane → 服务端按"后写覆盖"合并，但因布局树是增量 diff 提交（只提交变更的 size 字段），冲突面极小。

#### ADR-4：会话身份模型（同账号模式，D1）
- **决策**：布局与广播的隔离维度 = **userID**（现有实现）。同账号多端共享无需 workspace/member 层。
- **理由**：与用户原始诉求"同账号三端"完全吻合；复用现有 LayoutHub 与 tmux 命名（`wt-<userID>-...`），改动最小。
- **未来扩展**：多账号场景时，在 userID 之上叠加 workspace/member 层（表已预留 DDL），协议与前端 store 的维度字段保持兼容。

#### ADR-5：输入仲裁
- 常规模式：同一 pane 被多端 attach 到同一 tmux session，天然支持多人输入（tmux 本就允许）。
- 广播模式（F4）：leader 输入 → 组内广播；非 leader 输入忽略。
- 同账号下无 viewer/editor 之分（D1），只读由"广播 leader 模式"与"移动端默认只读"表达。

---

## 6. 协议设计

### 6.1 REST API（新增/变更，同账号模式下精简）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/layout` | 获取当前用户布局（已有） |
| PUT | `/api/layout` | 提交布局变更（body: `{layout, baseRevision}`，返回 `{revision}`）——revision 持久化 |
| POST | `/api/snippets` / GET `/api/snippets` | Snippets 增查（P1） |
| POST | `/api/connections/{id}/port-forwards` | 端口转发管理（P1） |

> 多账号相关（invite/member/workspace）本期不开放（D1），DDL 保留备用。

### 6.2 WebSocket 消息协议

**通道模型（P0：每 pane 一个连接；P1 多路复用，sid 恒为 paneId）**

统一消息 JSON（二进制负载可选 ArrayBuffer 优化）：

```
客户端 → 服务端
{ "sid":"p1", "type":"input",      "data":"<base64 or binary>" }
{ "sid":"p1", "type":"resize",     "cols":120, "rows":32 }
{ "sid":"*",  "type":"layout",     "action":"update", "layout":{...}, "baseRevision":12 }
{ "sid":"*",  "type":"broadcast",  "on":true, "group":["p1","p2",...] }
{ "sid":"*",  "type":"ping", "seq":1 }

服务端 → 客户端
{ "sid":"p1", "type":"output",     "data":"<base64 or binary>" }
{ "sid":"p1", "type":"exit",       "code":0 }
{ "sid":"*",  "type":"layout_rev", "revision":13 }          // 广播 revision，客户端拉取
{ "sid":"*",  "type":"presence",   "online":2 }             // pane 当前在线端数（F2）
{ "sid":"*",  "type":"pong", "seq":1 }
{ "sid":"*",  "type":"error",      "code":"FORBIDDEN", "msg":"..." }
```

**心跳与重连**
- 客户端每 30s `ping`；服务端 `pong` 回显 seq。
- 连续 3 次无 pong → 判定断线，指数退避重连（1s/2s/4s/.../30s 上限）。
- 重连后：`resize` 全量重发 + `layout` revision 比对拉取。

### 6.3 布局树结构（JSON Schema）

```json
{
  "version": 1,
  "root": {
    "type": "split",
    "dir": "v",            // v=vertical(左右), h=horizontal(上下)
    "sizes": [0.5, 0.5],   // 子节点相对比例（可选，默认均分）
    "children": [
      { "type": "split", "dir": "h", "sizes": [0.5, 0.5], "children": [
          { "type": "pane", "id": "p1", "connId": 5, "terminalId": "a1b2c3", "title": "x99-shell", "broadcastGroup": "g1" },
          { "type": "pane", "id": "p2", "connId": 6, "terminalId": "d4e5f6", "title": "claude-main", "broadcastGroup": "g1" }
      ]},
      { "type": "split", "dir": "h", "sizes": [0.5, 0.5], "children": [
          { "type": "pane", "id": "p3", "connId": 5, "terminalId": "g7h8i9", "title": "logs" },
          { "type": "pane", "id": "p4", "connId": 0, "terminalId": "j0k1l2", "title": "local", "local": true }
      ]}
    ]
  }
}
```

- 布局以**增量 diff** 提交（只传被改动的节点），服务端合并且 revision+1
- pane 的 `terminalId` 即 F3 的 tmux 会话身份（同一账号内唯一）

---

## 7. 数据模型（SQLite）

```sql
-- 现状表（已有）：users / connections / groups / db_connections ...
-- 新增：布局持久化 + snippets

CREATE TABLE IF NOT EXISTS user_layouts (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id),
  layout_json TEXT NOT NULL DEFAULT '{}',
  revision    INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS snippets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  name       TEXT NOT NULL,
  command    TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- P1 端口转发
CREATE TABLE IF NOT EXISTS port_forwards (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  conn_id      INTEGER NOT NULL REFERENCES connections(id),
  direction    TEXT NOT NULL DEFAULT 'local',
  local_port   INTEGER NOT NULL,
  remote_host  TEXT NOT NULL DEFAULT '127.0.0.1',
  remote_port  INTEGER NOT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- D1 多账号预留（本期不实现逻辑，仅占位，后续需要时再启用）
-- CREATE TABLE workspaces (...);
-- CREATE TABLE workspace_members (...);
-- CREATE TABLE invites (...);
```

**内存会话注册表**（非 DB）：
```
SessionRegistry:
  userID -> {
    paneID -> { tmuxSessionName, subscribers: [wsConn...], lastActiveAt }
  }
```

---

## 8. 前端设计要点

### 8.1 状态管理（zustand）

- `layoutStore`：`{ layoutTree, revision, pendingOps[], applyTemplate(), submitDiff(), onRevisionRev() }`
  - 乐观更新：本地立即渲染 → 提交 diff → 服务端返回新 revision → 确认；被拒则回滚
- `terminalStore`：`{ instances: Map<paneId, {term, socket, status}> , activePaneId, setActive(), register(), dispose() }`
- `presenceStore`：各 pane 在线端数（F2，来自 `presence` 消息）

### 8.2 终端实例管理（性能关键）

- **Lazy Mount**：只挂载可见 pane 的 xterm 实例；隐藏 pane 保留状态但降载。参考：只挂载 active + 最近 2 个。
- **scrollback 自适应**：按活跃 pane 数动态调整：`effectiveScrollback = clamp(10000 - 500*(paneCount-1), 2000, 10000)`（8 pane 时约 6500）。参考 ClawTerm 方案。
- **WebGL 降级链**：`WebglAddon → CanvasAddon → DOM`，异常捕获静默降级。

### 8.3 布局渲染与 resize（防死循环）

- **已知坑（必须规避）**：多 pane 平铺时 `fit()` ↔ `ResizeObserver` 反馈循环（亚像素不收敛，CPU 打满 + resize RPC 风暴，参考 stapler-squad issue #164）。
- 对策：
  1. ResizeObserver 回调合并到 `requestAnimationFrame`，且同一 frame 只 fit 一次
  2. 只有当行列数**真的变化**时才发 resize（比较 cols/rows，忽略亚像素）
  3. 拖拽期间节流（拖拽结束才批量 fit）
  4. 服务端对 resize 做幂等 + 限频
- **分割条拖拽**：绝对定位 + 拖动时只更新 CSS 尺寸（不触发 fit），拖完提交布局 diff

### 8.4 输入通路
- `term.onData` → 若广播 leader 拦截非 leader 输入；普通模式直接经 WS `input` 发送
- 广播模式：leader pane 的 input 同时写入组内各 pane 的 tmux session（服务端转发）

---

## 9. 性能优化方案

### 9.1 渲染
| 措施 | 说明 |
|---|---|
| WebGL 渲染器（P0） | 8 pane GPU 加速；WebGPU→WebGL→DOM 降级链 |
| 批量写入 | 服务端输出按帧合并，前端 `requestAnimationFrame` 批量 `term.write` |
| 二进制帧 | 高吞吐时 output/input 负载用 ArrayBuffer，避免 JSON base64 膨胀 |

### 9.2 内存
| 措施 | 说明 |
|---|---|
| scrollback 自适应 | 随 pane 数动态下调（§8.2） |
| WebGL 纹理上限 | `textureAtlasSize` 控制在 2048 |
| 隐藏 pane 降载 | 未激活 pane 释放 WebGL 纹理 |
| 服务端输出缓冲 | 每 pane 输出缓冲上限（如 512KB），超限丢最旧 |

### 9.3 网络
- 心跳 + 退避重连（F6）
- WS 多路复用（P1，F12）：减少连接数，统一广播通道
- 布局 revision 合并：风暴下只同步最新 revision

### 9.4 服务端
| 措施 | 说明 |
|---|---|
| SSH 连接池 | 已存在；加 keepalive（空闲探测） |
| 每用户并发上限 | 超限拒绝或排队（配合已有容量测试） |
| 容量基线 | `scripts/run-multiclient-capacity.mjs` 固化为 CI 门禁：单用户 24 路（8×3）不超限 |

### 9.5 已识别的坑（对照检查表）
- [ ] fit↔ResizeObserver 死循环（§8.3）
- [ ] xterm scrollback 无界内存（§9.2）
- [ ] 多 pane 首屏同时挂载导致卡顿（Lazy Mount）
- [ ] resize 消息风暴（幂等 + 限频）
- [ ] 长 scrollback 下 WebGL 纹理泄漏（隐藏 pane 释放）

---

## 10. 安全设计

### 10.1 认证与授权
- JWT（已有），同账号模式（D1）：单账号体系，无角色细分
- 广播 leader 模式与移动端只读作为"操作边界"，不做账号级 RBAC

### 10.2 凭据安全（现状已达标，保持）
- AES 加密存储，密钥来自 env（`WEBTERM_ENCRYPTION_KEY`）
- 列表接口只返回 `hasSavedCredentials`，不暴露明文（参照 Jstrom2022/webSSH 做法）

### 10.3 WebSocket 鉴权（**现状缺口，P0 必修**）
- 当前 `main.go` 中 `/ws/ssh/{conn_id}`、`/ws/sftp/{conn_id}`、`/ws/db/{conn_id}` **未包 `auth.Middleware`**（与 `/ws/layout` 一致，但 layout 走 handler 内部逻辑）。需确认是否依赖连接内校验；若未校验，必须：
  1. WS 握手时校验 JWT（cookie 或 query token）
  2. 校验用户对 `conn_id` 的访问权限
  3. 未授权连接直接拒绝（101 前返回 401/403）

### 10.4 注入防护（现状已达标，保持）
- tmux session 名仅含 `wt-<uid>-<connid>-<sha256hex>`，无调用方文本进 shell（persistent_terminal.go 已验证）

### 10.5 审计（P2 可选）
- 输入流记录 + 回放；高危命令正则拦截（默认关闭）

---

## 11. 测试与验收策略

### 11.1 单元/集成（沿用现有测试体系，补齐）
- layout：revision 单调、阻塞订阅者合并、并发修改合并
- persistent terminal：session 名受控、close 幂等、无注入、tmux 版本预检
- 广播：pane 组路由、非 leader 忽略

### 11.2 多端一致性 E2E（新增，核心）
- Playwright 双浏览器（同账号）场景：
  - 两浏览器同一账号进入，布局一致（截图对比）
  - A 拖拽 → B 同步
  - A 广播输入 → B 的组内 pane 出现输出
  - A 关闭重连 → 会话不丢、布局以服务端 revision 为准
- 参考现有 `verify-persistent-terminal.mjs`、`run-multiclient-capacity.mjs` 脚本模式

### 11.3 性能回归（新增）
- 8 pane 并发大输出帧率基线（DevTools/Playwright 录制）
- 24 路并发连接容量基线（已有脚本固化为门禁）

### 11.4 验收门槛（合并 §2.3 场景验收）
- 所有 P0 功能验收项全绿
- 无回归：现有测试全过 + 新增用例全过
- 性能基线达标（§4.1）

---

## 12. 里程碑路线图

| 里程碑 | 范围 | 预计工作量（人日，估算） | 交付物 |
|---|---|---|---|
| **M1 · P0 协同底座** | F1/F2/F3强化/F4/F5/F6/F7 + WS 鉴权修复 | 8~12 | 同账号多端协同 + 广播 + WebGL + 重连 |
| **M2 · P1 生产增强** | F8~F12（含 WS 多路复用） | 10~15 | 端口转发/Snippets/Tab Manager/SFTP 跟随/WS 多路复用 |
| **M3 · P2 能力外延** | F13~F15 | 8~12 | AI 侧栏/审计/移动端 |
| 持续 | 测试与性能门禁 | 穿插 | E2E + 容量基线 CI |

**建议 M1 内的开发顺序**：F7（WebGL，半天，性能地基）→ F6（心跳重连）→ F1/F5（布局持久化 + 模板/拖拽）→ F4（广播）→ F2（presence）→ F3 强化 → WS 鉴权修复。

---

## 13. 风险与开放问题

| # | 风险/问题 | 影响 | 缓解 |
|---|---|---|---|
| R1 | tmux `window-size largest` 依赖版本 | 老版本 tmux 重连缩屏 | D3：预检要求 ≥ 3.1，文档声明 |
| R2 | 多端同 pane 输入冲突 | 体验混乱 | ADR-5 仲裁 + 广播 leader 模式 |
| R3 | 布局 revision 乱序 | 布局不一致 | 服务端单调递增 + 客户端忽略旧 revision |
| R4 | 8 pane 首屏挂载卡顿 | 性能 | Lazy Mount + WebGL |
| R5 | WS 鉴权缺口 | 安全 | P0 必修（§10.3） |
| O1 | 多账号协作是否需要 | 范围 | D1 已拍板同账号；未来需要时启用预留表 |
| O2 | 是否需要 Telnet/串口 | 范围 | 协议层预留，看使用反馈 |

---

## 14. 附录

### 14.1 竞品功能借鉴矩阵（调研结论，2026-09）

| 能力 | sshx/tmate | Termius | JumpServer | WindTerm | ttyd | Warp/Blink | 建议优先级 |
|---|---|---|---|---|---|---|---|
| 多端会话同屏共享 | ✓✓ | ✓ | ✓ | – | ✓ | – | P0（已做） |
| 同布局多端同步 | ✓ | – | – | – | – | – | P0（护城河） |
| 会话持久化 | ✓ | ✓ | ✓ | – | – | ✓ | P0（已做） |
| 同步输入/广播 | ✓ | – | – | ✓ | ✓ | – | P0 |
| 端口转发 | – | ✓ | ✓ | ✓ | – | ✓ | P1 |
| 录像回放/命令审计 | – | – | ✓✓ | – | – | – | P2 |
| 高危命令过滤阻断 | – | – | ✓✓ | – | – | – | P2 |
| AI 集成 | – | ✓ | – | – | – | ✓✓ | P2 |
| 代码片段/宏/脚本 | – | ✓ | – | ✓ | – | ✓ | P1 |
| 移动端原生/触屏 | – | ✓✓ | – | – | – | ✓✓ | P2 |
| 弱网/断线续连 | – | ✓ | – | ✓ | – | ✓✓ | P1 |
| 高吞吐 GPU 渲染 | – | – | – | – | ✓✓ | – | P0（性能） |

### 14.2 术语表
- **pane**：布局树叶子，一个终端实例，对应一个远端 tmux session
- **revision**：布局版本号，单调递增，多端同步依据
- **广播**：leader pane 输入转发到组内其他 pane
- **Lazy Mount**：仅挂载可见 pane 的 xterm 实例
- **同账号多端**：同一账号在多个浏览器/设备登录，共享布局与会话（D1）

### 14.3 主要参考资料
- xterm.js（WebGL/Canvas/DOM 渲染、serialize、fit）：https://github.com/xtermjs/xterm.js
- tmux（split/resize/zoom/window-size）：https://tmux.app/doc/
- sshx（web 协作终端）：https://sshx.io/
- tmate（tmux 共享）：https://tmate.servme.network/
- JumpServer（审计/双人复核/命令过滤）：https://jumpserver.org/features.html
- Termius（跨端同步/Snippets/端口转发）：https://www.termius.com/
- Blink Shell（Mosh 断线续连/移动端）：https://blink.sh/
- Mosh（预测回显/SSP 协议）：https://mosh.mit.edu/mosh-paper-draft.pdf
- nexus-terminal WS 多路复用协议（sid 路由）：https://github.com/Silentely/nexus-terminal
- Jstrom2022/webSSH（WS 协议 connect/input/resize + 凭据元信息）：https://github.com/Jstrom2022/webSSH
