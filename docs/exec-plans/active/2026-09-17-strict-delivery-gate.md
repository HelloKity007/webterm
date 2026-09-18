# Strict delivery gate (active)

Objective: 自行定义严格验收标准，达成交付。 No partial PASS is delivery.

Delivery means a reproducible, verified test-environment release with source,
tests, versioned evidence, and rollback instructions. Production 9443 requires
new explicit approval; 9444 is the only deployment target during this work.
The previous investigation was progress (confirmed duplicate-anchor failure and
new failing visual evidence), not completion.

## Requirements and proof

| ID | Non-negotiable result | Required proof |
|---|---|---|
| R1 | Every existing test Panel retains its history across F5, Ctrl+R, Ctrl+Shift+R; no pre-navigation bottom flash | Enumerated workspace/panel/session identities; unique and duplicate anchors; top/middle/near-bottom; >=10 reload repetitions for Panels 2/14; frame samples before unload and content/offset after reconnect; all other panels >=3 per reload type |
| R2 | Claude history can return to bottom from a visible, clickable hint above composer/statusline | Actual Claude session, 1920/3440 and shared peer; >=5 up/return cycles per size before and after both reload types; native hint not duplicated; fallback tested when native absent; no draft submitted |
| R3 | Tab switch/reorder/cross-pane move preserves session, order, active selection and viewport | Existing full dynamic checklist; 5 cycles per case, two displays, saved before/after layout plus DOM/socket/session identity and video |
| R4 | Local font does not jump with peer/renderer/revisit at constant local geometry/DPR; natural spacing and fill | Per-frame font/grid/renderer/screen bounds; small/large displays and DPR 1/1.25; WebGL install and context-loss fallback; no blank frames, no composer clipping, zero added letter spacing |
| R5 | Entire terminal dynamic matrix passes on the final build | All rows of docs/qa/terminal-visual-release-checklist.md, fresh/normal/hard phases; mobile portrait/landscape/input/reading/keyboard; same/different session peers, refreshing either peer; not merely script exit codes—review rendered evidence |
| R6 | Existing release gates remain satisfied | Fresh UI tests/lint/build; go test -race ./... -count=1; go vet ./...; diff check; relevant reconnect/performance regression (accepted 33.5ms hardware threshold retained); no ignored failure |
| R7 | Previously selected five unfinished validations are accounted for, not silently declared done | Real 10k/50k directory benchmarks; large transfers/reconnect/cancel/retry/memory; SSH+lrzsz ZMODEM; axe+cross-browser rendered regression; actual file-tab drag between browser windows. Audit current evidence first, implement missing behavior/tests, preserve failures |
| R8 | Honest and reproducible handoff | Final candidate identifier/hash, commands, runtime environment, raw artifacts, requirement-by-requirement results, clean scoped changes, versioned known-issues; no hardware/emulation substitution |
| R9 | Lost persistent sessions cannot silently become new shells | Distinguish initial creation from reconnect after loss, including WebTerm restart; injected loss on disposable private tmux only; explicit actionable UI error, no automatic replacement or draft replay; structured loss evidence; pinned tmux and production/test isolation preflight before stopping a service |
| R10 | Windows Edge hard reload reliably loads page and terminal content | Native Ctrl+Shift+R on Windows 185 plus original 206 persisted-editor scenario; document/assets/network/console/navigation plus recorded rendered content; restored file tabs and delayed SFTP handshake; distinguish whole-page blank from terminal-only blank; retain failures and report non-reproduction honestly |

Windows physical-browser and phone hardware checks must be recorded separately
from Linux browsers/emulation. Missing required evidence stays NOT RUN; it is
never silently waived. A release decision cannot be made from a narrower matrix.

## Work sequence

1. Revalidate source/runtime; map terminal/font/drag/persistence dependencies.
2. Isolate current font and cross-pane reorder failures. Add failing behavioral
   tests and instrument the actual boundary; distinguish harness failure from
   application failure. Preserve baseline layouts/drafts.
3. Fix one confirmed cause at a time; recheck original Panels 2/14 and Claude.
4. Strengthen the harness for real shortcuts, all-panel content/offset assertions,
   renderer transitions, and honest artifact review. Run browsers serially when
   they share mutable terminal fixtures; deliberate peer tests are one case.
