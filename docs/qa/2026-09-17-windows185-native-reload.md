# Windows 185 native reload investigation

Scope: user-requested Windows reproduction against test 9444. This is not a
production release, an application fix, or full terminal acceptance.

## Environment

- Host: SSH alias `185`, Windows `DESKTOP-N150`, interactive admin console.
- Independent QA Edge profile/task: `WebTermStrictQA-20260917-232747`.
  Existing personal browser processes are not used or terminated.
- Browser: Edge 152.0.4191.66, Windows user agent.
- Candidate: `e388c5a-strict-diagnostic9`, environment `release-test`.
- Native maximized window, no emulated viewport. Measured CSS screen 1920x1080,
  outer window 1920x1032, inner viewport 1912x948, devicePixelRatio 2 and visual
  viewport scale 1. DPR is not by itself proof of the browser zoom setting.

## Test-driver defect found and repaired

Earlier Windows key attempts were invalid: `WScript.Shell.AppActivate` selected
`Windows.Internal.Shell.TabProxyWindow`, whose title matched the QA page. OS
SendInput accepted events but the page neither received keys nor navigated.

Evidence before correction: `runtime/windows-native-reload-focus/report.json`.
The helper now enumerates visible windows, requires exactly one QA-titled
`Chrome_WidgetWin_1`, activates that HWND and verifies it is foreground before
sending any key. It still checks the unlocked input desktop and rejects held
physical modifiers. No firewall, UAC, desktop security or OS keyboard policies
were changed.

Evidence after correction: `runtime/windows-native-reload-real-window/report.json`.
F5, Ctrl+R and Ctrl+Shift+R each caused a verified main-frame navigation on
9444's health page. Accepted input counts alone are never treated as success.
This repairs the QA driver, not WebTerm.

## Panel 2 targeted pilot

Command:

```sh
WEBTERM_QA_NATIVE_PLATFORM=windows WEBTERM_QA_PANELS=2 \
WEBTERM_QA_KEYS=Control+Shift+R WEBTERM_QA_ROUNDS=3 \
WEBTERM_QA_HISTORY_POSITION=middle \
WEBTERM_QA_OUTPUT=runtime/windows185-panel2-middle-native \
node scripts/verify-native-history-reload.mjs
```

Three native hard reloads completed. All retained actual visible history text,
geometry and distance from bottom (903 lines), before navigation and after
reconnect. There were respectively 199, 196 and 193 pre-unload buffer samples.
Rendered Windows screencasts contain 56, 54 and 58 frames with timestamps.
All three pilot contact sheets were visually inspected: no pre-navigation
bottom jump was observed. A normal application loading screen and empty panels
occur during document reload; those are not being mislabeled as continuous
rendering or full no-blank-frame acceptance.

Artifacts: `runtime/windows185-panel2-middle-native/report.json`, before/after
screenshots, per-case `*-frames/manifest.json` and JPEG frames. CDP screencasts
may coalesce compositor frames; they supplement, not replace, buffer sampling.

## Expanded run

The first expanded run, `runtime/windows185-middle-hard-repeat/`, stopped after
seven passing Panel 2 cases. Case eight failed in the QA driver: Get-Content
raced Set-Content while the result file still had an exclusive Windows writer.
This is a retained infrastructure FAIL, not a terminal failure or a completed
20-case run. The helper now writes a unique `.pending` result and publishes it
with Move-Item after the writer closes. It does not retry keyboard input.

A new independent run, `runtime/windows185-middle-hard-repeat2/`, targeted Panel
2 and Panel 14, history middle, 10 native Ctrl+Shift+R repetitions each. It
terminated with **FAIL**, not a 20-case pass:

- Panel 2 completed all 10 cases. All visible history lines, geometry and
  relative scroll position matched before navigation and after reconnect.
- Panel 14 stopped on its first case. Its 22 visible lines, viewportY=1098,
  outerTop=0 and grid=104x22 remained identical, including numbered anchors
  000548/000549/000550. However baseY increased from 2001 to 2002 and therefore
  fromBottom increased from 903 to 904. All 191 pre-unload samples matched.
- This is a failed buffer-distance invariant; it is **not evidence of a
  visible jump to bottom**. Determine whether an added live/replay row or a
  history-capture boundary explains it before changing the expectation. The
  failure is retained and no assertion has been weakened.
- The remaining nine planned Panel 14 repetitions did not run. No all-panel,
  Chrome, alternate zoom, or complete Windows release acceptance is implied.

`scripts/render-native-reload-videos.mjs` converts frame manifests to MP4 using
their actual capture timestamps, preserving the raw evidence. Pilot videos are
available alongside their corresponding `*-frames` directories.

The decisive outcome of this turn is valid native Windows keyboard navigation
and reproducible evidence, not an application repair. Panel 2's reported
intermittent bottom flash was not reproduced in this bounded Windows run.

No application source or runtime binary was changed for this investigation.
No user draft was submitted and no production service was modified.
