# Terminal resilience candidate

Status: candidate `webterm-r41` runs on release-test 9444. The urgent 3440px
Bash fill regression is fixed and the CLI legibility check passes. The full
dynamic visual gate remains incomplete, so r41 is not cleared for production.
Production 9443 remains on r13. Earlier candidate evidence is retained below.

## Behavior

Two opt-in flags select a pinned executable and durable socket directory for new
terminal IDs: `-tmux-session-binary` and `-tmux-session-directory`. The directory
must be canonical, absolute, shell-safe, outside temporary runtime directories,
private to the SSH user, and end in `webterm-production` or `webterm-release-test`.
Socket paths are at most 100 bytes. They include a 128-bit hash of environment,
user, connection and server-generated terminal ID. Identity still requires the
registered canonical name and independent incarnation marker.

Existing `-tmux-binary`/`-tmux-socket` settings remain authoritative for legacy
records. Do not change those records or replace their client during rollout.
All new isolated servers must retain their own matching client version; this
candidate's test fixture uses 3.7c. A mixed old-server/new-client pair is not a
supported migration shortcut.

The new authenticated `GET /api/terminal-health/{conn_id}?terminal_id=...` returns
200 for a matching live identity or 503 with a structured fault for backend
unavailability. Permission/transport failures are inconclusive, not proof of
process loss. Missing socket and stopped server are deliberately grouped as
server unavailable; crash confirmation requires process/kernel evidence.
Public `/api/health` remains a cheap application liveness check and labels its
scope explicitly. Operators must use authenticated terminal probes for readiness.

Permanent terminal faults stop reconnects, discard buffered input and expose an
explicit recheck button. Creating another terminal allocates a new identity and
keeps the old record. It does not submit drafts, execute shell history, or claim
to resume a dead process. Existing layouts persist in SQLite. Existing application
conversation files can be resumed manually if available; no conversation-file
recovery or original production process recovery is claimed.

## Crash evidence

Render `scripts/tmux-isolated-client.sh` with a pinned absolute `@BINARY@`, the
matching socket `@DIRECTORY@`, and a private durable `@CORE_DIRECTORY@`. Pass the
rendered wrapper as `-tmux-session-binary`. Only explicit `new-session` creates
artifact directories and enables a 256 MiB per-core limit. The server starts in
its private artifact directory; the shell still starts in the SSH user's home.
The wrapper records binary version/hash and the host's core_pattern. It changes
neither global core settings nor the existing tmux servers. Relative `core` or
`core.PID` patterns collect there; a system core handler may route dumps elsewhere.
A host hard core limit of zero must be resolved explicitly before enabling this
wrapper. Keep the exact binary and debug symbols for subsequent stack analysis.

Core dumps can contain terminal memory. Keep them mode 0600 under private 0700
directories, do not publish them with QA screenshots, and apply an operator-owned
retention/storage budget. The per-file limit is not an aggregate disk quota.
`collect-terminal-incident.sh BINARY ABSOLUTE_SOCKET OUTPUT_DIR` records identity,
process/listener inventory and available kernel diagnostics without attachment,
creation, signalling, screen capture or shell input. Kernel logs may require a
privileged read separately; the collector does not escalate itself.

## Test deployment and rollback

Candidate artifacts/database/logs are in `runtime/resilience-20260927/`; the test
SQLite snapshot was taken from the previously running test candidate, not from
production. The original test launch arguments are saved in
`previous-test-args.json`. The original test database/binary remain unchanged.
To roll back, stop only the PID whose command line proves it is this candidate
on 127.0.0.1:8889 in release-test, then start the saved previous test command in
the same protected launcher environment. Do not remove any tmux servers, socket
files, or identity records as part of rollback. Newly isolated sessions remain
addressable by this candidate's saved database and configuration.

Production proposal (not executed): retain the legacy wrapper/socket settings;
install a pinned 3.7c binary and rendered core wrapper on the SSH target; configure
`WEBTERM_PRODUCTION_SESSION_DIRECTORY` and `WEBTERM_PRODUCTION_SESSION_BINARY`.
Back up production SQLite using the online backup API and preserve the layout.
After candidate approval, replace only the WebTerm application, then explicitly
create fresh terminals for the dead identities. Original PID memory is gone;
reusing those identities to make new shells appear recovered is forbidden.
A rollback must restore the matching database/configuration alongside the app;
older code cannot attach records using isolated sockets. Never overwrite newer
layout edits with a historical database without separately reviewing that change.

