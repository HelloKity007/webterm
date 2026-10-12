# Session auto-recovery: in-place terminal replacement

Status: production-verified by the user on 9443, release `b8ebccf`.

## Behavior

When a persisted terminal panel cannot reattach — the tmux server is gone
(`TERMINAL_SERVER_UNAVAILABLE`), the session no longer exists
(`TERMINAL_SESSION_MISSING`), or in release-test a snapshot-derived identity
cannot match the private test tmux server (`TERMINAL_IDENTITY_MISMATCH` /
`TERMINAL_IDENTITY_UNAVAILABLE`) — the frontend now resolves it without the
manual identity-guard dialog:

1. Automatic retries of the original session (1s/2s/3s) via the existing
   identity-revision reconnect primitive.
2. On confirmed loss, a single `POST /api/terminal-sessions/{conn_id}`
   creates a replacement terminal.
3. The replacement swaps the old tab **in place**: same position, order,
   title, panel number and layout; the old persistent xterm root is
   discarded; no extra tab appears.

Production keeps the fail-closed guard for identity mismatches; only
release-test auto-replaces snapshot identities, since its database is
copied from production and can never legitimately own those sessions.

## Boundaries preserved

- Attach never implicitly creates a tmux session; creation stays behind the
  authenticated REST endpoint.
- A replacement failure surfaces a lightweight terminal message
  (`term_recovery_failed`), not a modal choice.
- `createSafeTabInCurrentPane` (explicit "new independent terminal") keeps
  its append semantics.

## Verification

- Playwright run against 9444: killed the release-test tmux server for a
  live panel → automatic replacement observed exactly once
  (`replacementPosts: 1`), no identity-guard overlay, panel count and
  layout unchanged (`/tmp/webterm-release-recovery-test.mjs` flow, logged
  in the session transcript).
- Snapshot-layout verification: opening the 8-panel release-test layout
  with stale production identities auto-replaced all 8 panels;
  `终端会话未通过身份校验` count 0, panel count 8.
- Frontend suites: 51 files / 229 tests green; `go test ./...` green.
