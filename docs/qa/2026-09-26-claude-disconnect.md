# Claude disconnect and stale mouse protocol

## Evidence

After the user's report of Claude tabs returning to Bash and printing `35;...M` / `64;...M`, read-only Docker inspection found four cloudproxy containers stopped at 2026-09-27 06:29:49 UTC and started at 06:30:49 UTC (local September 26 21:29:49–21:30:49). Docker journal contains contemporaneous `/tmp/runc-process...: no space left on device`, FIFO closure, container task deletion, and subsequent network reattachment. The logs establish container stop/start and temporary-storage exhaustion; they do not establish who requested those container stops.

These events preceded the tmux endpoint recovery and migration. Retaining a tmux session/pane PID does not retain an inner SSH connection or Claude process across container restarts. Earlier 30/30 checks established terminal transport/identity readiness, not Claude application conversation continuity.

Nine Bash panes had stale all-motion mouse tracking and SGR encoding enabled: %40, %47, %39, %5, %4, %11, %8, %28, %29. The reported character patterns are consistent with SGR mouse reports entering readline after the consuming CLI disconnected. Other panes still running Claude retained their intended mouse modes.

## Applied operational mitigation

For each affected pane, checked that the foreground process group belonged to its existing Bash and wrote only mouse-mode-disable escape sequences to its PTY slave output. No keyboard input, Enter, Ctrl+C, buffer clearing or process termination was injected. All nine then reported mouse_any_flag=0 and mouse_sgr_flag=0; active Claude panes remained unchanged. Raw before-action verification is recorded in `runtime/claude-disconnect-2026-09-26/mouse-reset.json`.

This stops subsequent unwanted mouse reporting but does not erase the already typed garbage or restore killed Claude processes. The live application has not been updated with an automatic mode-cleanup fix.

## Conversation storage

Two affected containers' host-mounted `.claude/projects` directories contain JSONL records (one directory with 1 file, another with 60, including possible subagent records). This proves some persisted conversation data exists, not a one-to-one recovery mapping for all former tabs. The two other restarted containers have no `.claude/projects` directory at the checked common paths. Do not fabricate a recovered conversation or auto-resume an arbitrary most-recent ID across several tabs.

No Docker restart, Claude launch/resume, application deployment, or commit/push performed for this incident.