## Evidence ledger

- PASS: real isolated tmux process kill; repeated observational probes cannot
  recreate the killed server, peer server/pane/session/incarnation unchanged.
- PASS: frontend reconnect policy test; terminal fault stops retries/online
  reconnect and drops input until explicit retry.
- PASS (initial source): UI 212 tests, lint/build; Go race across application
  packages and go vet. Existing ignored runtime source copies initially broke
  `go test ./...`; local `runtime/go.mod` isolates diagnostic artifacts from
  application package discovery. No application test was removed or weakened.
- Browser attempts r1/r2: harness errors (incorrect split layout field and an
  assertion before identity-ready messages); retained reports, corrected harness.
- Browser r3: real failure: healthy peer health returned 503; its live PID and
  identity were unchanged. The remote tmux replaced actual tab delimiters with underscores. The final
  probe uses a pipe delimiter and treats malformed output as inconclusive. A
  real healthy-server probe regression was added. Core collection succeeded
  at a private `core.PID` path; the harness now accepts the host's PID suffix.
- Full dynamic visual gate: in progress; no full PASS claimed yet.

- PASS: final r3 browser fault/recovery tests, including portrait/landscape action
  visibility, normal/cache-disabled reload, manual retry, new ID/socket creation,
  unchanged healthy peer identity, and a 1,351,680-byte private core artifact.
  Evidence: `browser-final/report.json`, `browser-mobile-final/report.json` and
  associated screenshots/video under the candidate artifact directory.
- PASS: existing identity browser suite on r3, including actual input into a
  disposable verified shell, explicit legacy adoption, and refusal of a same-name
  replacement without creation (`identity-final/report.json`).
- PASS: final application Go race/vet; isolated registered history/close regression.
- Production proposal artifacts (not installed): `production-proposal/manifest.json`,
  rendered core wrapper and launcher additions. WebTerm binary SHA-256:
  `b164edc996a6d3c4d475f532443eddd89478dce51369eb95de4453f41f1ec168`.

- PASS: test application restart on final r3 with two live isolated terminals.
  Server PID, pane PID, session ID and incarnation unchanged; authenticated health
  and real WebSocket identity readiness pass before and after (`restart-report.json`).
- Fresh dynamic matrix: 10 original cases PASS; workspace-close initially queried
  the obsolete shared socket and failed its fixture setup. Its helper now obtains
  each disposable ID's registered test socket. All existing cancel/partial failure/
  peer preservation/process-exit assertions remain intact. Fresh workspace-close
  rerun PASS (`visual-close-rerun/report.json`). The original FAIL is retained in
  `visual-final/report.json`. No product change was needed for this harness fix.
- Visual review: inspected fault UI at 390×844 and 844×390; recovery controls fit.
  Reviewed extracted frames during the fresh two-display recording. Both displays
  have zero same-geometry font changes across 9,928 and 17,520 sampled frames;
  video gray padding is the recording canvas, not an application blank region.

## r4 private-server bootstrap and acceptance

A late configuration review found that new isolated servers must not rely on
options left on the legacy shared server or user tmux configuration. r4 starts
its private servers with `-f /dev/null` and sets history-limit 200000 before pane
allocation, window-size largest, status off, titles, mouse/passthrough, the existing
screen-256color terminal type, exit-empty on and exit-unattached off. This also
prevents user auto-restore plugins from restoring unrelated sessions into every
new server. Existing legacy servers/configurations are untouched.

- PASS: real tmux options queried from the new pane; independent server-loss
  regression and registered history/close routing.
- PASS: `r4-browser/report.json`: actual private-server creation, small/large
  peer attachment without local font reduction, unchanged peer process identity
  after SIGABRT, correct health 503/200 distinction, stopped reconnects, explicit
  retry/new terminal, both reload types and mobile recovery control visibility.
