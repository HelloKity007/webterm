# Persistent tmux socket: incident and candidate evidence

## Incident

User confirmed manual forced cleanup of full `/tmp` on September 26. Read-only production inspection found 31 active registry entries using `default`, an original tmux server PID 1200933 running since September 17 with 31 Bash children, and a recreated `/tmp/tmux-1000` directory/socket on September 26. The current default socket failed connection. This supports loss of the communication endpoint rather than termination of all shells; individual session identity/content remains unverified until reconnecting to the original server.

## Candidate implementation

`-tmux-socket` now accepts a shell-safe absolute remote path as well as legacy names. Absolute paths use `-S` consistently for control attachment, creation, capture, history and close. The registry retains the complete path as identity authority. Production and test socket basenames remain environment-scoped. Launcher validation accepts these paths. Existing defaults are retained solely for compatibility with live registries; deploying this code alone does not migrate them.

Target example: `/home/pgz/.local/state/webterm/webterm-production-main`; test uses a distinct `webterm-release-test-main` basename. Provision the parent on each SSH target as that SSH user with mode 0700; do not place it in `/tmp`, `/var/tmp`, or a temporary runtime directory. Absolute paths are resolved on the SSH target, not the WebTerm host. The candidate does not auto-create directories during attachment or invent replacement sessions.

## Recovery and migration boundary

Production modification requires the current user's explicit approval under AGENTS.md. No production process was signalled, restarted, moved, or reconfigured in this task.

Before migration, recover the original server endpoint using tmux's documented SIGUSR1 mechanism after checking its PID, owner, socket path, and any conflicting socket occupant. Enumerate original session names and incarnation markers and compare all 31 registry records. Back up the registry/layout. Never change terminal IDs or stamp new markers onto replacement shells.

Changing the launch flag alone is unsafe: old registry socket fields deliberately reject a different endpoint. A live endpoint relocation must preserve the same server, pane PIDs, session IDs and incarnation markers, and coordinate registry socket updates with the WebTerm configuration. This migration has not been executed or validated in production. Recovery at the old endpoint and migration to the durable endpoint are separate operations.

Durable socket placement protects against temporary-directory cleanup, not host reboot or termination of tmux processes. Process memory is not a disk checkpoint.

## Validation

- PASS: `go test . ./handler ./scripts`.
- PASS: real isolated tmux 3.7c test using a socket under the user's home; remove the fixture's entire `TMUX_TMPDIR`, then verify unchanged server PID, pane PID and session ID and successful reconnect/query.
- PASS: existing real tmux identity guard match, replacement and missing-session cases.
- PASS: launcher shell syntax validation.
- NOT RUN: 9444 browser dynamic visual matrix, refresh matrix, SSH/Claude scrolling, dual-screen and mobile release acceptance. This is not a release-approved candidate.
- NOT RUN: production recovery/migration and verification of original per-session contents.

## Authorized production recovery (subsequent user instruction)

User explicitly authorized modifying 9443 to recover all sessions. Rechecked original PID 1200933, executable `/usr/bin/tmux`, process start identity and all 31 original Bash children. The filesystem socket refused connections while the original server retained its listener. Sent SIGUSR1 only to that verified original tmux server; its socket became accessible. No application restart, binary deployment, database mutation, shell input or new session creation was performed.

Results:
- 30/30 terminal tabs in the existing admin (user 1) saved layout match original live canonical names and incarnation markers.
- 30/30 passed real control-mode attach readiness-marker and session-change handshakes; test clients detached without shell input.
- All 31 pre-recovery Bash child PIDs remained alive.
- HTTPS 9443 returned HTTP 200.
- The 31st active registry record (`wt01-02-16-3842d24f9fea88fe`) has no live matching session and is absent from the current admin layout. It was not recreated or marked recovered. The unrelated `auto-agent` session was left unchanged. A stale layout for deleted user 7 also has no registry; it is not part of the admin's 30 terminals.
- Browser rendering was not directly checked. Refreshing an existing error screen should initiate a new attach.
- Durable socket migration has not been applied; production still uses the recovered default socket.

