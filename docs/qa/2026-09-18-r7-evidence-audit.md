# R7 remaining validation audit — 2026-09-18

Read-only audit against `docs/exec-plans/active/2026-09-17-strict-delivery-gate.md` and current source/artifacts. No tests rerun, services changed, or user fixtures modified for this audit. None of the five requirements is proven complete on the final candidate.

## 1. Real directories: 10,000 / 50,000 entries — NOT VERIFIED

Browser follow-up on diagnostic11 now covers real native-WebSocket SFTP
responses, 3 runs per size, visible rows, sorting, exact search and scroll-to-last
entry. Native 50k complete-list times: 2.993/3.059/3.025 seconds; 10k:
0.966–1.054 seconds. Evidence:
`runtime/large-directory-browser-diag11-native/report.json`. Responses are
approximately 11.15 MB and 2.23 MB respectively. The runner isolates layouts
and redirects listing requests only to its owned real fixture, not synthetic
responses. Correctness passes; aggregate browser RSS is not an isolated
renderer incremental memory ceiling. Same-candidate routed/native comparison
and performance acceptance remain separate; do not claim an improvement ratio
by comparing diagnostic10 routed timing with diagnostic11 native timing.

Follow-up: the backend portion now has real SSH/SFTP evidence in
`runtime/sftp-directory-benchmark/`. Five listings per size verified every name
in 60,000 actual files; median ListDir times were 202.007 ms (10k) and 822.927 ms
(50k). This uses local SSH and predominantly warm filesystem caches. Allocation
and process RSS/HWM measurements have explicit limitations in report.md; they
do not measure browser or sshd memory. The owned fixture was removed afterward.
The browser/HTTP/rendering portion remains unverified, so the overall row stays
open. Earlier statements below describe the pre-follow-up audit.

`ui/src/components/sftp/FileList.test.tsx` has 10k/50k synthetic-array tests asserting bounded rendered DOM and item totals. This is useful component coverage, not a remote filesystem/SFTP benchmark. No dedicated real-directory benchmark runner or report was found in scripts/runtime paths inspected.

Missing: disposable owned remote fixture; actual SFTP listing latency and payload; first usable render, sorting/filter/search/scroll interaction; browser and server memory at both scales; repeated runs and candidate/fixture identity. Do not substitute synthetic DOM row counts for this evidence.

Immediately executable component check (partial only):

```sh
cd ui
npx vitest run src/components/sftp/FileList.test.tsx
```

Real benchmark needs a new isolated-fixture runner before an honest completion command can be supplied.

## 2. Large transfers / reconnect / cancel / retry / memory — NOT VERIFIED

Second-hop HTTP cancellation now also passes on diagnostic11, with explicit
phase evidence: request body finished and owned remote partial grew to 98,304
bytes before abort. Original SHA remained unchanged, partial disappeared within
5 seconds, and explicit 256 MiB retry/download hashes matched. Latest report:
`runtime/large-http-transfer-1789714919329/report.json` (PASS_HTTP_NODE_ONLY).
208 samples at 100 ms measured server RSS +2,064,384 bytes and Node RSS
+10,158,080 bytes; temporary staging disk peaked at 268,435,456 bytes.
Browser memory and actual network-loss/reconnect remain unverified. Earlier
NOT RUN statements below reflect earlier runs, not this second-hop result.

HTTP follow-up now has partial proof on diagnostic11:
`runtime/large-http-transfer-1789714795454/report.json` records a streamed
256 MiB multipart upload (5.419 s), full download with matching SHA256,
cancellation during 4 MiB HTTP staging with original target unchanged and no
remote partial, and successful explicit retry. Sampled server RSS grew
9,216,000 bytes against a predeclared 128 MiB delta limit; streaming Node client
was below its 96 MiB delta limit. This is not browser memory evidence, and HTTP
cancellation during the second-hop SFTP copy is NOT RUN. A preceding harness
failure (singular ticket endpoint typo) and its owned fixture were retained,
not erased or counted as a product failure. Full transfer acceptance stays open.

