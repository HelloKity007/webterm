# Workspace Tab close — test deployment and acceptance

## Verdict

The workspace-close interaction and the complete repository-defined terminal
visual matrix pass on test 9444. The final uninterrupted run completed 33/33
cases: 11 scenarios after fresh load, normal reload and cache-bypassing reload.
Representative screenshots and six two-display recordings were reviewed with
no observed blank flash, scale jump, clipping or lost Claude composer/statusline.

Deployed application: `157373e9032a48883255d07627b99a51ddea7966`,
<https://192.168.11.87:9444/>. Development remains in the main repository on
`dev-1.0.4`, without worktrees. Production 9443 was read-only checked and still
reports `2df868a6df91c99365116b47a683df240b617b6e`. No production deployment or
push was performed. Later evidence/harness-only commits do not change the
deployed application.

## Implemented behavior

- Workspace and Panel close buttons share the same 14×14 transparent component.
- Confirmation names the workspace, counts all nested session tabs, and warns
  that Shell/Claude processes will be terminated irreversibly. Cancel does nothing.
- Confirmation closes inactive and hidden child sessions as well as visible ones.
- Partial remote failure preserves the workspace and shows a retry message;
  already terminated processes cannot be recovered.
- Closing an inactive workspace preserves the current workspace's terminal DOM.
- A Panel added by another peer during closing is retained and needs a new
  confirmation. Duplicate local submissions are blocked during the operation.
- Closing the final workspace creates a new empty workspace with new identities;
  it stays empty after reload.
- Explicit termination can bypass test-session preservation only on the isolated
  test tmux socket. The default socket remains protected when preservation is on.
- Per-terminal backend locking prevents stale peers from reopening explicitly
  closed IDs during the backend lifetime. These markers are in memory, not a
  durable cross-restart revocation list; the saved layout removes closed references.

## Feature evidence on the deployed candidate

All directories below are under the repository's ignored `runtime/` directory.
Each includes `results.json` and before/after screenshots.

| Run | Evidence directory | Result |
| --- | --- | --- |
| Desktop | `729b196-workspace-close` | PASS |
| Pixel 7 emulation | `729b196-workspace-close-mobile` | PASS, not a physical phone |
| Peer adds a Panel during close | `729b196-workspace-close-concurrent` | PASS |
| Normal reload | `729b196-workspace-close-normal` | PASS |
| Cache-bypassing reload | `729b196-workspace-close-hard` | PASS |

The runner creates a throwaway test account, starts four real SSH sessions
(including inactive tabs), and verifies cancellation, injected HTTP 502, retry,
peer layout convergence, final-workspace persistence and process exit. The
concurrent case starts a fifth session. It checks all recorded pane/foreground
PIDs have exited and closed sessions have not reappeared after five seconds.
Only the runner's own account and exact session IDs are cleaned up. Existing
user workspaces are not closed. Panel 6's original QA identity is preserved:
`1814767:1819403:claude` (server PID / pane PID / command).

OpenCLI inspected the actual user's Chrome at 2860×988 CSS pixels, DPR 1.203125:
both close controls measured 14×14 with a transparent background. Reviewed image:
`runtime/729b196-workspace-close/opencli-desktop.png`. No destructive close was
confirmed in the user's existing account. Desktop/mobile fixture screenshots
were also reviewed. A prior 28px pill-style inheritance defect was corrected
before this candidate; the earlier `3d1b6e8` run is superseded, not final evidence.

Build checks: 126 UI tests, UI lint/build, `go test -count=1 ./...`, and handler
race tests passed. The updated QA runners pass Node syntax checks.

## Final full visual matrix

Final report: `runtime/157373e-full-visual-gate/report.json`, 33 PASS and zero
FAIL. It covers idle SSH visibility, peer-font stability, repeated current/other
tab switches, Panel movement, two simultaneous displays, held/repeated Bash and
Claude input without submitting a command, Claude history/composer return,
mobile portrait, mobile landscape and workspace close.

The earlier `729b196` normal-refresh failure remains preserved as historical RED.
It compared shared PTY rows for equality even though another attached display is
allowed to renegotiate rows. The corrected gate keeps the user-visible invariants
strict: unchanged local pane geometry and font, valid server grid, no overlap,
and complete returned composer/statusline. This is an acceptance correction,
not deletion of the historical result.

The intermediate two-column display now chooses the largest complete local
font without changing the 104-column remote grid or stretching glyphs. Playwright
at 2860×988 measured 23.35px and 44px right remainder; OpenCLI on the user's
actual Chrome at 2860×988/DPR 1.203125 measured 23.57px and 17px remainder.
Previously this remainder was about 460px. At 1920 and 3440 the accepted local
font remains about 15px; same-geometry frame analysis found zero font changes.

Mobile coverage now includes Pixel 7 portrait/landscape and iPhone 13 portrait
in every load phase. Panel selection, overflowing Panel-tab touch scrolling,
non-overflowing final-tab selection, wrapped output width, landscape Claude
history touch scrolling, native input canvas bounds and blur on returning to
reading mode all passed. The earlier phone-landscape defect (single Panel with
hidden switcher/reader above 700px) is fixed.

OpenCLI actual-Chrome evidence is
`runtime/157373e-full-visual-gate/opencli-actual-chrome.png`; console capture had
zero messages. Video contact sheets are under
`runtime/157373e-full-visual-gate/review/`. Test health is the exact candidate;
production remained `2df868a` throughout. Panel 6 retained
`1814767:1819403:claude`.

## Acceptance boundary

- This is PASS for the implemented test-environment feature and the complete
  executable regression matrix. Pixel/iPhone runs are browser emulations; a
  physical Android/iOS IME cannot be honestly relabelled as automated PASS.
  User physical-device review remains the final human confirmation, not a known
  automated failure. No formal pixel-diff baseline or full WCAG audit was in scope.
- OpenCLI actual Chrome is complete. browser-use still cannot attach because the
  user's Chrome has no available remote-debugging endpoint; Playwright headed
  Chrome supplied the automated cross-browser runs. No browser setting was
  silently changed and no user's browser was restarted.
- Production promotion is not authorized. The candidate is ready for manual
  review on 9444; 9443 remains unchanged.