5. Run the entire final candidate matrix and R7 validation. A failed case blocks
   delivery, even if it is pre-existing. Do not delete or weaken assertions.
6. Audit every row above from current authoritative artifacts. Publish only a
   tested candidate to 9444; request separate production approval afterwards.

## Current dependency boundary

- Terminal entry: PersistentTerminalTab / TerminalTab -> ThemedTerminal.
- Font: ThemedTerminal -> localViewport -> terminalFontFit -> xterm DOM/WebGL
  metrics; resize requests -> WebSocket -> shared tmux grid -> OSC title.
- History: wheel/key/input handlers -> shellHistoryViewport/sessionStorage ->
  bounded terminal-history HTTP capture + ordered WebSocket writes; Claude
  uses native alternate-screen mouse input and server-derived resume action.
- Layout: TabBar -> reorderTabs / LeafPane.handleReceiveTab -> pane cache ->
  revisioned layout sync; PersistentTerminalTab retains renderer/session identity.
- Evidence/harness: existing visual scripts are consumers, not an oracle. Their
  assumptions (scrolling screenshots, offscreen drag coordinates, old file UI)
  must be verified against the real browser and current specification.

## Status

ACTIVE. Test environment now runs e388c5a-strict-diagnostic11. Diagnostic5's
text-aware native reload test reproduced Panel 14 history wrapping corruption;
diagnostic6 preserves logical soft-wrapped lines in the tmux history capture.
Its isolated real-tmux regression failed before the fix and passes afterwards.
Diagnostic8 also restores CLI reader intent/lifecycle and actual tmux mouse
protocol on reconnect. Its two-width fresh/normal/hard five-repeat series
completed all 30 cases successfully. Diagnostic9 adds the tested no-op update
optimization (190 UI tests, lint/build pass). Its Linux targeted native-history
run passed 60 cases, but the CLI series FAILED at normal-2/3440 with missing
bottom content. The serial queue stopped; the full dynamic matrix did NOT run.
An isolated Chromium experiment now reproduces both mismatched capture metadata
and late-snapshot overwrite using the current backend encoder/output-order code.
Architecture checkpoint awaits user confirmation before another runtime change.
Final browser/full-matrix acceptance is still pending. Windows native key
delivery now has verified navigation after correcting the QA driver's selection
of a shell TabProxyWindow instead of Edge's real main window. The independent
Windows run passed 10 Panel 2 hard reloads, then failed Panel 14's first case:
visible content/viewport remained identical but baseY/fromBottom grew by one.
See docs/qa/2026-09-17-windows185-native-reload.md; this is not full acceptance.
No requirement row is signed off for final delivery yet.

### Production incident scope update

The user explicitly cancelled recovery of old Claude processes/conversations.
Do not resume conversations or investigate additional remote hosts for recovery.
Preserved incident evidence remains private; original processes are not restored.
New-version prevention and the existing terminal/file-manager delivery gates
remain in scope. Production deployment still needs candidate-specific approval.

Confirmed kernel evidence records the production tmux 3.5a server crashing;
the subsequent replacement sessions do not constitute recovery. Local paired
binary/socket configuration and launcher validation have been implemented and
tested, but are not production-deployed and do not alone satisfy R9. In
particular, the automatic has-session/new-session fallback still needs a
durable distinction between first creation and unexpected session loss.
Nested SSH sessions require persistence on the remote execution host as well;
local tmux cannot guarantee survival of a remote foreground Claude process.

### Windows 206 whole-page failure

The user supplied the decisive console stack: FileEditor sends a read while the
SFTP WebSocket is CONNECTING. The served diagnostic9 asset at the reported
line/column matches that initial read effect exactly. This is independent of
terminal snapshot ordering and must not be closed by terminal-only reload tests.
See `docs/qa/2026-09-18-edge-green-screen.md`. The previous 185 non-reproduction
does not cover the persisted-editor handshake race. The component fix and
delayed-handshake native-WebSocket Chromium regression passed, including
retaining dirty edits and original conflict revisions across reconnection.
The diagnostic10 build passed 194 UI tests, lint/build, Go race tests and vet,
and is deployed only to 9444. All 48 pre-deploy test pane/PID identities were
preserved. Production was not changed. Full deployed-page regression and 206
user-site confirmation are still pending; no final gate is signed off.

