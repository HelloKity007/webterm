# Scroll regression investigation — 2026-09-17

This is an investigation build, not production approval or full visual acceptance.
Production remains `8d63f1a5eb463a94be13331f4b025e5dc0704d12` on 9443.
Only the test binary on 9444 was replaced; its database and tmux sessions were preserved.

## Confirmed cause

Panel 14's saved anchor can be an identical repeated line of `X` characters.
The old restoration searched backwards and selected the last match, even when
the saved distance from the bottom was 57 rows. Browser evidence shows scrollbar
553/569 becoming 569/569 after a cache-disabled reload, with the saved snapshot
unchanged. The new matcher selects the matching position closest to the saved
distance. Unique anchors still follow their original content when output grows.

The regression unit test failed before the change (expected 42, actual 99), then
passed. Repeated-anchor browser evidence after the change shows 552/569 remaining
552/569. Deferred Bash follow callbacks also now recheck history ownership;
Claude is deliberately excluded from this Bash-only protection.

## Keyboard investigation

Synthetic key events did not reproduce Panel 2's reported transient bottom jump.
An early diagnostic incorrectly used focus without `preventScroll`, which itself
moved the outer viewport. That result is not evidence of a keyboard defect.
The corrected diagnostic records no Ctrl+R input sent to the terminal.
Modifier/reload events now bypass xterm's key processing and clear pending input
cursor reveal, without preventing the browser's default reload shortcut.

`verify-native-hard-reload.mjs` uses X11 keyboard events to invoke an actual
headed Chromium Ctrl+Shift+R. It samples the viewport until beforeunload and
compares the restored viewport. On diagnostic3 and again on diagnostic4,
Panel 2 and Panel 14 each passed five repetitions per build. This is Linux
Chromium, **not Windows physical-device proof**.

## Claude hint

At 1920 pixels the captured Claude screen lacked the native hint; at 3440 pixels
it rendered `Jump to bottom (ctrl+End)`. The fallback therefore anchors above the
actual composer separator, and must be suppressed when the native hint exists.
Never place it in the upper-right corner. Browser verification checks both the
geometry and that clicking actually changes the server-side CLI viewport.
On diagnostic4, a first native click did not change the captured viewport within
one second (FAIL). A subsequent run passed at both widths, without duplicate
buttons. The first failure is not discarded; native-click reliability still
requires further investigation rather than a blanket PASS.
The harness was then corrected to measure native-click coordinates AFTER the
locator screenshot, since screenshots may scroll the page. Three subsequent
two-width runs passed (six clicks), saved separately under
`runtime/cli-history-hint-final-{1,2,3}`. The first two runs were isolated; the
third overlapped the two-display regression. This supports the targeted click
path but does not turn the original failed run into a pass.

## Evidence and limits

- `runtime/reload-scroll-before/`: baseline screenshots and numeric failure.
- `runtime/reload-scroll-after-repeat/`: repeated-anchor diagnostic assertions.
- `runtime/native-hard-reload/`: native shortcut frame samples and screenshots.
- `runtime/cli-history-hint/`: two-width hint geometry, screenshots and click checks.
- Frontend tests: 184 passed; Go tests, lint and build passed on diagnostic4.
- Extended gate `runtime/scroll-diagnostic4-visual-gate/report.json`: fresh idle
  shell visibility, peer font stability, and terminal switching PASS. Cross-pane
  move FAIL: original tab order was not restored. The gate restored the saved
  layout, stopped, and marked the candidate FAIL. Remaining normal/hard matrix
  phases are NOT RUN; no assertion was removed or weakened.
- All-panel, Windows hardware, mobile physical-device and cross-browser
  acceptance: **NOT RUN for this investigation build**.
- Additional two-display run: **FAIL**, evidence at
  `runtime/scroll-diagnostic4-two-display/results.json` and its videos/frame logs.
  Both displays recorded four font changes with unchanged local geometry.
  For example, the large display's Panel 6 changed from 13.439 to 14.999 while
  its surface remained 849×691. This run briefly overlapped the last hint-click
  run, so it must be repeated in isolation before attributing the failure to a
  particular patch; it is nevertheless not a passing release result.
- Panel 2's originally reported intermittent flash has not been reproduced on the
  corrected harness. Passing repetitions do not establish its original cause.

No production release or blanket “all issues fixed” claim is justified by this report.

## Strict goal continuation: diagnostic5

- Delivery requirements are now tracked in
  `docs/exec-plans/active/2026-09-17-strict-delivery-gate.md`.
