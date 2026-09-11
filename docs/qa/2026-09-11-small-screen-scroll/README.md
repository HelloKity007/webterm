# Small-screen and mouse-wheel verification

Test deployment: `882fa433e25e6032970752b7d881f4468a54a01a` at https://192.168.11.87:9444/.
Main repository, branch `dev-1.0.3`; no worktree. No production 9443 deployment.

Used browser-qa with opencli attached to real Chrome and CDP mouse events.
browser-use was unavailable; this is not a claim that both tools ran.
Test auto-login was active. No new login-password acceptance claim.

## Results

- 1920x1080 desktop viewport: all eight terminal surfaces measured 471px high;
  xterm screen now 464px instead of 290px. Small-window sizing uses innerWidth,
  not physical monitor width. The final few pixels are covered by the panel wheel handler.
- Actual xterm scrollbar: 5px wide, rgba(143,189,145,0.5), previously 14px.
- Bash panel 1: one upward wheel at 92% panel height moved viewportY 1150 -> 1147.
  One downward wheel at 99.5% height moved 1147 -> 1150, even with deltaY=900.
- Claude panel 6: history now responds over the footer/lower edge, using native
  SGR wheel reports instead of PageUp/PageDown. However, strict three-line
  acceptance FAILS: the final up test changed CLAUDE_SECOND_012 -> 010, and
  down changed 010 -> 012 (two lines). Earlier trials moved three lines.
  The installed Claude native executable contains wheel acceleration and a
  pendingFlip direction filter that can discard an initial reverse event.
  Sending three reports is therefore NOT proof of three displayed rows.
- Earlier 3440x1440 regression screenshot is included as large-after.png,
  from a1882ba before wheel normalization; not a final-version large-screen PASS.
- UI tests 76/76, eslint, TypeScript/Vite build, Go tests and test-deploy health passed.

## Evidence and limitations

final-before.json, final-up.json, final-down.json contain all eight panels' DOM
dimensions and xterm visible rows. final-small.png shows the deployed final UI.
small-before.png and small-after.png show the sizing change at earlier revisions.
The QA script defaults to one real CDP wheel event; its target session ID is ephemeral.

Current small-screen glyphs remain small (approximately 7.65px for the shared
104-column grid). Filling the lower region does not establish typography/readability PASS.
No fresh full keyboard, mobile-touch, dual-screen, accessibility or complete SDLC acceptance
is claimed by this narrowly scoped run. Existing history output was reused without new
commands or changes to users' Claude preferences/sessions.

Verdict: DO NOT SHIP as a fully accepted fix. Bash three-line behavior and lower-surface
interaction are ready for manual review; Claude strict three-line behavior remains open.
