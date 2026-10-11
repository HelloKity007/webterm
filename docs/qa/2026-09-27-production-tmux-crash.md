# Production terminal loss — 2026-09-27

Read-only production investigation; no restart, signals, terminal input, registry changes or replacement sessions.

## Confirmed cause

At 2026-09-27 09:04:47 UTC−09:00 (18:04:47 UTC), production tmux 3.5a server PID 1200933 segfaulted. Kernel journal:

```
tmux: server[1200933]: segfault at 20 ip 000055b9356afb82 sp 00007ffd50c8e460 error 4 in tmux[41b82,55b93568b000+a1000]
```

At 09:04:48 WebTerm logged two `SSH resize failed: EOF` events. The systemd user journal records tmux-spawn scopes ending at 09:04:48–49.

## Current state

- Production HTTP health succeeds: version `e9867b7-mouse-guard-final`; application PID 1202246 started September 26 23:47:33.
- Original tmux server PID 1200933 is absent. No production tmux listener is present in `ss -xlpn`.
- Persistent socket `/home/pgz/.local/state/webterm/tmux/default` still exists, with September 26 21:51 modification time. Pinned wrapper query reports `no server running`.
- All 31 original pane PIDs recorded in `runtime/migration-2026-09-26/sessions.after` are absent, including the unrelated auto-agent pane. That inventory contained 30 verified layout terminals and auto-agent.
- Database still contains 31 active production registry records. These records preserve identity but do not preserve live process memory. One active record was already missing before this incident, per the previous migration report.
- The UI identity guard prevents attaching replacement shells to the old identities. Its generic message does not distinguish a missing server from identity mismatch.

## Interpretation and limits

This is a confirmed tmux process crash, unlike the September 26 socket removal incident. Durable socket placement cannot preserve sessions when the server and shells exit. Restoring a socket or refreshing the browser cannot recover these original live processes.

The exact trigger of the segmentation fault remains unknown. No tmux core was found in standard crash-store locations; core_pattern is the relative filename `core`, so a core elsewhere has not been ruled out. The installed tmux binary is stripped. No claim is made that a particular WebTerm command or tmux defect caused the crash, or that a version upgrade is a verified fix.

Follow-up: investigate a core/debug symbols or isolated reproduction; validate a replacement server/client pair in 9444 before proposing production changes. Recreating terminals requires new identities and must not be presented as recovery of the original sessions. CLI conversation files may permit application-level resume, which has not been checked here.
