# Idle Claude hard-reload correction plan

**Goal:** Panel 6 must fill its actual composer and status line after native Ctrl+Shift+R without any post-navigation click or key.

**Evidence:** `runtime/geometry-20260929/claude-idle-r8-native/results.json`: after the second native hard reload, the announced/local grid was 93 columns but the actual Claude separators remained 87 columns at 6 seconds. Trace: live 93-column redraw at 16557ms, stale 87-column snapshot at 16725ms, then 93-column metadata only. `TestSnapshotRestoreOrderingBrowser` also fails on mixed capture/state, delayed snapshots and same-grid stale content.

**Architecture:** Read pane metadata and visible capture in one tmux command queue. Version all live output/layout changes. Publish a bootstrap capture only if its source version is still current and its grid matches current layout; otherwise retry a fresh coherent capture. Never append newer metadata behind stale pixels. Keep streaming output running, keep existing terminal identity/auth and geometry ownership, and preserve input drafts.

**Scope:** Dirty main checkout, test 9444 only; no worktree or production changes. Execute inline with the available tools.

- [x] Add coherence/ordering unit tests; preserve the existing browser assertions for full content/composer/status, including a successful fresh recapture after invalidation.
- [x] Implement atomic state/capture command and parser in `handler/terminal_bootstrap_snapshot.go`; version guard in `terminal_output_order.go`; bounded fresh retries in `ws.go` after verified attachment.
- [x] Run Go race/tests/vet, controlled encoder/browser counterexamples, and UI regression/build. Deploy new 9444 candidate with the validated test-only launcher.
- [ ] Run native Ctrl+Shift+R with no follow-up interaction and actual separator-width assertions; run the candidate's fresh/normal/hard dynamic matrix plus automatic-fit/geometry checks. Preserve failures and report physical devices separately.

## Geometry gate follow-up

r9 passed native no-input Claude reloads and 33 dynamic cases, but failed the dedicated multi-display Bash history-reader gate. The traced accepted snapshot's pixels and metadata were both discarded by the frontend history branch. Do not accept r9 or reuse its passing matrices as r10 evidence.

- [x] Reproduce a reader discarding snapshot pixels; add independent accepted-grid delivery regression and retain stale-pixel rejection tests.
- [x] Keep the latest geometry during frontend history parsing and apply it after saved-grid replay/anchor restoration; test buffering, superseding and cleanup.
- [ ] Rebuild and deploy r10 to test 9444 only; independently rerun Go/UI/controlled tests, full 39 geometry records, native no-input hard reloads, 9 automatic-fit records and all 33 dynamic cases.

Status: r10 deployed; Go/UI/controlled, 39 geometry, native 10 and automatic 9 pass. All 33 dynamic cases executed, but overall gate is FAIL: initial full matrix 29 PASS / 1 hard-Claude-composer FAIL, remaining hard mobile/landscape/workspace-close 3 PASS. The failed width and three-width composer reruns pass without product changes; this is not a verified fix for the intermittent failure. Preserve the original FAIL. Additional same-session 104-column attachment observed, origin/causality unproven; ask about other open test pages without detaching their clients. Explain/reproduce that transition before another acceptance claim.

## 2026-09-30: verification after coordinated peer closure

User confirmed another 9444 page on host 206 and closed it. Read-only `tmux -L webterm-release-test-fixed list-clients` now returns no clients. Product source/deployed r10 binary stays unchanged. Closing the peer is test coordination, not a product fix or proof of the original failure's exact source.

Files: add `scripts/verify-dual-host-terminal-geometry.mjs` for a controlled two-device-focus approximation; update `scripts/summarize-idle-hard-reload-gate.mjs` to reference new evidence without overwriting old FAILs; record outcomes in `docs/qa/2026-09-29-idle-claude-hard-reload.md`. Inline execution only, no agents/worktree/commit/production changes.

- [x] Verify external attachment disappears and rerun all three composer widths with existing assertions: `WEBTERM_QA_RELOAD=hard WEBTERM_QA_OUTPUT=runtime/geometry-20260929/idle-composer-r10-after206-closed xvfb-run -a node scripts/verify-claude-composer.mjs`. All widths must fit before/after history navigation; retain safe receive/send grid timeline.
- [ ] Run new independent full matrix: `WEBTERM_QA_DB="$PWD/runtime/resilience-20260927/test.db" WEBTERM_QA_OUTPUT=runtime/geometry-20260929/idle-full-r10-after206-closed node scripts/run-terminal-visual-gate.mjs`. Require exactly 33 PASS records, fresh/normal/hard × all 11 scenarios, same candidate version throughout, unchanged workspace fixture/drafts. Do not merge successful retries into the earlier FAIL report.
- [ ] Controlled peer test: two browser contexts with document focus held true (explicit approximation of independently focused devices), Panel 6 grids 77×34 and 104×30, safe per-client geometry timeline. Alternate explicit control once, then hold both quiet for at least 5 seconds and require both views to follow only the last controller. Keep font16 on both; the smaller passive mirror may navigate a larger shared grid. No Enter/typed draft; Shift only for deliberate activation. Reject unsolicited grid changes, preserve screenshots and optional failure state. Run sequentially after matrix, never concurrently against shared fixture.
- [ ] Repeat native no-input hard refresh: `WEBTERM_QA_ROUNDS=10 WEBTERM_QA_OUTPUT=runtime/geometry-20260929/claude-idle-r10-native-after206-closed xvfb-run -a node scripts/verify-claude-idle-hard-reload.mjs`. Require actual composer separators at 3s/6s, no post-navigation input, same identity/candidate and no browser errors.
- [ ] Aggregate new matrix/native/peer evidence with r10's already candidate-bound 39 geometry, 9 automatic-fit and 4 counterexample passes; independently verify deployment health/binary SHA-256 and `git diff --check`. Retain all prior FAILs. Describe external interference as consistent with observations, not retrospectively proven exclusive causality. Physical phones/native Windows remain NOT RUN.
