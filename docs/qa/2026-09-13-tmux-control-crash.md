# Test control-server crash: delivery remains blocked

Latest deployment and partial matrix results:
[e499268 delivery status](2026-09-13-e499268-delivery-status.md).

## Evidence

Kernel journal records tmux server SIGSEGV at address 0x20 on 2026-09-13
00:32:31 and 03:34:16. The second crash happened without executing the disabled
cleanup helper. System executable is tmux 3.5a. This establishes server crash,
not intentional session deletion; without a core dump the exact failing stack
is not proven. Panel 6's Claude process was lost and must not be reported as
still running or silently replaced with Bash for acceptance.

Upstream fixes match the control-client churn failure family:

- https://github.com/tmux/tmux/commit/e5a2a25f guards uninitialized control state.
- https://github.com/tmux/tmux/commit/31c93c48 guards partially initialized clients.
- Pinned stable release: https://github.com/tmux/tmux/releases/tag/3.7c
- Tag commit: e476c1230b958df0cb12977517d24b3dc931375b.
- Release tar SHA256: 7c60cae9a0e25288e2e24750aafc9e8800fc7fd4555e447e1b29ee4201cfb3bf.

## Isolated mitigation

`bash scripts/build-test-tmux.sh` installs only `runtime/tmux-fixed/bin/tmux`.
Test launcher uses the absolute executable on the SSH target and private socket
`webterm-release-test-fixed`. Both current test connections point to this host;
any future remote target needs the pinned executable installed at that path.
An absent executable fails preflight, never falls back silently to vulnerable tmux.
Old test socket `webterm-release-test` is retained; sessions cannot be live-migrated
between tmux servers. Production binary, socket and port 9443 remain unchanged.
Overrides are rejected outside release-test. The system tmux is not replaced.

## Verification status

- PASS: isolated 400-client attach/detach/early-disconnect stress; server/pane/session
  identity unchanged. Evidence `runtime/tmux-control-churn/results.json`.
- PASS: Go tests after binary scoping and remote version preflight changes.
- NOT RUN: full visual matrix on the new deployment. Prior partial results on
  83f785b do not establish acceptance for a new candidate.
- BLOCKED: Claude fixture recovery decision pending user response. Do not execute
  a guessed conversation, user draft or destructive cleanup.

Production still carries its existing tmux dependency; this test-only change does
not claim to fix production's dependency risk or authorize production deployment.