Follow-up: diagnostic11 includes context-aware atomic HTTP upload. A real
loopback SSH mid-copy cancellation test returned in 384 ms, retained the
original target hash, removed its partial, kept the shared SSH usable and
verified an explicit retry hash. Protocol tests also verified partial mode0600
before first content write. Evidence: `runtime/atomic-upload-loopback-result.json`.
This does not yet cover browser HTTP staging/copy cancellation or large-file
memory; those remain open. Atomic replacement requires writable parent and
POSIX rename extension and changes inode/ownership semantics; no destructive
fallback is allowed.

Current source streams uploads into a temporary disk file (`handler/sftp.go`) then copies to SFTP; downloads use `io.Copy`. `sftpmgr/client.go` opens the destination with `Create` and copies the reader. Bounded streaming design does not itself prove a memory ceiling, interruption integrity, or cancellation propagation. Browser `FileList` has XHR abort, but the second-hop SFTP copy does not expose request-context cancellation in the inspected path.

Latest existing general file-manager report inspected, `runtime/file-manager-qa/1789636693263-01bf306e/result.json`, is FAIL on version `8d5b1e...`: obsolete dual-pane assertion (`0 !== 2`) and fixture/cleanup ticket HTTP 400s. It is not current transfer evidence. `scripts/verify-file-manager.mjs` still carries dual-endpoint assumptions; do not run it against shared state as a purported acceptance gate.

Missing: large upload/download SHA verification, measured browser/server RSS/heap ceilings, interruption at both HTTP staging and SFTP-copy stages, cancellation final-file integrity, explicit retry behavior, draft/session isolation, and cleanup evidence. No complete ready-to-run acceptance harness found.

## 3. Real SSH + lrzsz ZMODEM — KNOWN ISSUE / NOT VERIFIED

Real deployed-browser follow-up is now **FAIL**, not merely missing evidence:
the dedicated diagnostic11 SSH terminal successfully reached its QA shell, but
`sz -b` of a 64 KiB owned payload produced no browser download within 30 seconds.
The terminal showed a ZMODEM header; no pageerror occurred. Evidence:
`runtime/zmodem-browser-run2/`. The exact newly created QA session was cleaned
up; the failed fixture remains for investigation. Binary protocol byte-path
diagnosis is ongoing; do not claim Sentry or tmux is the proven cause yet.

`docs/known-issues.md` explicitly records `rz` upload as disabled/aborted pending real SSH+lrzsz bidirectional and content-hash gates; `sz` end-to-end verification remains pending. No dedicated lrzsz/ZMODEM end-to-end runner found. Existing terminal/SFTP success is not ZMODEM evidence.

Missing: disposable SSH/tmux fixture, actual rz/sz binaries, browser selection/download gesture, protocol progress and completion, file SHA, cancel/reconnect and terminal recovery. Do not enable production upload merely to run a test.

## 4. axe + cross-browser rendered regression — PARTIAL, NOT FINAL

Diagnostic11 opened-editor scan now has zero violations (22 passes). Its one
remaining contrast incomplete targets CustomSelect's arrow-only span, not a
proven contrast failure. Manual review found missing selector semantics, which
are being addressed separately. Evidence:
`runtime/strict-diagnostic11-editor-a11y/axe.json`. The diagnostic10 failures
below are retained historical evidence, not the current scan result.

Opened-editor follow-up on deployed diagnostic10 **FAILS**: the real SFTP
README editor produces `aria-input-field-name` (unnamed CodeMirror textbox),
`aria-required-children` (non-tab buttons in tablist), and
`scrollable-region-focusable` (editor scroller keyboard access). One contrast
check remains incomplete. Exact nodes and failure report are retained under
`runtime/strict-diagnostic10-editor-a11y/`. The scan runs on the file workspace
after six successful restored-editor loads; successful reload is not an
accessibility pass. Source fixes are being developed, not deployed yet.