Diagnostic11 adds the atomic/cancellable upload path, editor accessibility
semantics, and reused filename collator. Its pre-deploy 197 UI tests,
lint/build, Go race suite and vet pass. Test-only cutover preserved all 48
session/pane/PID tuples; production PID unchanged. Provenance and rollback
binary are under runtime/strict-diagnostic11-deploy. Deployed axe and native
large-directory measurements are ongoing; do not inherit diagnostic10 browser
PASS as final diagnostic11 acceptance. Upload SSH cancellation checks do not
replace HTTP/browser large-transfer and memory gates.

### R9 persistent identity implementation status

Store-level terminal identities and conditional state transitions now exist.
Tests cover concurrent reservation (only one winner across independent Store
connections), restart persistence, user isolation and mismatched incarnation
rejection. Root independently ran `go test -race ./store -count=1` successfully.
This foundation is not wired to terminal creation/attach or frontend readiness,
and is not deployed. The current test/production attach path still has automatic
creation fallback: R9 remains incomplete. A SQL identity row alone is not proof
that the corresponding remote process survived.

### Diagnostic15 R9 follow-up (test environment only)

The preceding foundation-only statement is superseded for candidate
`e388c5a-strict-diagnostic15-identity` on 9444, but not for production release
approval. Ordinary `/ws/ssh` now requires an active durable identity and tmux
control mode. It executes the identity check and attach in one `tmux -N -C
if-shell -F` queue, then withholds browser input until the exact framed UUID
marker and `%session-changed` are both observed. A missing, inactive, or
same-name-replaced session gets a structured error and a read-only UI overlay;
it does not run `new-session`, restart tmux, or forward queued input.

Explicit `POST /api/terminal-sessions/{conn_id}` is the sole new-session path;
it reserves a server-generated terminal ID and UUID before the create command,
then transitions `reserved -> active` only after success. The explicit legacy
adoption endpoint can mark an existing deterministic panel session only after
an exact-name/empty-marker same-queue check. It has no creation fallback.
Existing test-layout migration marked 25 of 27 exact sessions; two missing or
unverifiable candidates remain `reserved` and were not replaced.

Evidence: `runtime/strict-diagnostic15-deploy/` contains pre/post service and
pane identity snapshots. `runtime/terminal-identity-browser-diagnostic15/` and
`runtime/terminal-identity-restart-diagnostic15/` both PASS: server-generated
create, real Chromium guarded attach/input, explicit legacy adoption, same-name
replacement refusal without a replacement shell, and service-restart durable
identity. Targeted real tmux tests additionally prove lost-server attach does
not recreate a tmux server and a wrong UUID cannot attach. Production PID was
compared before/after each test-only restart and was unchanged.

R9 still remains open for final delivery until the full candidate matrix and
Windows requirement R10 complete. Production is deliberately not deployed.

### Windows QA resources (owned by this run)

185 SSH alias resolves to admin on Windows host DESKTOP-N150. Existing user Edge
processes were left untouched. A dedicated interactive test profile was launched:

- Scheduled task: `WebTermStrictQA-20260917-232747`
- Profile: `C:\Users\admin\AppData\Local\Temp\WebTermStrictQA-20260917-232747`
- Loopback CDP: 9335, forwarded locally to 127.0.0.1:19335 through SSH.
- Reported Edge: 152.0.4191.66. The existing QA task was restarted after its
  browser had exited. Native F5/Ctrl+R/Ctrl+Shift+R navigation is now verified;
  terminal acceptance remains incomplete as recorded above.

On completion stop only the processes belonging to this exact QA profile,
unregister this exact task, and close the owned SSH tunnel. Do not close other
Edge profiles or delete any broad directory. Keep diagnostic artifacts.

### Candidate26 authoritative status — 2026-09-18

Current 9444 candidate: `e388c5a-strict-diagnostic26-custom-select-a11y`.
Production remains PID `2003370` and has not been restarted or promoted.

