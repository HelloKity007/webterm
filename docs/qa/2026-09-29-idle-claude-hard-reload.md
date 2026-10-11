# Claude idle hard-reload correction

Current candidate: `geometry-20260929-r10-snapshot`, test URL `https://192.168.11.87:9444`, binary SHA-256 `4cac917b56d710df998ef42694770726def2ac9c0d31c3f55fc237ecefb0d753`. Built from the existing dirty main checkout; unrelated changes retained. Production 9443 unchanged. The earlier r9 results below are historical evidence, not r10 acceptance.

## Root cause and correction

The r8 native failure reproduces the user's Panel 6 report: local/server grid reached 93 columns, but both actual Claude composer separators remained 87 columns after six seconds without input. The captured WebSocket trace contains a 93-column live redraw followed by a delayed 87-column bootstrap snapshot, then a 93-column metadata announcement. Metadata corrected the canvas, but did not correct the stale pixels. The prior automatic-fit matrix missed this no-interaction contract.

Bootstrap formerly read pane metadata and capture in separate SSH commands. It now reads both through one synchronous tmux command queue, validates dimensions/cursor/modes and the exact visible row count, and preserves ANSI/blank rows. A source revision covers every live output and changed grid. A capture started before newer output is rejected in its entirety, including same-grid stale captures; a differing snapshot grid is also rejected. A fresh coherent capture is retried up to eight times with 100ms spacing. Streaming output remains independent. No synthetic input, column toggling, glyph stretching, session replacement or draft execution is used.

The existing verified identity/authentication boundary is unchanged. The new command uses the verified server-side canonical target and existing private socket/binary scope; no user-provided command syntax or new endpoint is introduced. Capture transport closes when attachment ends. Work is bounded for continuously busy panes; this does not claim unlimited snapshot retries or universal future CLI compatibility.

## Earlier r9 verification (not accepted)

| Check | Status / evidence |
| --- | --- |
| Original no-input native failure | FAIL reproduced and retained: `runtime/geometry-20260929/claude-idle-r8-native/` |
| Controlled encoder/browser counterexamples | PASS, all four retain current first row/composer/statusline; `snapshot-r9-green-final/` and `idle-r9-snapshot-browser.log` |
| Coherent parser/ordering and real tmux queue | PASS, including blank rows/ANSI and multiple heights; isolated fixture, no user terminal |
| Go race, vet | PASS; `idle-r9-go-race.log`, `idle-r9-go-vet.log`; the isolated tmux identity suite was also explicitly enabled |
| UI unit, lint, TypeScript/Vite build | PASS, 50 files / 218 tests; `idle-r9-ui-tests.log`, `idle-r9-ui-lint.log`; existing npm config/canvas-stub/bundle-size advisories remain |
| Native Ctrl+Shift+R without post-navigation input | PASS, two runs of 10 reloads; final candidate-bound run after the complete dynamic matrix: `claude-idle-r9-native-final/results.json`; initial run: `claude-idle-r9-native/results.json`. Actual separators reach 93 columns, not merely canvas metadata. Initial one-second frames can be provisional/blank; all three- and six-second checks show full composer width. |
| Full fresh/normal/hard dynamic matrix | PASS, all 33 candidate-specific cases; `idle-full-r9/report.json`; selected Bash/Claude input and history-return artifacts reviewed separately |
| Automatic fit | PASS, final 9 records with sustained rendered readiness; `idle-auto-r9-stable/results.json`; failed attempts retained below |
| Dedicated geometry matrix | FAIL; `idle-geometry-r9/` and instrumented repeat `idle-geometry-r9-traced/`. See root cause below. r9 is not accepted. |
| Physical phones/displays, native Windows shortcut | NOT RUN; Xvfb native X11 keys and browser/mobile emulation are separate evidence |

Evidence directories above are under `runtime/geometry-20260929/`. Do not treat this in-progress document as full visual acceptance.

## r9 history-reader regression and r10 correction

The traced geometry failure is not an SSH timeout. Bash's HTTP history replay completed with a saved 93×31 reader grid. The server subsequently sent an accepted coherent 77×34 snapshot, but the history-reader branch discarded both its pixels and its grid header; the quiet mirror remained at `gridAuthority=pending`. Evidence: `idle-geometry-r9-traced/panel-readiness-failure.json` and screenshot. The independently repeated hard/Panel 7 diagnostic passed, so a single passing case is insufficient.

