# Terminal geometry implementation and evidence

Candidate: `geometry-20260929-r7`, built from the existing dirty main checkout plus this task's changes; not a committed release. Test URL: `https://192.168.11.87:9444`. Binary SHA-256: `b6fbdccdc401ee4488b9c695983dda8fe00ae7057103d4b0a4cac227c8ec109d`.

## Implemented behavior

- Desktop font size comes from local preference. Capacity uses rendered cell dimensions, including a post-paint remeasurement when WebGL/font metrics change. Removed the frontend and backend 87/104-column program caps and the desktop font/spacing fitting loops.
- One native surface scrollbar spans xterm history plus a larger shared live frame. xterm retains exact server coordinates; a history spacer and public `scrollToLine` mapping expose the full range without a second inner rail. Input follow includes a fullscreen footer when it fits alongside the cursor. Background output does not take a restored history reader back to the bottom.
- Server-side geometry leases are keyed by authenticated user/connection/terminal. The first dimension requester controls the shared PTY; joins do not resize it. A 15-second disconnect grace preserves ownership through reload. Overlapping old sockets cannot revoke their replacements. After grace, a waiting client's last measured size is applied.
- The accessible **适配 / Fit** button and context-menu action explicitly transfer size control. Keyboard input remains shared independently. A smaller mirror retains its font and can navigate the complete frame; it is not claimed to independently reflow the same TUI.
- Verified tmux attachment sets manual window sizing and removes only WebTerm's indexed legacy `[200]` hooks. Real tmux tests demonstrated that otherwise a legacy `client-attached` hook restored `largest` after attachment, bypassing the new policy. Unrelated `[201]` hooks remain intact.
- Mobile ANSI parsing follows the actual announced server grid; its wrapped reader keeps its local readable font and its own mobile requested size. This prevents parsing a desktop frame using a different phone-only column count.

## Verification

| Check | Status / evidence |
| --- | --- |
| UI suite | PASS: 49 files, 214 tests; `runtime/geometry-20260929/ui-tests-final.log` |
| ESLint, TypeScript/Vite build | PASS; existing large-chunk build advisory remains |
| Go suite with race detector, vet | PASS; `runtime/geometry-20260929/go-race-final.log` |
| Real isolated tmux legacy-hook migration / exact identity | PASS; `runtime/geometry-20260929/legacy-hook-test.log`; legacy-hook reproduction and unrelated-hook preservation are covered in test source |
| Ownership unit tests | PASS: peers, explicit takeover, reconnect/expiry, failed writes, separate keys, overlapping sockets, concurrent requests |
| Real-browser scroll adapter | PASS at DPR 1 and 2.625; `runtime/geometry-viewport/` and `runtime/geometry-20260929/viewport-dpr2625/`; five history/live-frame cycles, alternate composer/footer, background-output history anchor, video/screenshots |
| Final candidate dynamic matrix | PASS: 11 cases × fresh/normal/hard reload = 33; all attempts and resolved harness failures retained in `runtime/geometry-20260929/acceptance.json` |
| Final candidate dedicated geometry / dual-peer reload matrix | PASS: 39 measurements, zero browser page errors; `runtime/geometry-20260929/browser-r7-final/results.json`; includes 12 dual-peer reload combinations |
| Physical phones / physical display DPR | NOT RUN; browser emulation is reported separately |

Earlier r3/r4 geometry passes are development evidence only, not substitutes for final-candidate acceptance. They measured 3440-wide Codex/Claude/Bash grids with 3px right margin and 16px local fonts across fresh/normal/hard reload. r1 exposed a missing post-WebGL remeasurement; r2's harness sampled before initial output and renderer readiness and was corrected. Their failures/evidence remain in `runtime/geometry-20260929/`.

Final r7 controller measurements at a 3440×1440 browser viewport: Codex 93×34 cells, 3px right and 6px bottom remainder; Claude and Bash 93×31 cells, 3px right and 11px bottom remainder. These are the actual split-panel capacities, not the full browser width. All three use 16px local fonts. Additional 1920×1080 and 2860×988 peers preserve font size and explicitly take control for their own fill checks. Final screenshots were inspected alongside the assertions. `node scripts/summarize-terminal-geometry-gate.mjs` validates all 33 final case results, all 39 geometry records, zero page errors, and equal initial/settled reload font sizes; it passed. Final binary hash, test health/version and `git diff --check` were verified.

The r4/r6 full matrix runs were deliberately stopped to incorporate history/footer/mobile and legacy-hook corrections. They are incomplete; the in-flight cross-pane test was allowed to restore its fixture before replacing r6.

## Test adaptations and limitations

Existing visual checks now assert the single **surface** history rail rather than requiring xterm's old inner rail at a fixed 2px grid offset. The two-display test distinguishes a navigable mirror from the dimension controller; it explicitly takes control for large-screen fill assertions. These correspond to the user-approved viewport tradeoff, not a relaxed font/fill target for the controlling display.

The Claude repeat-input test preserves a pre-existing draft and first requires the cursor at its end. It appends a known suffix, never presses Enter, deletes only its exact suffix, and compares the restored draft. Other fixture restoration and identity protections remain in force.

Two fresh-load harness failures are retained in the reports: the mobile check still required a fixed 69-column native buffer despite the approved exact-server-grid model; its replacement compares against the actual WebSocket grid announcement while retaining reader-font and clipping checks. The workspace-close fixture initially lacked `WEBTERM_QA_DB` and probed the legacy socket instead of the test database's isolated sockets; rerunning with the correct fixture environment passed. Temporary test sessions were cleaned by the API. The mobile-landscape harness now applies the requested normal/hard reload phase instead of silently running fresh each time.

The first hard-reload Claude-repeat attempt also failed: its 40-key screenshot is blank before terminal attachment, and only the subsequent 120 characters reached the live draft. The harness used a fixed one-second wait. It now requires actual terminal output, renderer readiness and an authoritative server grid before typing; the exact 160-character assertion remains unchanged. The 120 residual QA characters were removed only after checking the exact original 109-character draft plus the known suffix and cursor position; the original draft was verified after cleanup. Partial-suffix cleanup now also runs on future failed assertions. An intermediate harness revision incorrectly checked mode `claude` rather than the actual enum `cli` and timed out before typing; corrected, the hard-reload repeat test passed. Evidence is retained under `full-gate-r7-reloads/`, `full-gate-r7-hard-rest/` and `full-gate-r7-hard-rest2/`.

The initial dedicated dual-reload run (`browser-r7/results.json`) failed by sampling a transient 80-column frame before font metrics and local geometry settled. The final harness (`browser-r7-final/`) retains that first-frame measurement, then requires the controller and mirror to return to the exact pre-reload grid without another Fit action, within the normal browser assertion timeout. Reproduction captured initial 80-column frames with still-changing local requested columns, followed by automatic recovery to the original grid. Initial and final font sizes must match. This acceptance covers settled geometry and stable font size, not absence of every startup reflow or immediate input readiness during attachment.

No production service, production database or production tmux process was modified. Existing unrelated checkout edits were preserved; no broad commit or clean-worktree deployment was performed. The normal release helper requires a clean committed checkout, so this development candidate was built separately and launched using the existing test-service arguments, database and terminal processes. The test-only launcher validates the exact prior candidate command before replacing it; it does not target the production service. This is test acceptance, not a production release approval.