- Root cause of font jumps confirmed: deferred DOM -> WebGL changes the fitting
  rule from fractional to floored cell widths. The new font is computed using
  the conservative fractional measurement for either renderer. Renderer geometry
  still follows actual xterm dimensions; no glyph stretching/letter spacing is added.
  Unit regression failed first (935.946px needed versus 841.5px available), then passed.
- `runtime/renderer-font-before-confirmed/` reproduces the real-browser font jump.
  `runtime/renderer-font-after5/` passes both 1920 and 3440 through DOM -> WebGL
  -> genuine WEBGL_lose_context fallback, at unchanged font and panel geometry.
- Addon context-loss callback waits 3000ms. Native canvas event capture now
  restores DOM immediately without replacing the terminal/session. Failure before:
  3104.7ms (`runtime/renderer-recovery-before/`). After: 67.8ms and 85.8ms,
  below the explicit 100ms recovery limit. Broader no-blank-frame review remains required.
- Drag failure was traced to the harness, not assumed to be product sorting:
  `runtime/cross-pane-order-diagnostic/result.json` records the final dragstart
  on Panel 17 instead of the requested Panel 5 after locator auto-scroll. The
  corrected native mouse helper checks the actual dragstart identity and drop
  payload. Panels 5/6 each passed five cycles with original order and DOM identity
  restored (`runtime/cross-pane-corrected-harness/`). Assertions were retained.
- UI 185 tests, lint/build, Go tests, `go test -race ./... -count=1`, `go vet ./...`
  passed. Production remains unchanged. Only test binary updated to
  `e388c5a-strict-diagnostic5`, preserving test database and terminal sessions.
- Full diagnostic5 matrix is RUNNING; no final signoff yet. Its composer test now
  checks the accepted remote-only file explorer/editor contract, not removed
  local/SFTP dual panes.

## Reopened after user reports unchanged symptoms

- Live health checks confirm test 9444 is `e388c5a-strict-diagnostic5` and
  production 9443 remains `8d63f1a5eb463a94be13331f4b025e5dc0704d12`.
- The full rerun is no longer running. Its report at
  `runtime/strict-diagnostic5-full-rerun/report.json` is **FAIL**: the normal
  refresh terminal-switch case records `fixtureError: fetch failed`. Its empty
  runner log does not establish whether the visual assertion itself failed.
  The remaining normal cases and hard-refresh matrix are not completed.
- Existing native reload checks cover only panels 2 and 14, compare scrollbar
  geometry rather than historical text identity, and cannot establish Windows
  shortcut behavior. Synthetic key events plus a separate CDP reload are not
  equivalent to a real browser hard-refresh shortcut.
- User-reported symptoms remain unresolved for acceptance purposes. Do not
  infer successful repair from earlier targeted passes, deploy to production,
  or add speculative product patches before reproducing the remaining failure.

### Text-aware native reload reproduction

- Added a read-only xterm buffer probe and `verify-native-history-reload.mjs`.
  It requires actual browser navigation after OS keys and compares visible text,
  normal-buffer offset, and pre-unload frame samples, not just scrollbar pixels.
- `runtime/native-history-content-second/report.json`: Linux Chromium Panel 2
  passed one F5, Ctrl+R, and Ctrl+Shift+R each. Panel 14 **failed F5**: before and
  after both have cols=104, viewportY=1932, baseY=2001, fromBottom=69, yet wrapped
  X rows changed from 104 characters to 103, with their trailing fragments
  changing from 87 to 96 characters. Before/after screenshots are preserved.
  This is content reflow corruption missed by geometric-only checks, not proof
  that the separately reported pre-navigation bottom flash is resolved.
- Investigation now targets `terminalHistoryCaptureCommand`: it captures
  physical tmux rows without `-J`, then converts all LF to CRLF. Soft wraps thus
  become hard line breaks, so a capture during transient column negotiation
  may remain at that width after the final grid returns. This causal hypothesis
  still needs an isolated browser replay experiment before a product patch.
- Windows OS key validation remains **FAIL** (navigation timeout), not PASS.
  A confirmed command-length failure was fixed by moving the script body from
  SSH argv to line-based stdin. Foreground QA-window and input-desktop checks
  now pass, but WScript key dispatch still has not caused browser navigation.
  Raw attempts are retained under `runtime/windows-native-history-*`.

### Diagnostic6: preserve logical history lines

- The isolated real-tmux regression
  `TestTerminalHistoryCapturePreservesLogicalWrappedLines` failed first: a
  103-column capture inserted CRLF into a single logical line over 300 characters.
  Adding `-J` to the bounded history capture keeps logical lines intact; the
  same regression now passes. Initial visible-screen capture is unchanged.