| Gate | Current evidence | Status |
|---|---|---|
| R1 | Candidate26 33-case fresh/normal/hard matrix plus Windows 185 native Ctrl+Shift+R, Panel 2/14, 10 each | PARTIAL: not every panel/reload-key combination is native-Windows proven |
| R2–R4 | Candidate26 matrix includes Claude history/composer, peer font, switch/reorder/cross-pane and dual-display evidence | PASS for automated/browser-rendered scope |
| R5 | `runtime/diagnostic26-terminal-visual-gate/report.json`: 33/33 PASS; representative artifacts manually reviewed | PARTIAL: physical-phone review remains NOT RUN |
| R6 | 2026-09-18 rerun: UI 49 files/211 tests, lint, build; `go test -race ./...`, `go vet ./...`, diff check all PASS | PASS |
| R7 | Candidate26 directory, 256MiB transfer/retry/memory, ZMODEM safe flow, axe 0/0, 3-browser smoke PASS | PARTIAL: Windows native cross-window file-tab drag did not emit browser events; retained FAIL |
| R8 | `runtime/diagnostic26-current-provenance/provenance.json` records candidate, binary SHA-256 `24e2d577…2d0666`, a 225-file source manifest (`cde653ec…6c5`), and 10 built frontend assets (`a749ced9…9933`); remote HTML/main/editor asset hashes were compared with the local build | PARTIAL: 106 working-tree entries remain uncommitted; final clean scoped commit/branch/reproducible release provenance remain required |
| R9 | Candidate26 identity browser proof confirms explicit create, guarded attach, adoption, and replacement refusal | PASS for isolated test scope |
| R10 | Windows 185 real Edge Panel 2/14 native hard reload 20/20 PASS | PARTIAL: original 206 persisted-editor and physical phone are NOT RUN |

No final delivery or production-promotion claim is valid while any PARTIAL row
remains. In particular, do not turn the Windows native drag failure into a
component-test PASS, and do not infer the 206/phone results from 185 or
emulation.

### R1 all-panel capacity and position audit — 2026-09-18

The first Linux all-panel native-key run is retained at
`runtime/diagnostic26-linux-history-all-panels/`. It passed 47 cases then
stopped on Panel 5 F5 round 3: the 26 visible lines and `viewportY` were
identical, while a bounded tmux capture produced `baseY/fromBottom` lower by
one. This is not silently accepted. Dedicated Panel 5 reruns passed both a
near-bottom 10× F5 series (`runtime/diagnostic26-panel5-f5-10x/`) and a true
middle 10× F5 series (`runtime/diagnostic26-panel5-f5-middle-10x/`) with exact
base, viewport and relative-bottom equality.

The original all-panel-middle run then exposed a harness precondition rather
than a restoration failure: Panel 3 currently has only one normal-buffer line
(`baseY=1`, 35 rows) and cannot possess a middle. The runner now records such
Panels as `insufficientHistoryPanels`, still executes their reload assertions,
and reserves the middle invariant for a buffer of at least four visible
screens. `runtime/diagnostic26-panel3-middle-ineligible/report.json` proves
both the explicit classification and the one-line F5 preservation. The v2
all-panel run is under `runtime/diagnostic26-linux-history-all-panels-middle-v2/`;
it is RUNNING, not a PASS at the time of this record.

### Candidate33 current-run evidence — 2026-09-18

The test-only 9444 candidate is
`e388c5a-strict-diagnostic33-context-anchor`. Production PID remained
`2003370`; no 9443 service, binary, session, or layout was changed.

- Shell history has 135 passing Linux real-browser/native-key cases over the
  currently readable Shell Panels: F5, Ctrl+R, and Ctrl+Shift+R, three rounds
  each. The first whole-workspace report deliberately stops on CLI Panel 6;
  Panel 19 is an R9 read-only identity guard, not a replacement Shell or a
  history pass. `diagnostic33-linux-history-real-18-panels-3x3`,
  `diagnostic33-linux-history-shell-final-remainder`.
