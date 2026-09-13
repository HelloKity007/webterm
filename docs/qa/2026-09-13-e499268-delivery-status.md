# e499268 delivery status — NOT ACCEPTED

## Follow-up: authorized Claude fixture

User authorized a dedicated acceptance conversation. Test Panel 6 now runs
`WebTerm-visual-QA`, Claude session `efa6ee62-e7ba-4087-b223-a9bb97867999`,
in `runtime/claude-visual-fixture`. This is NOT recovery of the lost conversation.
Built-in tools were disabled at launch; no QA prompt has been submitted.
Existing user startup hooks report a JSON-format warning; user-level settings
were not modified to conceal it.

Fresh peer-font check passed (small font 14.9991455078125 unchanged as shared
rows change 31→36); server/session/pane identity stayed
`1814767:1789303500:1819403:claude`. Continuous input of 160 keys at 1920 and
3440 passed, with draft restored and no Enter submitted. Evidence:
`runtime/e499268-claude-approved/{peer,repeat}/`.
Remaining Claude history/drag/refresh/visual matrix and browser-use connection
are still pending. This supersedes the unapproved-fixture status below, not
the full acceptance verdict.

Test deployment: `e499268a1d561764c7c755aaf17054b8025a0e37`, 9444.
Production remains `2df868a6df91c99365116b47a683df240b617b6e`, 9443.
Main repository / dev-1.0.4 only. No worktree, production change or push.

## Changes

- Independent test tmux 3.7c executable and `webterm-release-test-fixed` socket;
  old socket retained, system executable unchanged. Details and upstream sources:
  [tmux control crash](2026-09-13-tmux-control-crash.md).
- Input follows the cursor only when necessary, not the bottom of unused rows.
  Pending-input tracking prevents background cursor activity from taking over
  the history viewport.
- Idle Bash fits keep the prompt visible when another display changes shared
  rows. CLI entry retains its separate bottom-follow behavior, pending real
  Claude validation.

## Verified evidence

- 123 UI tests; lint/build; Go tests; handler race test passed.
- 400 isolated control-client churn operations preserved server and pane identity.
- `570df98` idle-shell regression FAILED before the fix: the cursor was above
  the visible viewport. `runtime/570df98-idle-baseline/`.
- Current idle-shell regression passes three simultaneous widths (1920, 3440,
  2860), including unchanged local fonts as peers join. No keyboard focus/input
  is used to conceal the initial blank-panel failure.
- OpenCLI screenshot on actual Chrome, 2860×988 CSS pixels, DPR 1.203125:
  `runtime/e499268-partial/opencli-desktop.png`. Reviewed: visible Bash prompts;
  earlier blank viewport in `runtime/570df98-partial/opencli-desktop.png`.
- Automated non-Claude matrix artifacts: `runtime/e499268-partial/`, separated
  into `fresh`, `normal`, `hard`. Includes idle shells, 240 repeated Bash keys
  at both sizes with draft restoration, retained terminal DOM across switches,
  five cross-pane move/return cycles for panel 5 and panel 6, and mobile smoke.
  Panel 6 currently runs Bash: its generic move test is NOT Claude acceptance.
  Runner exited 0 after all 15 case invocations (5 cases × 3 reload phases).
  This is PASS for those automated checks only, not the complete visual gate.

## Blocking / not verified

1. Original Panel 6 Claude process was lost in the prior tmux crash. User choice
   requested: create a dedicated acceptance conversation or manually restore the
   original. Neither has been silently done. Full Claude input/statusline,
   history, scrolling, peer-font and refresh matrix remains NOT RUN.
2. browser-use is available via `uvx browser-use` (harness 0.1.13), but local
   daemon startup failed: `DevToolsActivePort not found`. Current Chrome needs
   `chrome://inspect/#remote-debugging` enabled by the user. No cloud account is
   required for local control, and no user's browser was restarted/replaced.
   [Official connection instructions](https://github.com/browser-use/browser-harness/blob/main/install.md).
3. Mobile results are headed Chrome Pixel 7 emulation, with simulated viewport
   transitions, NOT physical Android/iOS keyboard acceptance.
4. Absence of every transient blank frame/flicker and full history accessibility
   has NOT been proven by the structural checks. Final screenshots or preserved
   DOM alone do not establish that requirement. Full dynamic visual review and
   populated real-CLI history scenarios remain required.

## Next execution

After the two user-dependent conditions above are resolved, run:

```
WEBTERM_QA_TMUX_BINARY="$PWD/runtime/tmux-fixed/bin/tmux" node scripts/run-terminal-visual-gate.mjs
```

The gate now includes idle-prompt visibility and rejects font changes even when
the server grid changes at fixed local dimensions. It still requires reviewed
visual artifacts and real-browser evidence; successful process exit is not
equivalent to full acceptance. Any code fix requires a new test-only candidate
and a fresh full matrix. Do not promote to production without new approval.
