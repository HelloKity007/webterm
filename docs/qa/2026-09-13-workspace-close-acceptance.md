# Workspace Tab close — test deployment and acceptance

## Verdict

The new workspace-close interaction passed its scoped end-to-end checks on
test 9444. **The overall terminal visual release gate is NOT ACCEPTED.**
An intermittent normal-refresh composer assertion and shared-grid whitespace
remain unresolved; scoped feature PASS does not override those findings.

Deployed application: `729b196198cd5250279f2619c0a8089837cbb1e1`,
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

Build checks: 125 UI tests, UI lint/build, `go test -count=1 ./...`, and handler
race tests passed. The updated QA runners pass Node syntax checks.

## Broader regression findings — do not hide failures with retries

`runtime/729b196-visual-gate/report.json` records nine fresh-load case passes,
seven normal-reload case passes, then a FAIL in `verify-claude-composer`.
At 2860×988, shared rows changed 24→22 between the pre-scroll and returned
measurements. Font stayed 16px and the reviewed returned screenshot retained
the input and statusline. Root cause has not been established; external peer
geometry is a possibility, not a proven explanation.

An unchanged-assertion recheck passed all three widths in
`runtime/729b196-composer-normal-recheck/`. It does not erase the original FAIL.
That recheck also measured right gaps of 94px at 1920, 460px at 2860 and 8px at
3440. Thus "not clipped" cannot be reported as full/maximized fill acceptance.
Representative two-display Claude screenshots retain input/statusline, but
they do not prove absence of every transient flicker or full-history correctness.

The subsequent hard-refresh matrix completed all ten cases successfully,
recorded separately in `runtime/729b196-hard-gate/report.json` (automated checks
only). The initially skipped normal-refresh mobile case also passed in
`runtime/729b196-mobile-normal-completion/`. The full runner now includes
workspace close (10 cases × 3 phases).
`WEBTERM_QA_PHASES` supports explicitly labelled phase-only reruns; these are
never equivalent to an uninterrupted full matrix.

## Remaining acceptance boundaries

- Resolve the intermittent shared-row failure and excessive intermediate-width
  whitespace, then repeat the full matrix for any new application candidate.
- Complete visual review of dynamic recordings, populated CLI history and
  physical Android/iOS keyboard/touch behavior. Mobile emulation is not a
  physical-device signoff; no pixel-baseline comparison was completed.
- OpenCLI is connected; browser-use was not connected to the user's Chrome
  (`DevToolsActivePort` unavailable). The requested dual-tool acceptance is
  therefore incomplete. No browser restart or remote-debugging setting change
  was silently performed.
- Production promotion is not authorized. The close feature is available on
  9444 for manual review, not a declaration that the complete release is ready.
