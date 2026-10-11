# Automatic terminal fit implementation plan

**Goal:** Fit the foreground terminal automatically when opened, activated, switched or resized; preserve local font size and one Bash scroll rail.

**Architecture:** Keep the server's per-terminal serialized geometry ownership. A small frontend controller transfers ownership on foreground user activation and local capacity changes, never in response to remote grid announcements alone. Background/hidden clients remain mirrors. Remove the persistent Fit button; retain the context-menu fallback.

**Tech Stack:** React, TypeScript, xterm, Vitest, Playwright, Go/tmux unchanged.

**Spec:** User feedback in this conversation; existing accepted constraints in `AGENTS.md`, the main development Spec and `docs/qa/terminal-visual-release-checklist.md`.

## Constraints

Work inline in the dirty main checkout, preserve unrelated edits and drafts, deploy only 9444. No production approval or worktree is needed for this test change. Referenced superpowers execution tools are unavailable; execute this plan in this session.

## Tasks

- [x] Add `automaticTerminalGeometry.test.ts`: foreground reconnect/activation requests local grid before takeover; hidden/background activation does nothing; remote grid changes do not themselves trigger takeover; next user input can reclaim; changed local capacity automatically fits; repeated render/update/input does not loop.
- [x] Run the focused Vitest test and observe failure before implementation.
- [x] Add `automaticTerminalGeometry.ts` implementing those state transitions and integrate in `ThemedTerminal.tsx`: connect/disconnect, local fit, shared-grid observation, window focus/blur/visibility, visible-panel transitions and terminal pointer/key activation; dispose all subscriptions. Remove the persistent Fit button and its CSS.
- [x] Replace button-dependent browser assertions with ordinary foreground/panel activation, retaining width/height/font assertions. Add an automatic-fit browser check for no-button opening, foreground switching, resize and passive background stability.
- [x] Run UI tests/lint/build and Go regression. Build a new test candidate and deploy 9444, preserving existing sessions.
- [x] Run the candidate's complete 33-case fresh/normal/hard visual matrix and automatic-fit/dual-peer reload checks. Reviewed artifacts; 33 dynamic cases, 9 automatic-fit records and 39 geometry records passed. Harness failures remain recorded, physical devices NOT RUN. Evidence: `docs/qa/2026-09-29-automatic-terminal-fit.md`, `runtime/geometry-20260929/automatic-acceptance.json`.
