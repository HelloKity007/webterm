# WebTerm

> [中文文档](README_zh.md)

Web-based SSH/SFTP/Database terminal manager. Single binary, Go backend + React frontend.

## Features

- **SSH Terminal** — xterm.js based, multi-tab, split panes with CSS Grid; persistent tmux sessions reconnect after browsers close
- **SFTP File Manager** — dual-pane, drag-drop upload, context menu, directory following (OSC 7)
- **Database Query Editor** — SQL highlighting, result table
- **Connection Manager** — groups, tags, color labels, search, multi-select batch ops
- **OneKey** — preset credential key-value pairs for quick auth
- **Broadcast** — send input to all terminals in a pane or globally
- **Theme** — multiple terminal color schemes, highlight rules

## Quick Start

```bash
make build          # build frontend + Go binary
./scripts/lan-up.sh  # serves LAN HTTPS on :9443 through Caddy
```

Default admin: `admin` / `admin`

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Go 1.22+, net/http |
| Frontend | React 19, TypeScript, Vite |
| Terminal | xterm.js 5.x, @xterm/addon-fit, @xterm/addon-search |
| SSH | golang.org/x/crypto/ssh |
| SFTP | github.com/pkg/sftp |
| Database | SQLite (mattn/go-sqlite3) |
| State | Zustand |
| Auth | JWT (golang-jwt/jwt) |

## Open Source Dependencies

- [xterm.js](https://github.com/xtermjs/xterm.js) — MIT
- [x/crypto/ssh](https://pkg.go.dev/golang.org/x/crypto/ssh) — BSD-3
- [pkg/sftp](https://github.com/pkg/sftp) — BSD-2
- [zustand](https://github.com/pmndrs/zustand) — MIT
- [go-sqlite3](https://github.com/mattn/go-sqlite3) — MIT
- [golang-jwt](https://github.com/golang-jwt/jwt) — MIT
- [Vite](https://vitejs.dev/) — MIT
- [React](https://react.dev/) — MIT

## Config

`config.yaml`:
```yaml
listen_addr: "127.0.0.1:8888"
encryption_key_env: "WEBTERM_ENCRYPTION_KEY"
ssh_host_key_check: true
ssh_known_hosts: "ssh_known_hosts"
local_quick_connect:
  host: "127.0.0.1"
  port: 22
  username: "your-linux-user"
  password_env: "WEBTERM_LOCAL_SSH_PASSWORD"
log_level: "info"
```

For LAN deployment, keep `config.yaml` and `lan-secrets.env` at mode `600`. The ignored `lan-secrets.env` supplies `WEBTERM_ENCRYPTION_KEY`, `WEBTERM_LOCAL_SSH_PASSWORD`, `LAN_TLS_CERT`, and `LAN_TLS_KEY`; never commit it. `Caddyfile` allows only `192.168.11.0/24` on HTTPS port `9443` and proxies to loopback `127.0.0.1:8888`.

SSH targets used by the terminal must have `tmux` installed. A terminal tab reconnects to its server-side tmux session after every browser closes. Closing the tab explicitly terminates that tmux session and its attached SSH sessions; typing `exit` in the shell does the same.

## License

MIT
