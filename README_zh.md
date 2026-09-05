# WebTerm

> [English Docs](README.md)

基于 Web 的 SSH/SFTP/数据库终端管理器。单二进制文件，Go 后端 + React 前端。

## 功能

- **SSH 终端** — 基于 xterm.js，多标签、CSS Grid 分屏；浏览器断开后可重连 tmux 会话，主动关闭标签会终止并释放对应会话
- **SFTP 文件管理** — 双面板、拖拽上传、右键菜单、OSC 7 目录跟随
- **数据库查询** — SQL 高亮、结果表格
- **连接管理** — 分组、标签、颜色标记、搜索、多选批量操作
- **OneKey** — 预设密钥键值对，一键填充认证
- **广播** — 发送输入到分屏内或全局所有终端
- **主题** — 多种终端配色方案、高亮规则

## 快速开始

```bash
make build          # 构建前端 + Go 二进制
./scripts/lan-up.sh  # 通过 Caddy 在 LAN HTTPS :9443 提供生产服务
```

## 双环境发布

- 生产环境：`https://192.168.11.87:9443/`
- 发布测试环境：`https://192.168.11.87:9444/`

从干净的 `dev-*` 分支部署已提交的候选版本：

```bash
./scripts/release-deploy.sh
./scripts/release-status.sh
```

人工验收后，将批准记录绑定到该 commit，创建并推送指向同一 commit 的 `rb-*` 分支，再提升已经测试过的同一二进制：

```bash
./scripts/release-approve.sh
./scripts/release-promote.sh
```

需要回滚时只替换生产二进制：

```bash
./scripts/release-rollback.sh
```

发布测试数据库是生产库的一致性快照，因此既有 terminal ID 会连接到相同的远端 tmux 会话，但测试布局和用户数据修改不会写入生产库。测试环境关闭标签页也不会杀掉共享 tmux 会话。

默认管理员：`admin` / `admin`

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Go 1.22+, net/http |
| 前端 | React 19, TypeScript, Vite |
| 终端 | xterm.js 5.x, @xterm/addon-fit, @xterm/addon-search |
| SSH | golang.org/x/crypto/ssh |
| SFTP | github.com/pkg/sftp |
| 数据库 | SQLite (mattn/go-sqlite3) |
| 状态管理 | Zustand |
| 认证 | JWT (golang-jwt/jwt) |

## 开源依赖

- [xterm.js](https://github.com/xtermjs/xterm.js) — MIT
- [x/crypto/ssh](https://pkg.go.dev/golang.org/x/crypto/ssh) — BSD-3
- [pkg/sftp](https://github.com/pkg/sftp) — BSD-2
- [zustand](https://github.com/pmndrs/zustand) — MIT
- [go-sqlite3](https://github.com/mattn/go-sqlite3) — MIT
- [golang-jwt](https://github.com/golang-jwt/jwt) — MIT
- [Vite](https://vitejs.dev/) — MIT
- [React](https://react.dev/) — MIT

## 配置

`config.yaml`:
```yaml
port: 8888
encryption_key: "64位十六进制字符串"
log_level: "info"
```

## 许可证

MIT