Follow-up: smoke aggregation now requires all three engines; any FAIL fails,
and a missing engine yields INCOMPLETE with nonzero exit. A Node regression
checks these cases. Structured results are retained; script still explicitly
labels itself visibility smoke, not visual acceptance. Separately, actual
diagnostic10 editor assets with real read-only SFTP passed initial load plus
five ordinary reloads in Chromium and Firefox. Firefox final editor screenshot
was reviewed for visible content/line numbers. These focused checks do not
replace full-state visual or accessibility coverage.

`runtime/file-manager-a11y-1789636583503/axe.json` reports 0 violations, 24 passes, **2 incomplete checks**, timestamp 2026-09-17T09:16:26Z. Two earlier retained reports have three violations each. The runner opens the Files workspace and scans WCAG2A/AA without deliberately opening remote files, editor tabs, split groups, conflict dialogs or transfer states. Zero violations therefore does not cover those states or resolve incomplete checks.

`runtime/file-manager-browsers-1789636583407/` has Chromium/Firefox/WebKit screenshots. `scripts/verify-file-manager-browsers.mjs` only asserts visible workspace, accepts zero `.sftp-endpoint` nodes, and declares aggregate PASS if **any** engine passes while others may be NOT_RUN. It performs no comparative visual assertions. These artifacts are smoke evidence, not the required rendered regression.

Immediately executable limited checks, only against an authorized isolated 9444 fixture and after confirming candidate identity:

```sh
node scripts/verify-file-manager-a11y.mjs
node scripts/verify-file-manager-browsers.mjs
```

The runners need stronger state setup, all-engine gates, candidate metadata, retained reports, manual incomplete-check review, and screenshot review before R7 can pass.

## 5. Real cross-browser-window file-tab drag — NOT VERIFIED

`scripts/verify-workspace-cross-window-drag.mjs` targets **workspace** tabs, synthesizes DragEvents within the first page, then checks synchronization in a second page. It is not native pointer drag between windows, not file-editor-tab transfer, and only launches Chromium. It can create/reorder shared workspaces; do not run against user layout as a substitute.

Current `DualPaneSftp.tsx` sends a tab ID and `moveTab` looks up that ID in the receiving window's existing `tabs`; missing IDs are ignored. Thus the source does not demonstrate transfer of a source-only tab/draft into another browser window. Existing component reorder/split coverage cannot prove cross-window transfer.

Missing: native drag between actual windows on supported browsers, source-only file tab and dirty draft, target group/position, ownership and duplicate rules, connection identity, preservation after reload, cancelled drag, and user-layout restoration. There is no honest ready-to-run acceptance command for this requirement yet.

## Handoff

### Latest source review and browser transfer failure

The diagnostic11 browser transfer report
`runtime/large-browser-transfer-1789715330529/report.json` is **FAIL** despite
successful 256 MiB upload/download SHA checks and cancellation/manual retry.
During offline/online recovery the displayed remote directory changed from
the owned fixture directory to `/`; an upload to `/payload.bin` was attempted
before the working-directory response arrived. The fixture guard blocked it:
no out-of-fixture write was sent. A later successful retry does not turn that
reconnect case into PASS, even though the old report's individual stage label
says PASS. New reports must attribute guard failures to the affected stage.

Source review confirms that SftpPanel caches the old directory when switching
session keys, but the same-session reconnect initializes from an absent cache
and the default path. FileList owns the HTTP upload, so socket checks in the
parent alone cannot prevent writes during this window. The required repair is
both preserving the correct connection/session directory and gating upload
until that directory is confirmed on the live connection. Regression tests
must also reject cross-connection cache leakage. This repair is in progress;
it is not present in the deployed diagnostic11 build.

