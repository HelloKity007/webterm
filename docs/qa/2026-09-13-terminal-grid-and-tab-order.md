# Terminal grid and panel tab order — 2026-09-13

Candidate: `416e28f0f029364f4d559e1c1660adc522440268`, branch `dev-1.0.4`, test HTTPS 9444 only. Production health remains `2df868a6df91c99365116b47a683df240b617b6e`; no production deployment.

## Baseline failures and changes

- Small-screen CLI viewport re-entry previously painted multiple font-search candidates: sampled screen sizes 936×672, 624×416, 728×544, 624×480, 728×512. Offscreen font measurement now applies only the final size; unchanged geometry skips fitting.
- Bash browser/server grids differed (browser 102 columns versus tmux 152), making readline cursor addressing inconsistent with local wrapping. Desktop shells now accept the exact server grid, and tmux layout-change emits an ordered grid announcement before output redraws. Mobile rendering paths are unchanged.
- Same-pane tab headers now accept native mouse drag before/after another tab, or into the trailing spacer. Reordering retains object/session identity, stable numeric labels and active selection. Existing cross-pane drop handling remains; cross-pane movement was not exercised in this run. Touch scrolling remains enabled; touch long-press reorder is not implemented.

## Executed checks

- UI: 115 tests / 30 files pass; lint, frontend build and `go test ./...` pass. Existing bundle-size warning remains.
- `verify-panel-tab-order.mjs`: headed Chrome on test, drag first tab after second, assert reordered IDs and unchanged active ID; restore and assert original order. Screenshot/result: `runtime/panel-tab-order-qa/`. Reload persistence and cross-client ordering not independently tested.
- `diagnose-terminal-grid.mjs`: 1920×1080, three page-scroll re-entries / 270 animation frames; one stable 624×480 screen size. `runtime/terminal-grid-fixed/frames.json`.
- `verify-claude-composer.mjs`: 1920×1080, 2860×988, 3440×1440; correct compact/large layouts, toolbar/files/titlebar checks, CLI history up/down and exact grid stability, no overflow or page errors. Screenshots inspected: complete composer/statusline on small screen. `runtime/terminal-grid-composer/`.
- `verify-shell-repeat.mjs`: real test Panel 2 via headed browser, 240 repeated `z` keydowns on each of 1920 and 3440 widths; server suffix intact and browser/server both 152 columns. No Enter or command execution. Delete only own suffix and assert complete original prompt/draft unchanged. `runtime/shell-repeat-qa/`. First script attempt compared the entire visible capture and failed because concurrent browser resize changed leading history; corrected the test to compare the full joined prompt/draft, not unrelated viewport history. This is not a pixel-by-pixel proof of every intermediate keypress frame.
- `verify-mobile.mjs`: eight smoke checks pass, including 12px font consistency, native touch scrolling/offscreen tab selection and three simulated keyboard restore cycles. `runtime/terminal-grid-mobile/`.
- OpenCLI opened the current test build in the user browser and saved `runtime/terminal-grid-fixed/opencli-current.png`. Browser-use was not available/run; no claim of combined OpenCLI + browser-use acceptance.

## Limits / handoff

Listed regressions pass, not full product or physical-device acceptance. Natural aspect-ratio whitespace remains (1920 CLI right gap 300px in the sampled 104×32 shared grid); exact ANSI coordinates take precedence over stretching or locally dropping columns. Physical held-key timing, Android/iOS keyboards, touch long-press reorder, full accessibility and full visual-baseline comparison remain unverified. User should recheck actual small-screen scroll/held-key experience and mouse tab ordering on 9444. No production authorization inferred.