- PASS: private bounded core collection with this bootstrap (1,429,504 bytes).
- PASS: `r4-restart-report.json`: live private servers/panes retain PID, session ID
  and incarnation across a test WebTerm restart; WebSocket readiness before/after.
- r4 visual matrix: running independently under `r4-visual/`; earlier r3 matrix
  was stopped between scenarios and cannot be substituted for this candidate.
- r4 binary SHA-256: `ce3bfe009c770f4f1858e7b567d26a7638fc0ec0f88318a8de9c1fe57ca87759`.
- r4 production proposal manifest updated; no production installation performed.
- The pinned tmux ELF retains `.symtab` function symbols, but has no DWARF source
  line debug sections. Core retention is verified; source-line stack analysis
  would additionally require matching debug symbols/tooling. The original 3.5a
  crash trigger remains unproven.

## User-reported Panel 6 overflow: r4 acceptance blocked

The r4 matrix was interrupted during fresh `verify-terminal-two-display` after
four completed fresh cases. Its owned browser was closed; remaining cases and
normal/hard-refresh matrix are NOT RUN for r4. Production was not changed.

Read-only browser measurement reproduces the reported Claude outer scrollbar:
`runtime/resilience-20260927/panel6-diagnosis.json` and `panel6-{1920,2860,3440}.png`.
At 1920×1080, the panel has 511px available height but its 35-row rendered screen
is 665px tall, with scrollTop 154. At 2860×988, available height is 465px and
rendered height 1050px, with scrollTop 585. The observed 3440×1440 layout fits.

Desktop font calculation uses width alone; the shared tmux largest-window policy
can supply more rows than fit at that local font. The CLI path enables outer
`overflow:auto` and follows the bottom, which hides upper rows behind scrolling.
Hiding xterm's internal CLI scrollbar does not prevent that outer scrollbar.
The prior bottomGap/composer assertions missed this because bottom alignment
made bottomGap zero even when the screen top was above the panel. Composer
acceptance now also checks screen top and actual outer scroll dimensions.

Status: reproduced product FAIL, not a passed visual release. Asked for the
preferred shared-grid policy tradeoff: complete frame with stable fonts and
potential large-screen whitespace, versus fitting smaller-screen fonts to the
largest grid. No new display policy has been installed yet.

## r11 Panel 6 correction on release-test

Release-test 9444 now runs b05a40e-resilience-r11 only; production was not
changed. The verified control attach sets the server default to
window-size smallest and removes a legacy per-window largest override only
after the registered identity matches. The desktop client requests rows from
the actual rendered xterm cell dimensions and the panel's client height, rather
than from canvas font bounding-box estimates.

r11-panel6/results.json passes 1920x1080, 2860x988 and 3440x1440 before and
after Claude history navigation: each surface has scrollHeight == clientHeight
and topGap == 0, so the full Claude frame has no outer scrollbar. The smallest
connected Panel 6 client currently selects 15 rows; larger displays retain
empty space by design rather than hiding rows or shrinking the smaller
display's font. Browser wire evidence records requests such as 104x26 from the
1920 display while the shared server selects the safe minimum.

- PASS: real tmux identity attach removes an inherited per-window largest
  override and produces effective window-size smallest.
- PASS: Go handler race test; UI suite 48 files / 212 tests; lint and production
  frontend build; r11 health reports b05a40e-resilience-r11.
- NOT RUN: r11's independent complete fresh/normal/hard dynamic visual matrix,
  browser resilience/identity/restart suite after this display-policy change.
  Earlier r4 evidence is retained but cannot approve r11 for production.

## r12/r13 regression and current test-only state

User feedback after r11 identified a critical regression: the 15-row shared
Claude/Codex windows occupied only roughly the upper half of larger Panels.
r12 restricted `smallest` to CLI windows, but the affected Panel 1, 3 and 6
CLI sessions remained 104x15, so the reported half-height display persisted.
The r12 visual matrix was interrupted on that report and is NOT RUN as a
complete release matrix. r11/r12 are FAIL for large-screen fill despite the
earlier Panel 6 no-scroll assertion passing.