Root independently ran the current UI suite: 49 files / 202 tests passed.
This includes the newly corrected ZMODEM receive helper and the actual
installed protocol-library test, but is not a deployed SSH/ZMODEM test or a
replacement for browser reconnect acceptance. Test output retains existing
jsdom canvas and workspace border-style warnings; these were not silently
reported as visual acceptance.

The deployed diagnostic11 editor was independently rechecked in Firefox and
WebKit: initial load plus five ordinary reloads per engine passed, each with
exactly six real read-only SFTP reads, retained README tab/content, and no
page errors. Reports are in
`runtime/strict-diagnostic11-editor-firefox-confirm/report.json` and
`runtime/strict-diagnostic11-editor-webkit-confirm/report.json`. Both runners
intercept layout writes and block terminal sockets. These are focused editor
restoration checks, not Windows native hard reload or the complete rendered
visual matrix. Current source lint and the full Go race suite also passed
before the next identity-attach regression test was added; final checks must
be repeated once concurrent edits settle.

R7 stays open. Prioritize isolated fixture infrastructure; preserve existing FAIL/NOT_RUN artifacts. Current FileEditor CONNECTING repair and its real-browser regression address a separate startup incident and do not satisfy these five broader requirements. No production actions are authorized by this audit.

### Candidate25 current-run evidence — 2026-09-18

The current release-test candidate is
`e388c5a-strict-diagnostic25-history-user-anchor`.  The following isolated
browser evidence has now been collected for that exact candidate:

- `runtime/diagnostic25-large-directory/report.json`: native-WebSocket SFTP
  browser listings for 10,000 and 50,000 real owned entries, three rounds each;
  exact search, sort, virtualized bottom-row navigation, and declared renderer
  heap/RSS sampling pass.
- `runtime/large-browser-transfer-1789730741767/report.json`: real 256 MiB
  FileChooser upload and context-menu download SHA checks, UI cancel, manual
  retry, and offline-to-online manual reselection retry pass within the
  declared heap/RSS ceilings. This is controlled browser-offline recovery, not
  a claim of packet-loss recovery or whole-system memory measurement.
- `runtime/diagnostic25-zmodem-final/report.json`: a real owned SSH `sz`
  download of 64 KiB matches SHA-256 and the shell remains usable. `rz` remains
  deliberately unsupported; its safe notice/return path is verified and it
  remains a known issue, not an enabled upload feature.
- `runtime/diagnostic25-file-manager-browsers/report.json`: workspace
  visibility smoke passes in Chromium, Firefox, and WebKit. It is expressly
  not a comparative visual acceptance result.
- `runtime/diagnostic25-file-manager-a11y/axe.json`: WCAG 2A/2AA scan records
  zero violations and 24 passes, with one `incomplete` result retained for
  manual assessment. It cannot be reported as a complete accessibility signoff.

The candidate also re-passed identity loss protection in
`runtime/diagnostic25-terminal-identity/report.json`: explicit creation,
guarded browser attach, explicit legacy adoption, and same-name replacement
refusal all pass. The test uses only a newly created exact private tmux session
and removes it through the authenticated API.

These results close the automated portions above but do **not** close R7 or
the final delivery gate. The retained Xvfb native cross-window file-tab drag
attempt is still a genuine failure (`runtime/native-file-tab-cross-window-diagnostic14-xinput/report.json`), and actual Windows/206/phone visual-device
acceptance still has to be recorded separately. No production service, process,
or user terminal session was changed while collecting this evidence.

### Candidate26 accessibility and Windows-native drag follow-up — 2026-09-18

Candidate `e388c5a-strict-diagnostic26-custom-select-a11y` replaces the
decorative Unicode select-arrow with a CSS triangle. The real deployed-files
axe result at `runtime/diagnostic26-file-manager-a11y/axe.json` is now **zero
violations, zero incomplete** (24 passes); the dedicated real-browser keyboard
and ARIA check passes at `runtime/diagnostic26-custom-select-a11y/`.

