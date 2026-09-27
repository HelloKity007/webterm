# Automatic protection against stale CLI mouse tracking

## Behavior

After a CLI/SSH/container disconnect leaves the outer pane at a known ordinary shell, the next complete SGR mouse report is checked inside tmux's command queue before forwarding. Known shells cause the report to be dropped and a nonce-bound, framed response to be emitted. WebTerm converts that response into mouse-disable output for that browser. Live applications and ambiguous commands such as ssh/docker continue receiving their original report bytes. No prompt-text heuristics or periodic SSH probes are used.

A reconnect snapshot also disables mouse tracking for a known shell even if tmux still retains a crashed application's flags. The server-side flags are not mutated, and no reset command, newline, Ctrl+C, draft clearing, terminal resize or alternate-buffer switch is injected. Each attached client independently receives protection. A new CLI's DECSET output enables its mouse support normally.

The final candidate also prewarms a private SSH transport after identity verification for an initial pane-state read and output-triggered reads, coalesced with a 75 ms delay. A known shell with stale mouse flags receives mouse-disable output without waiting for another mouse event. A non-shell with mouse flags can trigger one bounded 350 ms follow-up sample; there is no recurring idle polling. Unknown nested SSH/docker foreground commands are not force-reset. If the probe transport fails, the guarded mouse-input path and reconnect snapshot remain available.

Ordinary keyboard data follows the existing send-keys path unchanged. Matching is restricted to complete SGR reports, optionally batched, as emitted by current xterm and the application mouse handlers. Printable report-like text, cursor keys, UTF-8 and bracketed paste are not filtered. This is not a generic arbitrary-byte-stream mouse decoder; fragmented nonstandard input and terminal protocols other than SGR are outside this change. Nested SSH/docker sessions cannot be classified as a shell from the outer process name, so unknown processes are not force-reset.

The process decision and forwarding are adjacent tmux commands with no intervening SSH round trip. This avoids reliance on old browser state; it is not a claim that process exit and input delivery can be globally atomic at the OS level.

## Validation

- PASS: handler and SSH manager test suites.
- PASS: real isolated tmux 3.5a and 3.7c fixture: a Python foreground application enables tracking, receives the exact SGR report, and exits without cleanup. Subsequent mouse input is rejected at Bash while an unsubmitted Chinese command remains intact and executes only on the test's explicit Enter.
- PASS: keyboard, Enter, Ctrl+C, arrows, UTF-8, printable report-like text and bracketed paste retain original bytes; mouse reports alone use the conditional path.
- PASS: framed acknowledgement requires the exact nonce marker and completed matching response; output notifications, wrong markers, mismatched frames and errors do not trigger cleanup.
- PASS: real Chromium/xterm before and after reload: mouse tracking changes from `any` to `none`, mouse movement/wheel stop generating input, displayed Chinese draft and cursor are unchanged, Chinese keyboard input and left arrow remain correct, and a later CLI can re-enable mouse reports.
- PASS: shell reconnect snapshot suppresses stale flags; live Claude snapshot retains mouse modes.
- Evidence: `runtime/mouse-guard-qa/results.json` from `WEBTERM_QA_MOUSE_BROWSER=1`; fixture source in `handler/terminal_mouse_guard_test.go` and browser driver in `scripts/verify-mouse-guard.mjs`.

## Release status

The final candidate `e9867b7-mouse-guard-final` was deployed to test and then production with explicit user approval. The full 33-case automated dynamic visual matrix passed before promotion, followed by production browser smoke checks and unchanged identities/PIDs for all 32 local tmux panes. See [production deployment evidence](2026-09-26-mouse-guard-production.md) for exact scope, binary hash, artifacts and rollback limitations. Actual destructive Docker/tmux restart testing and physical Windows/Android checks were not performed in that deployment; synthetic CLI-exit fixtures are not equivalent coverage. The earlier operational mitigation remains recorded in `2026-09-26-claude-disconnect.md`.