r13 on release-test 9444 restores `window-size largest` for all windows on
verified attachment and removes the background path that could switch a CLI
window back to `smallest` after pane output. The three affected sessions were
restored in place to 35–36 rows without restarting their panes. The test
backend is `runtime/resilience-20260927/webterm-r13`, SHA-256
`6503a2cc64ea113dcaad380155b54e4b026058a8378abca3f63dc2506c206e82`.
Production 9443 remains unchanged.

- PASS: `go test ./...`; real tmux identity attachment test; test health and
  `r13-idle` Bash visibility scenario.
- PASS for the urgent large-screen fill check: a live 3440x1440 browser with
  8 visible Panels measured 37–38 shared rows and only 14–18px bottom gap.
- FAIL: `r13-panel6` at 1920x1080 measured a 511px Panel with a 703px Claude
  screen, topGap -192px. The prior full-frame/no-outer-scroll requirement is
  therefore not met when a larger display is attached. The same live browser
  measured 35–36 shared rows against 26 requested rows across the small-screen
  Panels, so this is a shared-grid limitation, not a Panel 6-only defect.
- NOT RUN: complete r13 fresh/normal/hard visual matrix and production gate.
  r13 is a test-only recovery for the reported half-height regression, not an
  approved production candidate.

## User-directed r13 production deployment

After the above limitations were stated, the user explicitly directed that the
current tmux-resilience version be deployed to production first. Production
9443 now runs the exact r13 binary previously used on 9444, SHA-256
`6503a2cc64ea113dcaad380155b54e4b026058a8378abca3f63dc2506c206e82`,
PID 3161921 at deployment. It reports `version=dev`, so the binary hash and
saved artifacts, not the version field, identify this manual deployment.

The previous binary, SQLite online backup, previous launch command and
deployment-specific tmux wrapper are under
`runtime/resilience-20260927/production-20260928T035335Z/` (0700 directory;
database and secret-config backups 0600). Production HTTP health passed on
both 127.0.0.1:8888 and HTTPS :9443. SQLite integrity_check was `ok`.
A disposable isolated tmux 3.7c server was created, queried and stopped in
the new production-only directory; its stale socket was removed. This is a
transport smoke check, not an application-level production terminal creation.

Existing registry identities still point to the crashed legacy 3.5a server;
deployment does not recover their pane processes. New terminal IDs use
per-terminal sockets under `/home/pgz/.local/state/webterm/webterm-production`
and a pinned separate 3.7c client. The persistent environment config now
records the private directory and wrapper. `lan-lib.sh` preflight rejects a
binary without both isolation flags before stopping a running process. The
previous e9867b7 binary lacks these flags; rolling back to it requires
restoring its previous launcher config and cannot expose terminals created in
private servers. Do not represent it as a transparent session-preserving
rollback.

The configured TLS certificate/key files were already absent from their
configured paths, so the standard `lan_check`/release scripts refused to run.
The existing Caddy process was left untouched. The WebTerm backend was switched
with its original production tmux options plus the new private-session flags;
the original launcher configuration and a safe SQLite backup were preserved.
Restoring the missing certificate/key files is a separate operations task
before any Caddy restart or standard release script can succeed.

The user-directed deployment does not convert r13's 1920 Claude full-frame
visual FAIL into PASS. The subsequent local-fit frontend experiments remain
on 9444 only unless a distinct production deployment is authorized.

## r16 local-frame-fit experiment on 9444

r16 keeps `window-size largest` and separates the PTY resize request from the
browser's local rendering metrics. A CLI viewer fits the exact shared tmux
grid to its own Panel width and height; Bash keeps its existing width-based
font and scrollback behavior. Dynamic letter spacing was removed after r15
screenshots showed unnaturally spaced Chinese on the 2860 display.

- PASS: `r16-panel6/results.json` at 1920, 2860 and 3440: no outer overflow,
  topGap 0, and the complete Claude frame before/after history navigation.
  The 2860 screenshot has natural character spacing, with expected unused
  horizontal space from the very wide Panel aspect ratio.
- PASS: `r16-idle` Bash peer-visibility/stable-font scenario.
- PASS: `r16-big-first-gate/results.json` opens 3440 before 1920 on the same
  Claude session. Big font remains 13.2496px before and after small joins;
  small independently uses 10.2997px. Both render 104x37 without outer
  scroll; big bottom gap is 18px. The new
  `scripts/verify-big-screen-independence.mjs` records this direction of the
  dual-display invariant and screenshots.