- Deployed only 9444 as `e388c5a-strict-diagnostic6`, preserving the database
  and tmux sessions. Previous binary is retained at
  `runtime/release/webterm.before-strict-diagnostic6`.
- `runtime/native-history-content-diagnostic6/report.json`: all six targeted
  Linux native-key cases pass (Panels 2/14 × F5/Ctrl+R/Ctrl+Shift+R), including
  actual visible text and pre-unload frames. This is one repetition per case,
  not all-panel/Windows acceptance. The 10-repetition run is separate.
- Fresh UI 185 tests, lint/build, Go tests, Go race suite, Go vet and diff check
  pass. Existing npm-config, jsdom canvas and bundle-size warnings remain.
  No final full-matrix or release signoff is implied.
- Expanded run `runtime/native-history-content-diagnostic6-repeat/report.json`
  is **FAIL**, not a 60-case pass. The first 43 cases pass; Panel 14 Ctrl+R
  repetition 4 records baseY 2001 -> 2002 and viewportY 1932 -> 1933 while all
  visible text and fromBottom=69 remain identical. Determine whether this is a
  bounded-capture origin change or an extra replay write before changing the
  assertion. This does not establish another visible jump, nor final acceptance.
- `runtime/cli-history-hint-diagnostic6-hard/` reproduces the missing Claude
  resume hint: 1920px screenshots `1920-before-reload.png` and `1920-hint.png`
  show the same historical content and composer, with the hint present before
  reload and absent afterwards. The test now reloads *after scrolling into
  history*, rather than before performing the scenario. It fails the hint
  assertion. `showHistoryResume` currently initializes to false on remount;
  investigation must preserve the reader intent without duplicating native
  controls or placing the fallback above the wrong composer boundary.

### Diagnostic7/8 and evidence-backed harness correction

- CLI reading intent now persists per user/connection/panel in sessionStorage,
  clears synchronously on return/input, and tolerates unavailable storage.
  The resume component re-subscribes when xterm is created after child mount.
  Its lifecycle regression failed first (button absent) and now passes; UI
  suite increased to 189 tests, with lint/build passing.
- Diagnostic7 still failed the real 3440px native hint click after hard reload.
  `runtime/cli-history-hint-diagnostic7-protocol/3440-before-click.json` records
  browser mouse tracking `none`, encoding `DEFAULT`; real tmux pane flags are
  any-motion=1 and SGR=1. Only wheel reports were sent; the native click emitted
  none. This confirms missing mouse-mode restoration, not a successful click.
- Diagnostic8 extends the initial pane snapshot with actual standard/button/
  any-motion and UTF8/SGR flags. Shell snapshots explicitly disable absent modes.
  Both new protocol boundary tests failed before implementation and now pass;
  full Go tests/race/vet also pass. Only test 9444 is updated.
- The diagnostic6 absolute-index failure was isolated without writing to user
  sessions. `runtime/bounded-history-origin-height/results.json` shows a quiet
  disposable tmux capture at 26 -> 27 -> 26 rows, replayed into 26-row xterm:
  baseY 2001 -> 2002 -> 2001; viewportY 1932 -> 1933 -> 1932; all 26 visible
  lines remain exactly equal and distance from bottom stays 69. This matches
  the earlier failure and proves an absolute buffer-origin invariant is wrong.
  The native verifier retains both indices in raw evidence, validates their
  relation, and compares every visible line, relative offset, and geometry.
  No text/offset/visual requirement is removed. The earlier FAIL is preserved.
- Diagnostic8's CLI series completed: `runtime/cli-history-diagnostic8-repeat/`
  contains all 30 passing width cases (1920/3440 × fresh/normal/hard × 5).
  The native hint is above the composer, not duplicated, and the click changes
  real tmux output back to the bottom. The 3440 before/after screenshots were
  reviewed and show the actual bottom completion text after return. These
  targeted passes do not replace shared-peer, full dynamic, or Windows proof.
- A redundant state-update regression was caught before delivery: repeated
  dismissal of an already-hidden hint triggered React renders. Its new unit
  test failed first and now passes after returning unchanged state on no-op.
  UI suite is now 190 tests, with lint/build passing. Diagnostic9 contains this
  small optimization and requires fresh candidate-specific browser evidence.

### Diagnostic9 remains FAIL — renewed user report

- Rechecked test health: `e388c5a-strict-diagnostic9`. The user still reports
  the original symptoms; no acceptance or production promotion is warranted.
- `runtime/strict-diagnostic9-native-history/report.json` contains the targeted
  Linux native-key run, not all-panel or Windows acceptance.