- Claude normal and cache-bypassing reload each pass ten real rounds (five at
  1920 and five at 3440). The native return hint sits above the composer, is
  not duplicated, dismisses after click, and changes the tmux reader.
  `diagnostic33-cli-history-normal-5x2`,
  `diagnostic33-cli-history-hard-5x2`.
- Automated R3/R4 evidence passes: five-cycle cross-pane moves for Panels 5/6,
  same-pane native reorder/restore, simultaneous 1920/3440 peers with retained
  canvas and zero same-geometry font changes in 14,572/28,552 samples, and
  DOM/WebGL/context-loss fallback at both widths (62.6ms/93ms under 100ms).
- The complete terminal visual matrix now passes 33/33: all eleven automated
  scenarios in each fresh, normal, and cache-bypassing phase. The runner checks
  candidate identity and restores the shared test layout around every case:
  `diagnostic33-terminal-visual-gate/report.json`. This remains an automated
  browser result, not a physical-device signoff.
- Current R7 automation passes: real native-WebSocket 10k/50k listings (three
  runs each), 256MiB FileChooser upload and context-menu download hashes,
  cancel/manual retry/offline-online retry, real SSH `sz` hash, safe unsupported
  `rz`, Chromium/Firefox/WebKit workspace smoke, axe WCAG2A/AA 0 violations / 0
  incomplete, and CustomSelect keyboard/ARIA. All artifacts are named
  `runtime/diagnostic33-*`.
- Current source gates pass: UI 49 files / 212 tests, lint, production build,
  `go test -race ./... -count=1`, and `go vet ./...`.

This is **not a delivery**. A corrected 185 isolated Edge task now exposes CDP
and real `SendInput`; Panel 2 and Panel 14 each pass ten Windows native
Ctrl+Shift+R middle-history rounds (20/20) at
`diagnostic33-windows185-hard-p2-p14-10x`. An earlier 16/60 broader Windows
run is retained as a QA-task transport failure, not erased. Windows native
file-tab drag remains a real failure: a verified OS click reaches the source
document and all 21 drag events are accepted by Windows, but Edge emits no
`dragstart`, `dragover`, or `drop`, so the target receives no tab
(`diagnostic33-windows185-native-file-tab-drag`). The QA driver now stages its
large interaction program in a unique temporary file instead of exceeding the
Task Scheduler command-line limit; the unproven legacy-drag experiment was
removed. Original 206 persisted-editor Edge and physical Android/iOS IME
acceptance remain NOT RUN. These hardware gates, plus a clean scoped
commit/provenance audit, block final delivery and any production promotion.

### Physical-device availability check — 2026-09-18

The local Android platform tools report only `127.0.0.1:5037` in the `offline`
state; no usable Android device is attached. No iOS device tooling is installed.
This is an environment observation, not a mobile result: physical Android/iOS
IME, reading, keyboard, and visual acceptance remain **NOT RUN**.

### Native cross-window drag input isolation — 2026-09-18

The candidate33 X11 probe now proves the input precondition rather than
inferring it from a timeout. On a dedicated 1920×1080 Xvfb/Fluxbox display,
the exact source-tab coordinate receives native `pointermove`, `mousedown`,
`mouseup`, and `click` through `xdotool click`. After clearing that probe, an
`xdotool mousedown` at the same coordinate produces no document-level
`mousedown` within 150ms, so a browser drag cannot begin. The report is
`runtime/diagnostic33-native-file-tab-cross-window-down-probe/report.json`.
This is a test-environment input limitation, not a PASS and not a product
regression conclusion; a physical native-browser drag remains required by R7.

### Windows 206 isolated editor reload — 2026-09-18

An independently named Edge profile on 206 (not the user's existing Edge) ran
the real read-only SFTP editor fixture against 9444. Edge 146 completed the
initial load plus five `page.reload` rounds with one restored file tab each,
six reads, zero writes, and no page error:
`runtime/diagnostic33-windows206-editor-reload/report.json`. The verifier
attached only to its own CDP endpoint and released its isolated browser context
without closing the browser. Afterwards its exact scheduled task was absent,
9336 was no longer listening, and its exact temporary profile was removed.
This increases same-hardware coverage but is not an original persisted-editor
result and is not a native Ctrl+Shift+R result; R10's original 206 scenario
remains **NOT RUN**.
