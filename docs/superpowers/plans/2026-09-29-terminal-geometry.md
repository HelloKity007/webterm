# Terminal geometry implementation plan

**Goal:** One desktop scroll coordinate, local font preference, measured terminal capacity, and stable server-enforced ownership of shared PTY dimensions.

**Architecture:** Keep one remote PTY and parse its exact grid. Measure each desktop independently without shrinking text to fit peer dimensions. A single native scroll surface maps normal-buffer history and live-frame overflow; a per-terminal server lease serializes explicit tmux window resizes and survives browser reloads for 15 seconds. Other clients can explicitly take size control.

**Tech Stack:** React/TypeScript, xterm 6, Go, tmux control mode, Vitest, Playwright.

**Spec:** `.agents/results/architecture/architecture-review-terminal-geometry.md`, approved by user on 2026-09-29.

## Constraints

- Work in the main checkout; preserve pre-existing edits and terminal identities/drafts.
- Only test environment 9444 may be deployed. Production 9443 remains untouched.
- Fonts belong to local preference. Shared mirrors may scroll when grid and viewport differ; no silent font shrink or stretched spacing.
- No automatic application launch/resume or execution of user drafts.
- Execute inline; referenced superpowers execution tools are not installed. User already requested implementation, so no additional execution-choice gate.

## Tasks

- [x] Geometry: replace empirical desktop caps with actual measured capacity. `terminalScaling.ts`, `localViewport.ts`, `ThemedTerminal.tsx`; test capacities above 104 columns and font invariance across peers and viewport sizes. Run `npm test -- desktopRequestedGrid localViewport` before and after implementation.
- [x] Scroll: add `desktopTerminalViewport.ts` and pure coordinate tests. Map position `s` to `viewportY=min(baseY,floor(s/cellHeight))` plus live-frame offset; total extent `(baseY+rows)*cellHeight`. Route wheels, drag and input reveal through that model. Remove internal scrollbar positioning and outer-scroll anchor fighting. Browser-test a terminal with more live rows than visible rows and at least five screens of normal history.
- [x] Coordination: add `terminal_geometry.go` with per-terminal lease, stable client ID, duplicate-connection safety, 15-second reconnect grace, explicit takeover and serialized resize. Test peer joins/leaves, reconnect, expiry, failed writes and separate terminal keys. Wire through `ws.go` and `tmux_control.go`; use explicit `resize-window` with manual window-size. Remove program-dependent resize caps. Run focused Go tests and race detector.
- [x] Integration: expose explicit size takeover in terminal UI; keep input sharing unchanged. Verify actual announced grid is parsed before subsequent output. Preserve mobile reader path and identity guard.
- [x] Verification: UI tests/lint/build, Go tests/race/vet, isolated real tmux integration, and browser geometry/scroll regression. Deployed development candidate to 9444 only; because the existing checkout was dirty, used a separately built test-only binary with the original test arguments instead of the clean-commit release helper (documented in QA report). Full existing visual matrix fresh/normal/hard reload passed 33 final cases; dedicated geometry checks passed 39 measurements. Failed attempts and harness corrections are retained. Physical devices remain NOT RUN. Evidence: `docs/qa/2026-09-29-terminal-geometry.md` and `runtime/geometry-20260929/acceptance.json`.

## Acceptance

Single-client terminal grid gaps are less than one native cell plus declared padding/scrollbar budget. Bash exposes exactly one vertical scroll rail with continuous history/live-frame navigation. Same-session peer changes never alter local font at unchanged local preferences. Reload preserves terminal identity and size-controller grace. Mirrors retain readable text and navigation to the complete frame; geometry conflicts are explicitly reported rather than counted as full-fill PASS.