- FAIL: `r16-peer-font` measured unchanged 1920 Panel 6 from 104x26 at
  14.629px to 104x37 at 10.300px after the 3440 peer attached. The pane
  identity stayed identical. This violates the established same-geometry
  peer-font acceptance criterion. No test assertion was weakened.
- NOT RUN: full r16 dynamic fresh/normal/hard visual matrix. This candidate
  remains test-only and is not approved for production.

One tmux pane has one live logical grid. At fixed local width/height and
readable font, a 37-row frame that is taller than a 26-row Panel cannot be
shown in full without reducing font, clipping/scrolling, or changing the
layout. `largest` and `smallest` merely choose which failure is visible.
Per-terminal server isolation addresses crash blast radius and diagnostics;
it does not give the same pane separate row counts for different viewers.

## r28 responsive large-screen fit on 9444

The 2860x988 display previously used two columns, leaving a nearly 3:1
Panel where a complete 37-row CLI frame occupied only part of the width.
It now uses four columns with 1.5 visible grid rows. The 3440x1440 display
keeps its four-column, two-row layout. The shared desktop request is capped
at 117 columns for these displays and 105 for a conventional 1920 display.
CLI surfaces release their unused scrollbar gutter and left inset, preserving
xterm's native, untransformed character grid. A delayed font adjustment now
respects xterm's integer-pixel row-height jumps.

- PASS: `r28-wide-short/results.json`: 2860 Panel 6 right gap 2px before and
  after 3440 joins; 3440 right gap 30px; both show 117x37 with no outer
  scrollbar and nonnegative bottom gap.
- PASS: `r28-big-screen/results.json`: 3440 opened before 1920 keeps its
  13.593px local font when the small peer joins. Both have no outer scrollbar
  and the full frame is visible.
- PASS: `r28-claude-composer/results.json`: 1920, 2860 and 3440 complete
  Claude frame and history-return checks, no browser errors; 2860 right gap
  6px and 3440 right gap 30px in that sequence.
- PASS: UI 48 test files / 215 tests, ESLint, production UI build, and
  `git diff --check` on the r28 working tree.
- LIMITATION: the release-test fixture includes Claude in Panel 6 but no
  Codex session, so Codex-specific browser content has not been exercised.
  Both use the same CLI terminal rendering path. The complete dynamic visual
  release matrix has not been run; r28 remains on 9444 only. Production 9443
  remains the explicitly approved r13 binary.

## r37 Codex and Claude large-screen legibility on 9444

Panel 3 was confirmed to contain a live Codex CLI despite its stale Bash tab
label. r28's 117-column frame used only 10.96px text at 2860x988 and 11.91px
at 3440x1440. The 2860 four-column Panel is now taller (1.3 visible grid
rows). Both browser requests and the control-mode server cap at 87 columns;
this also prevents an older open browser from keeping the shared tmux grid at
117 columns after the test backend restarts. A one-pixel native xterm cell
spacing adjustment fills the 2860 width without a CSS transform. CLI surfaces
do not reserve an outer scrollbar.

- PASS: `r37-cli-legibility/results.json` opens Codex Panel 3 and Claude Panel
  6 at 2860 and 3440 simultaneously. Both 2860 Panels retain 14.297px when
  the tall peer attaches (Codex grows 37 to 38 rows), right gap 8px, no outer
  overflow, and complete visible top/bottom. The 3440 Panels use 13.60px
  (Codex) and 13.76px (Claude), right gap 66px, with no overflow.
- PASS: `r37-claude-composer/results.json` at 1920, 2860 and 3440: history
  wheel and return, composer visibility, no outer overflow, unchanged local
  font before/after, zero browser errors. After Files/navigation and page
  scroll the 2860 right gap is 6px at 14.136px; 3440 gap is 66px.
- PASS: `go test ./handler ./...`, UI 48 files / 215 tests, ESLint, UI build,
  and `git diff --check`. Both application health endpoints remain okay.