Evidence: `runtime/recovery-2026-09-26/{before,after,handshakes,layout-verification}.json`. The initial `after.json` compares all 31 active database records, whereas layout verification establishes the current admin workspace's 30/30 result.

## Authorized live migration: completed

User subsequently authorized migration. Production remains on existing WebTerm binary `d0e584acbe8dc0c9637b2e942cda7040eed4931c`; the candidate Go changes above were not deployed. The existing binary's scoped binary/socket overrides use an installed copy of `scripts/tmux-durable-client.sh`:

- Physical socket: `/home/pgz/.local/state/webterm/tmux/default` on DATA-A ext4, private parent directory 0700.
- Client launcher: `/home/pgz/.local/state/webterm/bin/tmux-production`.
- Pinned client: `/home/pgz/.local/state/webterm/bin/tmux-3.5a`, matching original running server PID 1200933.
- Registry namespace: `webterm-production-durable`; all 48 rows for this production endpoint mapped without modifying IDs, incarnation markers or states.
- `lan-secrets.env` persists the binary, namespace and explicit 3.5a version pin. Launcher validation retains 3.7c as the default but permits this exact legacy durable namespace to pin the original 3.5a client.

The original `/tmp` parent was temporarily replaced by a symlink to the persistent directory while signalling only the original server with SIGUSR1. The original `/tmp` directory was then restored; its `default` entry is now only a compatibility symlink for old shells' TMUX environment. WebTerm's wrapper directly addresses the disk-backed socket with `-S`; it does not traverse `/tmp`. Other tmux socket entries were preserved. This was first tested with an isolated server, including deleting its temporary paths and checking unchanged PID/pane/session identity.

Initial 3.7c-client testing exposed an actual compatibility issue: simple commands against the old 3.5a server succeeded but control mode hung. Production verification initially failed. Replacing the wrapper's client with an exact copy of the original 3.5a executable and restarting WebTerm's transport pool resolved it. Do not change the pinned client independently of the running server.

Final evidence:
- PASS: 30/30 current admin layout terminals via production HTTPS 9443, authenticated ticket, actual WebSocket, SSH execution, identity gate and post-gate `terminal_mode` response. No shell input sent.
- PASS: all 31 original live panes have identical server PID, session ID, pane ID, pane PID, names and incarnation markers before/after migration (includes unrelated auto-agent).
- PASS: launch validation and script regression tests, including the exact legacy client pin.
- No new app build, terminal process restart, shell replacement, or layout changes.
- Full browser visual matrix NOT RUN; this was an operational socket migration using the existing app binary.

Backups/evidence: `runtime/migration-2026-09-26/` contains SQLite backup, protected launcher-environment backup, before/after identity inventory and `production-websocket-verification.json` (30 PASS). `verify-production.py` uses an in-memory short-lived operator token and does not persist or print credentials or terminal screen contents.

Operational caveats:
- The live tmux server internally still remembers the original socket pathname. Do not blindly send it SIGUSR1 again: use the same parent-redirection procedure if a future explicit rebind is required. Normal connections and new clients use the persistent pathname; future servers launched by the wrapper bind directly there.
- Host reboot still ends running processes; a durable socket is not a process checkpoint.
- An existing unrelated deployment defect was observed: TLS certificate/key paths in the launcher environment no longer exist. Caddy remains running with its loaded certificate, so HTTPS verification passed. WebTerm was started separately without restarting Caddy. Restore TLS files before a future full Caddy restart; this migration did not create or modify that defect.

## User acceptance

After production migration and the 30/30 WebSocket verification, the user confirmed `ok, pass, commit push`. This records user acceptance and authorization to commit/push this work; it does not replace the explicitly NOT RUN browser visual matrix above.
