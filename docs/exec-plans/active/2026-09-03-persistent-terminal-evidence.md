## Evidence Report — 服务端持久终端会话 (Tier 3)

- Spec approval: not obtained (autonomous run); the user explicitly requested persistent sessions after all browser windows close.
- Baseline commit before this implementation: `b7941c9 feat: add LAN session sync and capacity safeguards`.
- Source state: the persistent-terminal change is intentionally uncommitted after that requested baseline commit.
- New dependencies: none; the managed local SSH target provides tmux 3.5a.
- Independent verification: not performed.

### Spec → test mapping

| Scenario | Test / execution | Status |
|---|---|---|
| 相同用户、连接和 tab 产生稳定的 tmux attach | `handler/persistent_terminal_test.go::TestPersistentTerminalCommandIsStableIsolatedAndShellSafe` | pass |
| 不同用户或 tab 不共享 tmux | same test | pass |
| tab ID 永不进入远端 shell 命令 | same test; command only contains SHA-256 digest | pass |
| 缺失稳定 tab ID 被拒绝 | `handler/persistent_terminal_test.go::TestPersistentTerminalCommandRejectsMissingTerminalID` | pass |
| 浏览器关闭后重开仍进入原 shell | `scripts/verify-persistent-terminal.sh` against deployed HTTPS/WSS | pass |

### Real execution (final fresh run)

`verify-persistent-terminal.sh` created an isolated temporary admin and tab, wrote marker one through the first browser, closed it, confirmed the remote tmux existed, opened a new browser with the same tab ID, wrote marker two, and inspected the tmux pane. Result:

```json
{"persistentSession":"wt-10-1-26ca792f88b6c1b6","retainedAcrossReconnect":true,"pageErrors":[]}
```

The script kills its temporary tmux session and deletes its temporary user in `finally`; it does not touch operator sessions.

### 2026-09-04 explicit tab-close extension

- `handler/terminal_session_test.go` pins the authenticated HTTP cleanup path and the exact shell-safe, per-user/connection/tab `tmux kill-session` target.
- `ui/src/api/terminalSessions.test.ts` pins the frontend DELETE request, terminal ID encoding, and JWT forwarding.
- `scripts/verify-persistent-terminal.mjs` now also closes the live tab, waits for its tmux session to disappear, and verifies the unrelated tab session remains. The live extension was not rerun in this workspace because its load-test URL and credentials are unavailable; syntax, unit tests, lint, and production build were verified locally.

### Gauntlet (final fresh run)

| Layer | Command | Result |
|---|---|---|
| Concurrency/full tests | `go test -race ./... -count=1` | pass; no race reports |
| Static checks | `go vet ./...` | pass |
| UI tests | `npm --prefix ui test` | 5 files, 6 tests passed |
| Lint | `npm --prefix ui run lint` | pass |
| Production build | `make build` | Vite production bundle and Go binary built successfully |
| Live verification | `scripts/verify-persistent-terminal.sh` | pass; retained across reconnect, 0 page errors |
| Manual mutation | accept missing `terminal_id`; replace digest with raw terminal ID | both killed by targeted tests (second mutant failed compilation before behavior, so it is weaker evidence) |

### Known limits

- Persistence lives on the SSH target in tmux, not in WebTerm memory. A WebTerm restart is safe; a remote host restart, `tmux kill-session`, or `exit` ends the session.
- The target host must install tmux. There is deliberately no non-persistent fallback.
- A browser or network disconnect only detaches. Explicitly closing a WebTerm tab terminates its derived tmux session and attached SSH sessions; `exit` or remote administration can also terminate it.
- Two browser clients that intentionally restore the same user/connection/tab attach to the same tmux terminal. Do not type concurrently unless shared-terminal behavior is desired.
