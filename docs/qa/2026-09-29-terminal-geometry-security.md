# Geometry control security review

Scope: the new authenticated WebSocket size-takeover action and geometry lease; source review on 2026-09-29. No critical/high findings identified in this scope. This is not an audit of the pre-existing dirty worktree.

## Reviewed boundaries

- Spoofing/access control: `handler/ws_ticket.go` binds the single-use ticket to endpoint, connection, terminal and client ID and validates Origin before upgrade. `handler/ws.go:HandleSSH` rechecks authenticated connection access and the durable terminal identity before registering geometry. The geometry registry uses `terminalKeyFor(userID, connectionID, terminalID)`, so another user's client ID cannot take this lease.
- Tampering/injection: `pumpTerminalInputWithErrors` accepts integer columns/rows within protocol bounds. `tmuxControlTerminalSession.WindowChange` only formats those integers into fixed tmux commands. Takeover reuses the connection's validated dimensions, not an arbitrary shell command or target supplied by the browser.
- Disclosure: takeover sends no screen data, credentials or filesystem paths. No new public endpoint is added.
- Denial of service: per-terminal locking prevents simultaneous resize writes, and duplicate dimensions are suppressed. Existing message bounds and WebSocket connection controls remain in force. An authorized input-sharing peer can still intentionally alternate sizes; this is the same trust boundary as shared keyboard input.
- Privilege: taking size control does not change terminal identity, process ownership, SSH credentials or input permissions. It cannot create/resume/replace a process.
- Repudiation: control ownership is ephemeral, like presence. No claim of a durable per-person audit trail is made for the existing same-account model.

## Low-priority limitation

Registry entries retain small terminal-key metadata for the handler lifetime, matching the existing terminal lifecycle registry. Released clients and their writer closures are removed. A broader terminal-registry eviction policy remains outside this focused change; no untrusted free-form key is inserted before durable instance validation.

## Out of scope

Follow-up automatic-fit review: the r8 frontend invokes the same authenticated takeover action on foreground activation/local geometry changes; no backend permission or protocol expansion. Remote layout notifications do not themselves trigger takeover. Unchanged geometry/activation is deduplicated, and disposed terminals remove listeners. No new high/critical finding identified in this focused follow-up.

Existing session-isolation changes, other HTTP endpoints, external CLI internals, and production configuration. Production 9443 is not part of this deployment.
