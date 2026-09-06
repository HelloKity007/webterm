# LAN Deployment API Contract

## Authentication

所有接口使用现有 JWT 中间件。请求和响应绝不包含 SSH 密码、私钥或加密字段。

## `GET /api/layout`

- 权限：任何已登录用户。
- `200`：`{"schema_version":1|2,"revision":N,"layout":{...}}`。schema v1 是兼容读取的单一 `{tree,panes}`；schema v2 为 `{"workspaceTabs":[{"id","index","name","layout"}]}`，其中每个 `layout` 沿用原 pane 模型。无保存记录时仍返回可迁移的空 schema v1 root 布局和 revision `0`。

## `PUT /api/layout`

- 权限：任何已登录用户。
- 请求：`{"schema_version":2,"revision":N,"layout":{"workspaceTabs":[...]}}`；滚动升级期间仍接受合法 schema v1。
- 校验：JSON 不超过 256 KiB、每个 workspace 的 ID/正整数 index 唯一、名称非空且不超过 256 字符、pane/session terminal ID 跨 workspace 唯一、每棵 pane 树有效、每个 SSH/DB tab 的连接对当前用户仍可用。
- 共享/本地边界：workspace 集合、固定 index、名称及各 pane 布局会保存；active workspace、focused pane 和 pane 内 active session tab 不保存。
- `200`：返回新 revision。
- `400`：无效 JSON、版本、大小或布局树。
- `403`：引用了不可用的连接。
- `409`：revision 已过期。

## `POST /api/quick-connect/local`

- 权限：仅 `admin`。
- `200`：`{"connection":{"id":N,"name":"本机 127.0.0.1"}}`。
- `403`：非 admin。
- `503`：本机受管连接未成功初始化；响应只提供不含 secret 的诊断码。

## `GET /ws/ssh/{connection_id}`

- 鉴权：现有 JWT `token` query 参数；浏览器不能在 WebSocket 握手中附带 `Authorization` header。
- 必填 query：`terminal_id`，即已持久化布局中的 tab ID。
- 行为：服务端以当前应用用户、连接 ID 和 `terminal_id` 派生受控 tmux 名称，执行 `tmux new-session -A -s …`。关闭所有浏览器只会 detach；重开相同 tab 会 attach 到同一 shell。
- 共享尺寸：同一 session 有多个不同大小的浏览器/pane 同时 attach 时使用 tmux `window-size largest`，由最大客户端决定并铺满共享 grid。tmux 通过受控 terminal title 广播权威 grid；较小浏览器以自适应字号和单元格间距显示完整 grid，不裁切右侧或底部。
- 固定控制 action：`clear_history`、`launch_codex_scrollable`、`resume_terminal_input`、`follow_terminal_input`。服务端重新派生 tmux target，不接受客户端给出的 session 名或 shell 命令；恢复输入会取消 tmux copy-mode，否则发送 `Ctrl+End` 给前台 CLI；视口跟随只把同 session 的较小客户端移到底部，不向前台程序键入内容。
- 前提：SSH 目标机必须安装 `tmux`。用户在 shell 中执行 `exit`，或远端管理员执行 `tmux kill-session`，会终止该持久终端。
- 隔离：不同应用用户、连接或 tab ID 绝不复用 tmux 名称；`terminal_id` 不直接插入 shell 命令。

## `DELETE /api/terminal-sessions/{connection_id}`

- 鉴权：现有 JWT `Authorization: Bearer …`。
- 必填 query：`terminal_id`，即用户明确关闭的 tab ID。
- 行为：幂等终止该用户、连接和 tab 唯一对应的 tmux session；所有 attach 到它的 SSH/WebSocket 会话随后结束并释放。只关闭浏览器或网络断开不会调用此接口。
- 隔离：服务端重新派生受控 tmux 名称，绝不接受客户端提供的 tmux session 名。

## Connection resource extension

- `Connection` 新增 `system_managed`、`hidden`。
- 常规连接列表默认排除 `hidden`；admin 可请求内部恢复所需元数据，但前端连接管理仍隐藏它。
- 对受管连接的常规 `PUT` / `DELETE` 返回 `403`。