- FAIL: `r37-peer-font/results.json` opens 1920 before 3440 on the same Claude
  pane. Its unchanged 511px Panel drops from 14.595px at 87x26 to 10.016px
  at 87x37. The pane identity is unchanged. One shared tmux logical grid
  cannot show all 37 rows at the old 14.595px in that 511px Panel; preserving
  both a complete frame and constant font needs a different product contract
  or per-viewer terminal state.
- FAIL against the earlier r28 large-fill ceiling: the 3440 right gap is
  66px rather than <=30px. This is the explicit legibility tradeoff for the
  larger font and 87 shared columns, not a passing result under that prior
  ceiling. The exhaustive dynamic visual matrix and mobile/regression
  refresh phases are NOT RUN for r37. r37 remains test-only; production 9443
  is still r13.

## 2026-09-29 production/test large-screen comparison

The production r13 binary is still running at 9443, and test r37 was restored
to 9444 after two failed column-count experiments. Production requires login,
so the comparison used its pinned binary/source and prior production evidence;
no authenticated production Panel was opened by the QA browser. Production
r13 caps desktop requests at 104 columns, while test r37 caps both the
browser request and control-client refresh at 87 columns. With a single tmux
logical grid, the 87-column test frame uses larger glyphs in the 2860 Panel
but occupies less of the 3440 Panel's width. A fresh 3440-only r37 browser
(`r37-big-alone/results.json`) still measured 66px right gap in both Codex
Panel 3 and Claude Panel 6, proving the gap is not caused by simultaneous
small-screen preview.

Measured alternatives on 9444:

- r38 / 94 columns: 3440 right gap 3px, but 2860 font 12.954px and right gap
  46px. `r38-cli-legibility/results.json` failed the 13.2px font assertion.
- r39 / 92 columns: 3440 right gap 21px, but 2860 font 12.926px and right gap
  60px, with a 66px bottom gap. `r39-cli-legibility/results.json` failed the
  same assertion.
- r37 / 87 columns: 2860 font 14.297px and right gap 8px; 3440 font
  13.60–13.76px and right gap 66px. r37 remains the test backend after the
  experiments. Production 9443 was not changed.

The separate dual-display issue is on the *small* viewer: opening 3440 after
1920 grows the single tmux pane from 26 to 37 rows and reduces the 1920 local
font from 14.595px to 10.016px in `r37-peer-font/results.json`. A production
style 104-column policy improves large-screen horizontal fill but cannot
make one live tmux pane have different logical row/column counts for viewers
with different Panel aspect ratios. Resolving all fill, font-stability and
complete-frame constraints simultaneously requires per-viewer terminal state
or a revised layout/acceptance contract, not a global column cap change.

## 2026-09-29 r41 Bash width regression on 9444

The r37 87-column limit applied to every terminal, including Bash, and left
roughly 149px of unused width in a 3440x1440 Bash Panel. r41 applies the
87-column request only to recognized CLI modes; shell and unknown browser
modes request up to 104 columns. The control-mode server starts at the safer
87-column limit for older connected browser tabs, then raises it to 104 only
when remote pane metadata confirms a shell. A mode change triggers a new
browser fit and resize request.

- PASS: 3440x1440 browser Panel 7 Bash uses 104 columns with a 13px right gap,
  13.439px font, no overflow, and zero browser errors. Opening a 2860x988
  peer leaves the 3440 Bash font and gap unchanged.
- PASS: `r41-cli-legibility/results.json` shows Codex Panel 3 and Claude Panel
  6 at 87 columns, 2860 font 14.297px with an 8px right gap, no clipping or
  browser errors, and unchanged font after a 3440 peer opens.
- PASS: `go test ./...`, UI 48 files / 215 tests, ESLint, UI build, and
  `git diff --check`. 9444 returns HTTP 200. r41 binary SHA-256
  `f5d590816368c4ac2da764c63bdf2a545d0ccda9b2a88db42b2d6add339bf369`
  runs only on release-test 9444; production 9443 remains r13.
- LIMIT: The same 104-column Bash grid in the 2860x988 peer uses 11.129px
  text and leaves 76px right space; mixed-size shared tmux panes still require
  a separate design decision. The 3440 CLI right gap remains 66px, and the
  previously documented 1920/3440 peer-font failure remains unresolved.
  Full dynamic visual matrix and mobile regression are NOT RUN for r41.