Windows 185's isolated Edge profile was also used for a stronger native file
tab attempt. `runtime/diagnostic26-windows185-native-file-tab-drag-rerun3/`
records two separate titled Edge popups, exact measured screen coordinates, and
all 21 OS `SendInput` mouse events accepted by Windows. Neither popup received
`dragstart`, `dragover`, or `drop`; the target remained empty. This is an
environment/input-delivery failure, not browser drag acceptance and not a
product pass. The test only ever targeted the uniquely named QA profile
popups; screenshots and the report prove it did not use a user Edge window.

The Windows native-drag gate remains **NOT VERIFIED**. Do not replace this
with component-level DragEvent coverage or claim R7 complete until a real
browser environment emits and verifies the event sequence.

### Candidate26 Linux X11 native rerun — 2026-09-18

The independent X11 browser runner was re-executed against candidate26. The
first run, retained at `runtime/diagnostic26-native-file-tab-cross-window/`,
found an Xvfb geometry error rather than a product signal: its 1280-pixel-wide
display clipped the target point x=1415 to x=1279. The runner now asserts and
records display geometry before sending input; the bounded regression report
at `runtime/diagnostic26-native-file-tab-cross-window-bounded/report.json`
fails early with that exact coordinate error instead of reporting a false drag
failure. A 1920×1080 rerun at
`runtime/diagnostic26-native-file-tab-cross-window-1920/report.json` reached
the target coordinate but still produced no `dragstart`, `dragover`, or `drop`
in either Chrome page. This is consistent with the existing remote-input
delivery limitation and is not a browser-window-drag PASS. The code path has
unit coverage for source-only transfers, dirty drafts, duplicate protection and
per-window persistence; physical native browser evidence remains required.

### Candidate26 full terminal gate and rendered-artifact review — 2026-09-18

`runtime/diagnostic26-terminal-visual-gate/report.json` is **PASS** for all
33 cases: 11 scenarios in each fresh, ordinary reload, and hard-reload phase.
The report confirms the exact candidate version before every case and rejects
any case that changes the shared release-test fixture. The large two-display
cases passed in all phases and retained dual display screenshots, dynamic-frame
records, and video under each phase's `verify-terminal-two-display` directory.

Representative artifact review was performed, rather than relying only on the
runner's exit status:

- hard two-display Bash: `hard/verify-terminal-two-display/display-1-panel-2.png`
  shows deep history, the prompt/cursor, and the minimal right-side scrollbar
  with no blank peer-grid tail;
- hard two-display Claude: `hard/verify-terminal-two-display/display-1-panel-6.png`
  shows visible long content, status line, and the resume action immediately
  above the input boundary;
- hard mobile landscape:
  `hard/verify-mobile-landscape/pixel-7-landscape.png` shows visible tab bar,
  terminal input, and right edge without clipping.

This is an explicit **browser-rendered artifact review**, but it remains
separate from the unavailable physical-phone and original Windows 206
persisted-editor checks. It therefore strengthens R5 but does not silently
close R10 or the device-disclosure part of the final gate.

### Candidate26 final R7 reruns and Windows hard-reload evidence — 2026-09-18

All non-native-drag R7 browser evidence was repeated on candidate26 rather
than inherited from candidate25:

- `runtime/diagnostic26-file-manager-browsers/report.json`: Chromium,
  Firefox, and WebKit workspace smoke all pass;
- `runtime/diagnostic26-large-directory/report.json`: real native-WebSocket
  10k/50k directory test, six runs total, passes for the candidate recorded in
  the report;
- `runtime/diagnostic26-large-browser-transfer-final/report.json`: now records
  the exact candidate health/version and passes 256 MiB upload/download SHA,
  cancel, explicit retry, controlled offline/online retry, and declared
  renderer heap/RSS limits;