r10 keeps the stale-capture rejection intact. Only an accepted coherent snapshot emits its own grid header as an independent metadata frame. `TestFreshSnapshotKeepsGeometryAvailableToHistoryReaders` fails on r9 and passes with this correction. The frontend also separates metadata from suppressed pixels: while parsing logical history it retains only the latest grid, then flushes it through the existing anchor-preserving resize path after replay settles. Reader-active state no longer discards geometry permanently. Cleanup clears pending metadata on terminal replacement. Four new helper tests cover delivery, latest-only buffering/copying, superseding old pending geometry and cleanup.

r10 is deployed only to test 9444. Go race/vet, 222 frontend tests, lint/build and all four controlled browser counterexamples pass with the new source (`idle-r10-*.log`, `snapshot-r10-green-final/`). The full candidate-specific geometry gate passes all 39 records (`idle-geometry-r10-traced/results.json`), including both previously failing Bash history-reader refresh scenarios. Native Ctrl+Shift+R passes 10 consecutive zero-input reloads (`claude-idle-r10-native-final/results.json`): actual composer separators are 93 columns at every 3s/6s observation; 1s frames can remain provisional. All nine automatic-fit records pass. The full dynamic matrix failed at hard/Claude composer after 29 passing cases; r10 is not accepted. No production changes.

## Current r10 verification

| Check | Candidate-specific result |
| --- | --- |
| Go race / vet, real isolated tmux suite | PASS; `idle-r10-go-race.log`, `idle-r10-go-vet.log` |
| Frontend unit / lint / build | PASS; 51 files / 222 tests; `idle-r10-ui-*.log`; existing advisory warnings remain |
| Controlled stale/mixed snapshot cases | PASS 4/4; `snapshot-r10-green-final/results.json` |
| Native idle Ctrl+Shift+R | PASS 10 reloads, no post-navigation input; `claude-idle-r10-native-final/results.json`; every 3s/6s actual composer-width check passes |
| Full geometry / dual reload / history | PASS 39/39; `idle-geometry-r10-traced/results.json`, scope `full matrix`, no browser errors |
| Automatic fit, all three terminal types and refresh phases | PASS 9/9; `idle-auto-r10-stable/results.json` |
| Fresh / ordinary / cache-bypass dynamic scenarios | FAIL overall; initial matrix 29 PASS / 1 FAIL, remaining three hard cases PASS separately in `idle-full-r10-hard-rest/report.json` (selected scope). All 33 cases have been executed: 32 PASS / 1 unresolved intermittent FAIL; no reuse of r9 cases |
| Visual review | Selected native hard-reload, large-panel Bash/Claude, fresh history/return, ordinary-refresh Bash repeat/Claude return, and the failing hard-refresh Claude screenshot reviewed. Failing screenshot confirms horizontal clipping/scrollbar and unused bottom space. This is selected artifact review, not full physical visual acceptance. |
| Physical devices / native Windows | NOT RUN; browser emulation and isolated native X11 shortcut tests do not replace these |

The original r8 stale-screen failure and the r9 Bash history-reader failure are retained. Automated acceptance remains pending: the aggregate must fail on the retained full-matrix failure, even though focused reruns pass.

### Intermittent hard-reload composer failure (not resolved)

`idle-full-r10/hard/verify-claude-composer/results.json`: at 2860px, the before frame is the correct 77×34 grid, while the after frame is 104×30, requested grid still 77×34, and horizontal overflow is 243px. The original harness recorded outgoing dimensions from all panels but no incoming per-terminal timeline, so its exact source cannot be proven retrospectively. Assertions are unchanged and this failure remains FAIL.

The selected 2860px rerun (`idle-composer-r10-diagnose/`) and a full three-width composer rerun (`idle-composer-r10-traced-all/`) pass with unchanged product code and new safe grid/action timestamps. A persistent 104-column control attachment to the same Panel 6 session remains after all owned QA browsers close. Its tmux PID was observed as 3007788 (parent sshd-session 3007764; started Sep 29 23:56:59 local). This is evidence of an additional attachment, not proof that it caused the failed frame. No other client's process or connection was detached. Coordinate other test-page usage before assigning a root cause or claiming full acceptance.

