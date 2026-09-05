# WebTerm LAN 单点部署实施 Spec

> 状态：已收敛；双环境发布部分由 `2026-09-04-dual-environment-release-spec.md` 覆盖。
>
> 本文替代同路径的草案；产品总览仍见 `2025-05-22-webterm-design.md`。

## 1. 产品定位与范围

WebTerm 是部署在 Debian 13 `192.168.11.87` 的个人/小团队 LAN SSH、SFTP 与 MySQL 工具。服务仅对 `192.168.11.0/24` 提供访问，不面向公网，也不交付企业级 RBAC、SSO、审计、计费、Docker/Kubernetes 或前端品牌改造。

保留现有 SSH、多 tab、分屏、广播、SFTP、数据库、OneKey、连接管理和主题能力。本期新增/修正：安全的 HTTPS 部署边界、受管的本机快捷连接，以及按登录用户保存的工作区布局。

## 2. 已确认决策

| 项目 | 决策 |
|---|---|
| 对外入口 | 生产 `https://192.168.11.87:9443/`；发布测试入口见双环境发布 Spec |
| 现有 Rust WebTerm | 在最终部署切换时停止；本项目独占 `9443` |
| Go 监听 | 强制 `127.0.0.1:8888`，不暴露到 LAN |
| Caddy | 本项目独立进程，监听 `0.0.0.0:9443`，只允许 `192.168.11.0/24` |
| 本机快捷连接 | 使用本机 Linux 账号 `pgz`；密码仅作为部署 secret 注入，绝不写入仓库、文档或日志 |
| 快捷连接权限 | 仅 WebTerm `admin`；连接由后端管理，在普通连接管理 UI 隐藏且不能 CRUD |
| 布局持久化 | SQLite 按 WebTerm `user_id` 保存，可跨浏览器恢复 |
| 刷新语义 | 恢复布局、tab、标题、焦点；新建 SSH 会话，不恢复原 shell 进程、输出或滚动记录 |

## 3. 部署架构

```text
192.168.11.0/24 browser
       │ HTTPS / WSS :9443
       ▼
 Caddy (本项目，LAN allowlist)
       │ HTTP / WS 127.0.0.1:8888
       ▼
 Go WebTerm ── SQLite (用户、连接、每用户布局)
       │
       ├── 127.0.0.1:22（受管快捷连接）
       └── 任意已配置的 LAN Linux SSH 主机
```

- `9444` 现用于隔离的 release-test，详见双环境发布 Spec；两个环境的前端都继续由各自 Go 二进制 `embed.FS` 提供。
- Caddy 必须使用 IP 直连的 `remote_ip` allowlist，非 `192.168.11.0/24` 一律返回 `403`。WebSocket 升级通过 `reverse_proxy` 处理。
- 证书可在本项目 `certs/` 独立生成；证书 SAN 必须包含 `192.168.11.87`。Windows 客户端安装对应 mkcert 根 CA 至「受信任的根证书颁发机构」。
- 不启动半成品：`lan-up.sh` 预检二进制、Caddyfile、证书、secrets、配置权限、端口和 `127.0.0.1:22`。任何预检失败均非零退出。
- PID、日志放在 Git 忽略的运行目录；`lan-down.sh` 仅向自己的 PID 发送信号，绝不使用 `pkill` 或终止未知 Caddy 进程。

## 4. 配置与凭据

生产 `config.yaml` 的最小契约：

```yaml
listen_addr: "127.0.0.1:8888"
encryption_key: "<每次部署随机生成的 64 位十六进制值>"
log_level: "info"
ssh_host_key_check: true
ssh_known_hosts: "runtime/known_hosts"
local_quick_connect:
  host: "127.0.0.1"
  port: 22
  username: "pgz"
  password_env: "WEBTERM_LOCAL_SSH_PASSWORD"
```