- `runtime/diagnostic26-zmodem/report.json`: records the exact candidate and
  passes SSH `sz` browser download/hash plus safe unsupported `rz` recovery.

`runtime/diagnostic26-windows185-panel2-panel14-hard/report.json` records a
separate real Windows 185 Edge test-profile run: Panel 2 and Panel 14 each
passed ten native OS `Ctrl+Shift+R` hard reloads (20/20 total) while reading
the middle of actual normal-buffer history. Each round proves native key
delivery, real navigation, candidate identity, pre-navigation rendered frames,
and exact post-reconnect history content/offset equality. This is strong R10
evidence for the owned Windows 185 profile, but it does not substitute for
the original Windows 206 persisted-editor or physical-phone scenarios.

### Windows-native drag input-layer diagnosis — 2026-09-18

The native file-drag result was investigated one level below the application.
`runtime/diagnostic26-windows185-native-pointer-metrics/report.json` proves
the dedicated source Edge popup was activated, Windows reports a 1920x1080
screen, and the OS cursor reached the exact CDP-measured file-tab coordinate
`(504,152)`. Windows accepted all injected click events, but the Edge document
received zero post-setup `mousedown`, `mouseup`, or `click` events. Retrying
the same owned popup through Windows' legacy `mouse_event` path produced the
same result in
`runtime/diagnostic26-windows185-native-pointer-legacy/report.json`.

This narrows the retained drag failure to the 185 remote interactive-desktop
input-delivery boundary: it is neither a custom-MIME/file-tab implementation
failure nor a browser CSS-pixel/DPI-coordinate mismatch. Keyboard injection
on the same dedicated profile continues to work (the 20/20 hard-reload proof
above), so it cannot be used to infer native mouse delivery. A local physical
pointer session or another browser environment that emits the DOM sequence is
still required for R7's native-drag signoff.

### Diagnostic13/14 follow-up evidence

Diagnostic13's real browser transfer run is PASS:
`runtime/large-browser-transfer-1789716597647/report.json`. It used an actual
256 MiB file chooser upload and context-menu download (SHA-256
`51dd6e…b32e9ef`), UI cancellation, explicit reselection retry, and offline to
online recovery. The final reconnect preserved the owned directory and made no
out-of-scope upload request. Renderer heap grew from 5.49 MiB to 6.81 MiB and
the declared CDP-owned process RSS sum stayed below its 384 MiB threshold. This
is a real browser result, though it does not claim network packet-loss recovery
or general OS memory usage.

Diagnostic13's real SSH+lrzsz browser result is PASS at
`runtime/zmodem-browser-diagnostic13/report.json`: a 64 KiB `sz` download
matched its SHA-256, the shell completion marker rendered after transfer, and
the explicitly unsupported `rz` flow printed its notice, returned, and accepted
the next shell command. During the first run the browser download itself
succeeded but the marker was swallowed because lrzsz omitted zmodem.js's final
`OO` close bytes. Diagnostic13 adds a narrowly matched post-ZFIN recovery that
hands only that known completed-protocol error's following bytes back to the
terminal; other protocol/checksum errors still fail. `rz` remains disabled.

Diagnostic14 contains native cross-window file-tab transfer handling: a typed
drag payload includes source window, transfer id, remote connection identity,
refresh mode and draft; target acceptance broadcasts removal to the source.
Different connections and duplicate dirty drafts are rejected, and each window
now has separate persisted workbench state. Component tests cover source-only
dirty-draft acceptance and connection rejection. The attempted actual X11 test
is still **FAIL**, retained at
`runtime/native-file-tab-cross-window-diagnostic14-xinput/report.json`:
two separately positioned Chrome windows were found and xdotool reached the
target X11 window, but Chromium emitted no `dragstart`, `dragover`, or `drop`
DOM events under this Xvfb environment (including XTEST). It is therefore not
valid native-drag acceptance and R7's cross-window native browser item remains
open.
