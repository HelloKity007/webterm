# Terminal resilience following the production tmux crash

User approved the proposed resilience work on September 27. Production remains
unchanged until approval of a concrete tested candidate, per AGENTS.md.

Confirmed incident: production tmux 3.5a PID 1200933 segfaulted, with all original
pane PIDs gone. Persistent sockets do not checkpoint processes. Exact crash
trigger is still unknown; upgrading alone is not a proven fix.

## Implementation and acceptance

- Isolate newly created terminal IDs into distinct tmux servers on durable,
  environment-scoped absolute sockets. Browser peers for one ID share its server.
  Existing registry endpoints and their pinned legacy client remain valid.
- Route create, attach, capture, history, actions, diagnostics and close through
  the registered endpoint. Never derive an attachment from current Panel position.
- Expose an authenticated, authorized per-terminal health probe. Public HTTP
  health explicitly reports application liveness only. Missing socket/server,
  absent session, mismatched identity and inconclusive transport errors differ.
- Confirmed terminal faults halt browser retry and drop queued input. Explicit
  retry probes the original identity. Explicit creation uses a new ID/socket;
  it cannot recover original process memory or replay a prior draft.
- Emit structured fault events without screen data or credentials. Provide a
  read-only collection script and opt-in isolated-client wrapper enabling bounded
  core collection in private per-server directories with pinned binary metadata.
- Keep durable layouts/registry intact. Application conversation resume is a
  manual recovery step after new terminal creation, not an automatic shell action.

Verification: real isolated process-loss injection, unchanged peer PID/session/
incarnation, real browser faults/retry/reload/new creation, core artifact presence,
Go race/vet, UI tests/lint/build, and the existing three-phase dynamic visual gate.
Preserve failures and distinguish harness corrections from product changes.

No production restoration, registry relabeling, automatic restart, or automatic
application resume is part of this test deployment. Prepare the production
configuration and rollback procedure after the test evidence is complete.