- `runtime/strict-diagnostic9-cli-history/normal-2/failure.json` fails the
  composer-position assertion at 3440px. `3440-before-click.json` records a
  38-row alternate buffer whose last 13 rows are empty. The saved screenshot
  and server capture require investigation as a content-restoration failure,
  not merely a button-offset problem. The subsequent full matrix did not run.
- Code review identifies two unproven but concrete ordering hazards:
  `ws.go` obtains pane metadata and capture through separate SSH commands;
  `terminalOutputOrder.snapshot` can overwrite newer live output, then restores
  only the latest grid. Neither guarantees that content, dimensions and cursor
  belong to the same screen state. Do not describe either hypothesis as the
  experimentally established cause yet.
- Repeated unsuccessful delivery requires an architecture checkpoint under
  the debugging skill. No further runtime patch or deployment in this turn.
  Proposed next investigation: reproduce delayed capture plus concurrent resize
  in an owned fixture, then evaluate ordered snapshot/live-stream restoration.
  Production remains untouched; all failed artifacts are retained.

### Controlled snapshot-order experiment (no runtime changes)

- Added opt-in `TestSnapshotRestoreOrderingBrowser` and
  `scripts/diagnose-snapshot-order.mjs`. The Go test calls the existing
  `terminalScreenSnapshot` and `terminalOutputOrder`; the resulting byte stream
  is replayed in real Chromium/xterm with the grid-announcement contract.
  No WebTerm endpoint, SSH connection or existing terminal is used.
- Command: `WEBTERM_QA_SNAPSHOT_ORDER=1 go test ./handler -run
  '^TestSnapshotRestoreOrderingBrowser$' -count=1 -v`.
  Result: **FAIL**, retained intentionally as a diagnostic regression.
- Evidence: `runtime/snapshot-order-diagnostic/results.json` plus four rendered
  screenshots. The coherent 38-row control passes with complete composer and
  statusline. Both the metadata-26/capture-38 case and a delayed 26-row snapshot
  after a newer 38-row redraw leave 12 empty bottom rows and the wrong cursor.
  The control and mismatched-metadata screenshots were visually inspected.
- A same-grid counterexample also fails: delayed 38-row snapshot replaces
  CURRENT content with STALE content even though dimensions and footer remain
  correct. Checking only grid equality or only footer presence is insufficient.
- These controlled schedules establish real failure mechanisms in the current
  code, not the exact ordering of a particular recorded live-user failure.
  A real stream trace is still required for that attribution. The prior test
  `TestLateSnapshotDoesNotReplaceLatestLiveGrid` only checks a final grid suffix
  and cannot establish screen-content correctness.
- Next architecture proposal must preserve coherent metadata/content/cursor,
  ordered snapshot-to-live handoff, quiet-pane initialization and input/mouse
  modes. It must address same-grid stale content as well as resize clipping.
  Runtime implementation remains paused for the requested architecture decision;
  no commit, deployment or production modification was performed here.

### Live diagnostic9 trace confirms an actual late-snapshot failure

- The hint verifier now supports `WEBTERM_QA_TRACE=1`: records received frames
  for Panel 6 only, connection identities without URL credentials, navigation,
  bounded trace size with an explicit overflow marker, and the corresponding
  server capture. No application/runtime code was changed. Frame contents are
  private local QA artifacts and must not be published as public logs.
- Ran three serial normal-reload cases, each at 1920 then 3440. Runs 1 and 2
  passed the targeted hint assertions; run 3 FAILED at 3440. This is diagnosis,
  not an acceptance run, and does not erase the earlier failures.
- Exact evidence: `runtime/diagnostic9-live-trace-3/receive-trace.json`,
  `3440-server-before-click.txt`, `3440-before-click.json`, `3440-hint.png`,
  `failure.json`, and `video/`. Candidate is still strict-diagnostic9; trace
  overflow is false (3440 received JSON payload total 28,029 bytes).
- In the 3440 post-reload connection (socket id 1), event index 50 is an
  80x24 clearing screen snapshot. It arrives after the 104x38 grid and four
  non-grid data frames. The next grid message restores 104x38, but there are
  **zero subsequent non-grid data frames** before failure/browser cleanup.
  Browser buffer has 38 rows with 14 empty rows; the screenshot, visually
  inspected, lacks the composer/statusline. The separate server capture still
  contains the native hint and complete bottom area.
- This live record confirms that late stale snapshot replay plus grid-only
  correction causes this particular observed missing-bottom failure. It does
  not establish the cause of every Panel 2/14 history defect or the Windows
  native-key issue. Metadata/content consistency still needs correction too;
  merely comparing grid sizes cannot prevent same-size stale overwrites.
- Runtime architecture work remains at the previously requested decision
  checkpoint. No deployment, production change, commit or push in this turn.
