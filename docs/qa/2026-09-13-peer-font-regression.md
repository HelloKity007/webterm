# Peer attachment changes local font — FAIL

User restored Claude in Panel 6. Test candidate remains `5008923`; no implementation deployment or session cleanup performed in this run.

`xvfb-run -a node scripts/verify-peer-font-stability.mjs` used headed Chrome, opened 1920×1080 first then 3440×1440, selected actual Panel 6 and captured both. No keys entered into the terminal; no history commands, cleanup or restart performed.

| Small panel | Before peer | After peer |
| --- | --- | --- |
| Surface | 935×511 | 935×511 |
| Server grid | 104×31 | 104×32 |
| Fitted font | 12.2598876953125 | 11.66937255859375 |

New assertion fails correctly. Previous comparisons grouped by server grid and therefore excluded exactly this regression. Artifacts: `runtime/peer-font-stability/results.json`, `small-before.png`, `small-after.png`, `large.png`.

tmux server/session-creation/pane-process identity before and after: `3684038:1789291952:3709158:claude`, unchanged.

Cause: shared `window-size largest` changes the application grid on peer attachment; `fitTerminalFont` then changes local font to keep every server row simultaneously visible. Caching unchanged geometry does not prevent this because the fitting key also includes server rows/columns. Pinning the old font without changing the viewport would crop the composer/statusline; reducing only local rows reintroduces ANSI coordinate corruption. Neither is an acceptable fix.

Proposed product decision: retain local font based on local geometry and use an independently scrollable viewport over the exact server grid, following the composer at the bottom and exposing all rows (and, where needed, columns) through local scrolling. This changes the previous “all server rows visible at once” behavior and requires explicit user agreement on that tradeoff. No claim that this display-mode change has been implemented or accepted.
