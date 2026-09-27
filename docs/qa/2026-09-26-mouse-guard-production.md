# Mouse-guard production deployment

User explicitly approved production deployment after the 9444 candidate handoff.

- Deployed version: `e9867b7-mouse-guard-final`.
- Binary SHA-256: `10f2fe327f7f26bdb026e19bad1529a2ff5448f9822d7abd8293711e920f710a`.
- Previous production version: `d0e584acbe8dc0c9637b2e942cda7040eed4931c`.
- Production and test health endpoints both report the candidate, with their respective environments.
- Main-worktree rebuild matched the running test binary byte for byte. Production received that tested binary without rebuilding during promotion.
- At deployment time, source was based on `e9867b7` plus the then-uncommitted mouse-guard changes. The deployment itself did not commit or push; the user subsequently requested source commit/push. File hashes, a patch, and the relevant source archive are in `runtime/mouse-guard-production-deployment/`.

## Release verification

`WEBTERM_QA_OUTPUT=runtime/mouse-guard-final-production-gate node scripts/run-terminal-visual-gate.mjs`

PASS: all 33 automated cases (11 each for fresh, normal reload, and cache-bypassing reload). Coverage includes Bash/Claude repeated input, tab retention, cross-pane movement, two displays, composer/history controls, mobile browser emulation, and disposable workspace closure. Sampled screenshots were reviewed for terminal content, composer/statusline, history-return controls, and mobile layout. Two-display recordings reported no same-geometry font changes in any phase.

PASS: `go test -race ./handler ./sshmgr -count=1`, `go vet ./handler ./sshmgr`, and `git diff --check`.

Production browser smoke passed after promotion: login, fresh load, normal reload, and cache-bypassing reload. Each showed eight rendered panels, zero identity-fault overlays, unchanged selected terminal IDs, and no page errors. These were Linux Chromium checks, not physical Windows/Android checks. This deployment did not run destructive Docker/tmux fault injection; prior isolated mouse fixtures must not be described as actual container restart coverage.

## Session preservation and rollback

The application retained the existing production database and pinned tmux configuration (`/home/pgz/.local/state/webterm/bin/tmux-production`, socket `webterm-production-durable`). All 32 local tmux pane identities, creation timestamps, and pane PIDs were identical immediately before and after promotion. No tmux restart or session recreation was performed.

Before stopping the old application, the deployment saved the production binary, made a SQLite backup, verified required runtime environment values without logging them, and staged the exact tested binary. Only the application PID was stopped gracefully. The replacement reused the previous process's arguments and environment. Health/identity failure would have restored the previous binary automatically.

The configured TLS files are absent, while the existing Caddy process continues serving HTTPS. Therefore the standard launcher preflight could not be used unchanged; the application-only promotion preserved Caddy and its live configuration. This does not repair the missing certificate files. Restoring their configured paths remains necessary before restarting Caddy or using its standard deployment preflight.

Artifacts:

- `runtime/mouse-guard-final-production-gate/report.json`: full automated matrix.
- `runtime/mouse-guard-production-deployment/source-manifest.json`: source and binary provenance.
- `runtime/mouse-guard-production-deployment/report.json`: promotion and identity comparison.
- `runtime/mouse-guard-production-deployment/before/report.json`: production UI baseline.
- `runtime/mouse-guard-production-deployment/after/report.json`: production reload smoke.
- `runtime/mouse-guard-production-deployment/webterm.previous`: previous binary.
- `runtime/mouse-guard-production-deployment/webterm.before.db`: SQLite backup; do not restore over newer user data as part of routine binary rollback.
- `runtime/production/webterm.previous` and `previous.version`: standard rollback artifacts updated to the actual previous production version.
- `runtime/promote-mouse-guard.mjs`: exact-candidate promotion procedure, including rollback.

The standard rollback script also requires the missing TLS files; it should not be advertised as directly runnable until that prerequisite is restored.