The aggregate was explicitly run and correctly failed on the retained full-matrix FAIL (`idle-r10-aggregate-failure.log`); no r10 acceptance artifact was issued. Final binary hash remains `4cac917b56d710df998ef42694770726def2ac9c0d31c3f55fc237ecefb0d753` and `git diff --check` passes. All owned QA runs have finished. User confirmation about other open 9444 tabs/devices has been requested; their active terminal connections are untouched. The remaining work is to explain/reproduce the intermittent 104×30 takeover and rerun acceptance, not to silently count the successful reruns as a root-cause fix.

### 2026-09-30: peer closure, reopening and actual-host verification

User confirmed another 9444 page was open on host 206 and closed it. A read-only test-socket client listing immediately afterwards returned no clients, so the previously persistent attachment disappeared without any forced detach. The r10 application/binary and all assertions remain unchanged. The three-width hard-refresh composer check passes after closure (`idle-composer-r10-after206-closed/`). This is consistent with peer-size interference, but the original failure has no incoming per-client trace, so exclusive retrospective causality remains unproven.

A new complete matrix in `idle-full-r10-after206-closed/` finished FAIL after 18 passing cases and one failing ordinary-refresh composer case; the other 14 cases were not run. The user reopened 9444 on 206 during this run and closed the 87 page, so the directory name does not establish an isolated condition for the whole run. The safe incoming trace shows Panel 6 receiving 102×24, followed by 104×30 while its requested size remained 102×24. The final surface was 930×506 with 940×630 scroll extent. This identifies a reproduced size takeover, but does not yet establish the exact ownership trigger. It does not replace or erase the earlier failure.

The new `verify-dual-host-terminal-geometry.mjs` explicitly keeps two browser contexts focused to approximate independently focused devices, exercises 104×30 vs 77×34 on the same verified Panel 6 identity and rejects unsolicited ownership changes while both are quiet. That script and the planned subsequent ten native no-input reloads are NOT RUN: the user explicitly directed verification in the actual 206 browser instead. No additional local simulated runs are active. This does not require keeping another device closed as a product workaround.

#### Actual 206 browser: blocked before browser actions

SSH access to the Windows 206 host was verified. Its existing loopback OpenCLI service initially reported daemon 1.8.6, connected extension 1.0.24 and profile/context `3u53vj5u`. A loopback-only SSH forward exposed that existing service locally on 19826. No new public listener was created.

An ordinary local OpenCLI browser bind command caused an unintended service shutdown: local CLI 1.8.4 treats a different daemon version as stale, sends `/shutdown`, then tries to start a replacement. Replacement startup failed because the SSH forward already occupied the local port. A subsequent ordinary eval command also failed. The lifecycle behavior was confirmed by reading the installed bridge implementation; ordinary local CLI commands against the forwarded remote service have been stopped. No browser binding, screenshot, refresh or terminal input completed. The remote service now refuses connections. The user was informed of this incident and asked for the original startup command/location so the same service can be restored without installing or replacing software.

Scoped read-only checks did not locate an OpenCLI installation in the checked Windows global npm/cache/common executable paths or the checked WSL package locations. Existing Windows Node processes were browser MCP processes, not the OpenCLI service. No existing Chrome/Edge remote-debugging connection was found at 9222/9223. These checks do not establish that OpenCLI is absent elsewhere. Actual 206 browser verification and native Windows Ctrl+Shift+R remain NOT RUN. Recovery requires the original startup path or a user restart; no guessed installation or unrelated service mutation is authorized.

Test 9444 health still reports `geometry-20260929-r10-snapshot`. Product code, browser windows, user terminal sessions and production 9443 were not restarted or changed during this investigation. No acceptance artifact was issued.

## Supplemental harness failures retained

`idle-auto-r9/results.json` is FAIL: after returning the browser to 1920×1080, Bash Panel 7 was below the viewport (top 1118px, viewport height 1080px), but the harness still expected visible foreground-controller fill. The product intentionally checks viewport intersection. The final supplemental harness scrolls the target back into view before applying the unchanged grid/gap/font assertions; this adds no terminal input or manual Fit. It does not change the native Panel 6 zero-interaction harness.

`idle-auto-r9-visible/results.json` is FAIL: a background-control assertion observed the preceding peer's 102-column grid instead of the 93-column foreground grid during rapid focus handover. That attempt lacked frame tracing, so its exact underlying interleaving is **not proven**. Final readiness now requires 500ms of continuous grid and rendered-size alignment rather than a single matching frame, and records safe send/receive geometry metadata. The background-resize, font, passive-mirror and repeat-focus assertions remain unchanged. No production code changed between these attempts and the final 9-record PASS.
