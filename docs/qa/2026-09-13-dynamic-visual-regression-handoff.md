# Dynamic terminal regression — NOT ACCEPTED

> Superseded incident diagnosis: kernel journal confirms tmux 3.5a server
> segmentation faults at both recreation times. See
> [isolated dependency mitigation](2026-09-13-tmux-control-crash.md).
> Current deployed implementation is `570df98`; the historical results below
> are not current-candidate PASS evidence. Claude recovery remains pending.

Current test candidate: `500892360d517e8ae3a1e9fdfd2bf62029a0b6b5` on 9444. Production read-only health remains `2df868a6df91c99365116b47a683df240b617b6e`. No production deployment.

## Implemented / evidence

- Baseline switch test FAILED: selecting another tab destroyed the previous terminal element. `runtime/terminal-switch-baseline/`.
- `b3b0384`: retain visited terminals while hidden; layout restore updates pane state instead of changing React keys. Switch test passes 1920→3440→1920→3440, five A/B/A revisits each. `runtime/terminal-switch-stability/`.
- Desktop requests measured geometry on actual viewport change, renders server-confirmed grid; `5008923` limits compact requests to avoid a wide two-column panel inflating the four-column display's grid. UI 118 tests, lint/build and Go tests passed.
- `e2515d9`: control connection close writes detach + EOF and waits up to 500ms before closing SSH. Needs additional persistent-session lifecycle verification before acceptance.
- Mandatory every-version dynamic visual matrix added to AGENTS.md, main spec and `docs/qa/terminal-visual-release-checklist.md`.
- Two-display run (1920 + 3440 simultaneously) recorded repeated local/remote tab selection, reorder/restore, page/history scrolling and videos. 10,886 / 16,560 samples show no font change for the same sampled terminal/grid/surface dimensions. This does NOT prove absence of blank canvas pixels. `runtime/terminal-two-display/`. The script's final fill assertions and Claude preflight were added after this run and have NOT been executed.

## Incident / stop condition

Read-only process inspection found 128 orphan test tmux control clients (PPID 1), still participating in window-size largest. Cleanup matched the exact test socket, command, PID and tmux client name, issued detach and SIGTERM to these client processes. Later read-only audit found zero remaining orphan clients. Session names were unchanged immediately after cleanup, but that check was insufficient.

Subsequent inspection discovered that test sessions were recreated around epoch 1789291951 (2026-09-13 09:32:31 UTC), with a new tmux server PID 3684038, and Panel 6 now runs Bash rather than Claude. Original session/history preservation therefore cannot be claimed. The relation to cleanup/deploy remains unconfirmed; investigate before re-enabling cleanup. The cleanup script now refuses `--apply` and is read-only only.

The browser run continued long enough to capture raw mouse-looking text (`35;77;18M`) in Panel 6 after its process changed to Bash. Do not count this as Claude validation. No test intentionally submitted a shell command or CLI prompt. New script preflight now requires a running Claude process before exercising that scenario. Current test session content should not be overwritten or cleared to hide the incident.

## Remaining required work

1. Investigate the tmux server/session recreation and verify reconnect/deploy/cleanup preserve actual session IDs, pane PIDs, creation timestamps and history—not merely names. Do not run cleanup again.
2. Confirm with user which original Claude session to resume in test Panel 6; do not silently choose a new conversation or claim history recovered.
3. Investigate stale announced grids: some browser samples still show 152×32 / 104×32 while current active control requests are capped/92 columns. Review capture/replay ordering and stored grid OSC metadata. Large samples still show substantial whitespace; fill gate is FAIL, not PASS.
4. Repeat the full mandatory matrix, including Claude continuous input, Bash repeat input, cross-pane move (not just within-bar reorder), actual display/DPR, new fill assertions, mobile and pixel/video inspection. No full visual acceptance yet.

No push performed. Main repository only, no worktree. Latest implementation is test-only and must not be promoted.
