# Automatic terminal fit evidence

Candidate: `geometry-20260929-r8-auto`, test URL `https://192.168.11.87:9444`, binary SHA-256 `197d195253a31d675486a7b53ec30359bebeb1dc60c464aee3482999d61beee0`. Built from the existing dirty checkout; unrelated edits retained.

## Behavior

Follow-up limitation found after this gate: native Ctrl+Shift+R with **no** post-navigation tab click or input could leave Claude's actual composer narrower than the correctly sized canvas. The r8 matrix did not catch this snapshot/live-output race; its PASS results apply only to the recorded scenarios, not this newly reproduced contract. The failing native trace is retained in `runtime/geometry-20260929/claude-idle-r8-native/`. See the r9 idle-hard-reload correction for the root cause and independent replacement evidence.

Desktop sessions automatically request their measured local capacity and take size control when connected in a visible foreground window, when that window receives focus, when a terminal/tab is activated, or when local capacity changes. Hidden/background panes keep their local font and remain mirrors. Remote grid announcements invalidate remembered local control but never themselves cause a takeover; subsequent user activation can take control again. Repeated unchanged capacity and keyboard activation are deduplicated. The server still serializes changes per authenticated terminal and preserves reload grace.

The persistent Fit button is removed. The existing context-menu fallback remains optional. Bash keeps the unified history rail, and all clients still parse the exact shared PTY grid. Simultaneously active clients share one grid; the latest foreground activation/local resize selects the controlling viewport. Local fonts stay independent.

## Verification

| Check | Status / evidence |
| --- | --- |
| UI unit suite | PASS: 50 files, 218 tests; `runtime/geometry-20260929/auto-ui-tests.log` |
| ESLint, TypeScript/Vite build | PASS; existing bundle-size advisory remains |
| Go regression | PASS; `runtime/geometry-20260929/auto-go-tests.log`; backend code unchanged |
| Automatic opening/focus/resize/mirror test | PASS: 3 terminal types × fresh/normal/hard = 9 records, each with 3 focus cycles, no Fit button, background resize, foreground recovery and passive-mirror stability; `runtime/geometry-20260929/auto-r8-real-focus2/results.json` |
| Complete candidate dynamic matrix | PASS: 33 final cases across fresh/normal/hard; `auto-full-r8/`, `auto-full-r8-fresh-rest/`, `auto-full-r8-reloads/` under `runtime/geometry-20260929/` |
| Dedicated geometry/dual-reload matrix | PASS: 39 records, including 12 dual-peer reload combinations, zero browser page errors; `runtime/geometry-20260929/auto-geometry-r8-passive/results.json` |
| Combined acceptance | PASS; `runtime/geometry-20260929/automatic-acceptance.json`; all 33 final case results, 9 automatic-fit records, 39 geometry records and reload font invariance validated by `scripts/summarize-automatic-terminal-fit-gate.mjs` |
| Physical phones/displays | NOT RUN; automated phone emulation is reported separately |

## Harness evidence

The first automatic-fit runs failed because Playwright's Chromium driver enables `Emulation.setFocusEmulationEnabled` for every page, making even inactive windows return `document.hasFocus() === true`. This is confirmed in the installed driver source (`ui/node_modules/playwright-core/lib/coreBundle.js`). An initial correction before navigation was overwritten by the navigation initialization. The final automatic-fit harness disables the override after every load/reload, uses headed Chrome under Xvfb, and asserts that foreground and background pages actually have opposite focus states. Original failures and diagnostic screenshots remain under `auto-r8/`, `auto-r8-diagnostic/` and `auto-r8-real-focus/`. The product code did not change between these attempts and the passing automatic-fit run.

Final automatic-fit screenshots were visually inspected: Claude's composer/status line remains visible, 16px font is retained, and the persistent Fit button is absent. Startup can still briefly reflow while font metrics and attachment settle; automatic adaptation does not claim immediate input readiness before attachment.

Final large-display controller measurements at 3440×1440: Codex 93×34 cells with 3px right / 6px bottom remainder; Claude and Bash 93×31 cells with 3px right / 11px bottom remainder. These are split-panel capacities, not the whole browser width. Local font remains 16px through peer activation, resize and both reload types. The headed 1920×1080 and 2860×988 peers use their own measured scrollbar/cell budgets; no fixed column assumption is imposed. Final health/version, binary SHA-256 and `git diff --check` were verified after acceptance.

The first fresh Claude-repeat attempt captured an incomplete composer boundary during automatic resize redraw and stopped before typing (`auto-full-r8/fresh/verify-claude-repeat/runner.log`). Its readiness check now also requires the shared grid to match measured local capacity, then waits for the CLI composer and cursor boundary before recording the baseline. The exact 160-character input and draft-restoration assertions remain unchanged. All failed attempts are retained.

The first dedicated dual-reload attempt (`auto-geometry-r8/results.json`) timed out while expecting an inactive mirror to keep the controller grid, after the probe clicked the mirror's tab following reload. Tab activation is now intentionally an automatic-fit gesture. The final probe reads the restored active tab without a click and explicitly asserts that the mirror has no focus and the controller has focus before checking grid invariance. Foreground activation/fill tests remain separate and unchanged. The failed attempt is retained.

Deployment used the existing test-only validated launcher and preserved test terminal processes and database. Production 9443 was not modified. No commits were made over unrelated worktree edits.
