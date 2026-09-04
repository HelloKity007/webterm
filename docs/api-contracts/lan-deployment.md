# LAN Deployment API Contract

## Authentication

所有接口使用现有 JWT 中间件。请求和响应绝不包含 SSH 密码、私钥或加密字段。

## `GET /api/layout`

- 权限：任何已登录用户。
- `200`：`{"schema_version":1,"revision":N,"layout":{...}}`；无保存记录时返回空 root 布局和 revision `0`。

## `PUT /api/layout`

- 权限：任何已登录用户。
- 请求：`{"schema_version":1,"revision":N,"layout":{...}}`。
- 校验：JSON 不超过 256 KiB、layout 是有效 pane 树、每个 SSH tab 的连接对当前用户仍可用。
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
- 前提：SSH 目标机必须安装 `tmux`。用户在 shell 中执行 `exit`，或远端管理员执行 `tmux kill-session`，会终止该持久终端。
- 隔离：不同应用用户、连接或 tab ID 绝不复用 tmux 名称；`terminal_id` 不直接插入 shell 命令。

## Connection resource extension

- `Connection` 新增 `system_managed`、`hidden`。
- 常规连接列表默认排除 `hidden`；admin 可请求内部恢复所需元数据，但前端连接管理仍隐藏它。
- 对受管连接的常规 `PUT` / `DELETE` 返回 `403`。