- `config.example.yaml` 可跟踪；实际 `config.yaml` 和 `lan-secrets.env` 必须 Git 忽略且权限为 `600`。
- `lan-secrets.env` 包含 `WEBTERM_LOCAL_SSH_PASSWORD`、`LAN_TLS_CERT` 与 `LAN_TLS_KEY`；启动脚本以不回显方式导入。不得在命令行参数、HTTP 响应、前端状态、测试快照或日志中出现密码。
- 首次启动保留 WebTerm `admin/admin` 种子行为与警告；上线验收要求立即修改。凭据加密密钥不可为全零或空值。
- 部署时通过 `ssh-keyscan`（经人工核验指纹）写入 `runtime/known_hosts`；快捷连接和普通 SSH 连接均执行主机密钥校验。

## 5. 受管本机快捷连接

1. 启动时从配置和部署环境取得本机连接参数，将密码 AES-GCM 加密存入 SQLite 的受管连接记录。
2. 受管记录具有 `system_managed` 与 `hidden` 标记：只能由启动同步逻辑更新；常规连接 GET 默认对 UI 隐藏，PUT/DELETE 一律拒绝。
3. `POST /api/quick-connect/local` 仅接受有效 admin JWT，返回受管连接 ID、名称和可打开的 tab 描述；普通用户返回 `403`。
4. 前端 SSH 首页显示「连接到本机 127.0.0.1:22」；成功后以返回的连接 ID 打开 tab。密码永不进入浏览器。
5. 连接失败向终端显示脱敏的可操作错误（例如“认证失败”或“主机密钥不匹配”），日志同样不得包含 secret。

## 6. 每用户布局持久化

新增 SQLite 表：

```sql
user_layouts (
  user_id INTEGER PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  layout_json TEXT NOT NULL,
  updated_at DATETIME NOT NULL
)
```

- 布局 JSON 最大 256 KiB，只包含 pane 树、比例、tab（连接 ID、标题）、活动 tab 与焦点 pane；不保存 token、密码、终端输出或滚动记录。
- `GET /api/layout` 返回当前用户的默认/已保存布局和 revision；`PUT /api/layout` 校验 schema、大小、树结构与当前用户对每一个引用连接的使用权限。
- 使用 revision 乐观锁：陈旧写入返回 `409`，前端提示刷新/覆盖；前端在布局变化后 500ms 防抖保存。
- 登录后读取并恢复；恢复时跳过已删除或无权访问的 tab，保留其余 pane，并展示一次汇总提示。

## 7. 验收标准

部署完成必须同时满足：

- [ ] `ss` 证明 Go 仅监听 `127.0.0.1:8888`，Caddy 监听 `0.0.0.0:9443`；`8888` 无 LAN 暴露。
- [ ] Windows Chrome/Edge 从 `192.168.11.0/24` 打开 HTTPS/WSS 无证书警告；非 allowlist 客户端被 Caddy 拒绝。
- [ ] admin 能登录、能经快捷按钮进入本机 shell 并完成身份命令；普通 user 不显示按钮，直接调用 API 获得 `403`。
- [ ] 连接管理可新增并连接另一台 LAN Linux；主机密钥不匹配会失败而不是静默接受。
- [ ] 两个 WebTerm 用户拥有互不影响的布局；同一用户另一浏览器登录后可恢复。
- [ ] 刷新后恢复 pane/tab/标题/焦点，并明确验证每个恢复 tab 创建的是新 SSH 会话。
- [ ] 广播 `all`、SFTP `/tmp` 上传/下载（内容 hash 校验）、多 tab 与分屏保留正常。
- [ ] 16 个并发 SSH pane 完成规定的人工性能基线，且自动化连接稳定性测试通过。
- [ ] 每个实施阶段均有实际 RED→GREEN 的 TDD 记录、完整相关测试、浏览器自动化与截图/OCR 审核证据。

## 8. 参考与非目标

- 工程命令见 `CLAUDE.md`；构建入口为 `make build`。
- `2025-05-22-... schema` 是无效占位引用，移除，不作为实现依据。
- 不回到 Rust 项目继续开发，也不重写为 SpringBoot/Vue；停止 Rust 进程仅是本次端口交接操作。
