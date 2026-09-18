# Windows Edge hard-reload green screen

Status: focused fix verified and deployed to test; final browser acceptance pending.

Test 9444 now serves `e388c5a-strict-diagnostic10`, binary SHA256
`ee356c5aa74f4b909b472b0499bd54e0f03f864fc7e8088fea68a1a7f92a4ab7`.
Final local checks: 194 UI tests, lint, production UI build, Go race suite and
vet passed. The final delayed-native-WebSocket browser rerun also passed at
`runtime/incident-20260917-production-tmux/editor-delayed-socket-final/`.
The existing test DB and private tmux server were retained; all 48 pre-deploy
session/pane/PID tuples match after restart. Production PID is unchanged.
Backup and provenance: `runtime/strict-diagnostic10-deploy/`.
This dirty diagnostic build is not a signed-off release. 206 validation and the
full terminal/file-manager delivery matrix remain pending.

Post-deploy Chromium check also passed using actual diagnostic10 assets and
real read-only SFTP (conn2, repository README): initial load plus five browser
reloads restored one persisted editor tab, rendered file content, issued six
reads and no writes, with zero page errors. Layout requests were intercepted
with an isolated empty fixture; terminal sockets were blocked. Evidence:
`runtime/incident-20260917-production-tmux/editor-reload-deployed/report.json`.
The 1200 ms delay applies to ticket HTTP responses, not native WS handshake;
native CONNECTING coverage remains the separate local test. Browser reload
here is not Windows Ctrl+Shift+R, and this does not substitute for 206 feedback.

Focused validation now has real-browser RED/GREEN evidence. The isolated
Chromium fixture mounts the actual editor beside a root sentinel and holds a
native WebSocket handshake for 1500 ms. The HEAD baseline throws the same
CONNECTING error and removes the sentinel; the initial fix retains it, displays
the received file in CodeMirror, and sends one read with zero writes. Artifacts:
`runtime/incident-20260917-production-tmux/editor-delayed-socket-baseline/` and
`runtime/incident-20260917-production-tmux/editor-delayed-socket/`.
This is focused proof, not 206 acceptance or the full application matrix.
Integration review additionally requires dirty-buffer edits made during
reconnection to survive and retain their original revision for conflict checks;
those additional cases are being completed before candidate packaging.

## User-site evidence

On Windows host 206, an existing Edge profile loads production 9443 normally,
while hard reload of test 9444 intermittently leaves only the green page
background. The user supplied an uncaught `InvalidStateError`: WebSocket `send`
was called while CONNECTING, at `FileEditor-VgoEFv6l.js:31:3384`, followed by a
React effect stack and SFTP connection cleanup. Do not reproduce ticket query
strings from the supplied console output in public artifacts.

A read-only fetch of the actual test asset confirms the exact failing location
is the initial file-read effect: `if (!ws) return; ws.send(...)`. Source:
`ui/src/components/common/FileEditor.tsx`. `SftpPanel.tsx` publishes the newly
constructed socket via `setEditorSocket(socket)` before its open event.
Restored open-file tabs can consequently mount before the connection is ready.
The initial read throws from a React effect rather than waiting for connection.
The startup tree currently has no error boundary. This explains a whole-page
failure, not merely empty terminal output. Theme warnings are not the identified
throw site.

## Other checks and their limits

- Both health endpoints currently succeed; this does not prove UI health.
- Initial script and stylesheet GETs repeated three times per environment
  returned 200, correct content types, and identical hashes within each asset.
- Windows 185 independent QA profile completed ten native hard reloads without
  reproducing the problem. It is not equivalent to 206's persisted editor state.
- Existing 206 Edge has no CDP listener. It was not restarted or reconfigured;
  user-provided console evidence was used instead.

## Required regression proof

1. Restore a file editor with a CONNECTING socket whose send method throws just
   as a browser does: no premature read/stat, then one read after open.
2. Replace the socket or unmount before open: stale listeners cannot send.
3. Already-open socket still reads, and listeners are installed before send.
4. Automatic metadata checks skip disconnected sockets without throwing.
5. Explicit saves while disconnected report failure and are never silently
   queued/replayed after reconnect; preserve drafts and revision checks.
6. Real-browser persisted file tabs plus deliberately delayed SFTP handshake,
   repeated hard reload, no page errors and visible workspace/editor content.
7. 206 confirmation on the tested candidate remains required. Unit tests or a
   clean-profile reload alone do not sign off the user's incident.

No production deployment is authorized by this diagnostic report.

## 2026-09-18 non-intrusive 206 recheck

The original Windows 206 console session is active (`pgz`, session 1) and has
active `msedge.exe` processes.  Its remote debugging ports 9222, 9223 and 9335
are not listening.  The SSH service cannot enumerate a usable Edge window title
from that interactive desktop, so this check deliberately did not attach a
debugger, restart Edge, alter its command line, or inject input into the
operator's browser.  It confirms that the historical acceptance gap still
requires an operator-side hard-reload verification on the existing profile;
it is not evidence that the intermittent symptom is fixed or reproduced.

## Current candidate regression evidence

Candidate `e388c5a-strict-diagnostic26-custom-select-a11y` passed both focused
checks on 2026-09-18:

- `runtime/diagnostic26-editor-delayed-current/report.json`: the actual
  `FileEditor` was mounted in Chromium while its native WebSocket handshake was
  deliberately held in `CONNECTING`.  The application root survived, there
  were no page errors or pre-open requests, then the connection emitted one
  read and an auto-refresh stat after open; no write was sent.
- `runtime/diagnostic26-editor-reload-deployed-current/report.json`: the 9444
  deployed asset used a real read-only SFTP connection, restored a persisted
  README editor tab through initial load plus five browser reloads, recorded no
  page errors, and made exactly one read for each load.  The report verifies the
  exact candidate health identity and contains an axe scan.

These are stronger regression evidence for the identified failure mode, but do
not replace the remaining original-206 native hard-refresh acceptance.
