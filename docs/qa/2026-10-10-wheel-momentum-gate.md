# Wheel momentum gate: data-driven fix for Magic Mouse scrolling

Status: production-verified by the user on 9443, release `b8ebccf`. The
temporary numeric wheel diagnostics were removed after verification; the
captured evidence below is retained under `runtime/wheel-diag-20261010/`.

## Symptom

A Magic Mouse flick scrolled a Claude CLI panel a variable, huge distance —
sometimes to the end of the history — while a Windows wheel mouse scrolled a
stable 3 lines per notch. Later rounds also showed the inverse failures
(Bash jumping to the top of its local buffer; a direction going permanently
unscrollable until an opposite-direction swipe).

## Root causes, one per round

1. **Round 1 — UA-based platform gate never fired.** 957 captured events,
   523 entered the CLI SGR path, 0 suppressed. A cumulative 120px budget
   re-emitted repeatedly inside one momentum stream. Platform detection used
   `navigator.userAgent`, which never matched the user's browser. A second
   defect shipped in the same capture: after a reconnect snapshot xterm had
   no alternate-screen state, so 400 `terminal_mode=cli` events were routed
   to the Bash local-history scroller (1200 lines of local scrollback).
2. **Round 2 — `navigator.platform` is `Win32`.** The multi-signal detection
   was correctly convinced the browser is not macOS: the Magic Mouse is
   attached to Windows. 284/284 events emitted. Platform detection is
   structurally unable to classify this hardware combination.
3. **Round 3 — magnitude cannot classify momentum.** A ≥50px pass-through
   rule suppressed 2699/2987 events, but fast flicks cross 50px per event:
   262 large momentum events all passed, producing emitted runs of 45–103
   notches in one gesture.
4. **Round 4 — per-gesture hard cap chained into a stuck direction.** The
   cap was released only by idle or reversal; a momentum tail plus the next
   same-direction swipe kept the gesture alive indefinitely, so one
   direction stopped scrolling until an opposite swipe reset it.

## Final model

`createTerminalWheelNotchGate` in `ui/src/components/terminal/terminalCliSupport.ts`:

- **Discrete notches** — integer deltas that are exact multiples of ±100 or
  ±120 — always pass, in any burst, and anchor the gesture.
- **Everything else is momentum** regardless of platform or magnitude.
  Momentum travel is distance-proportional: one notch (3 lines) per 100px
  accumulated, first event immediate.
- A **token bucket** bounds bursts: 6 notches available, refilling at 6 per
  second continuously. Throttled events consume no travel, so a refill can
  never replay a backlog; a direction can never get stuck because the
  bucket refills during the very stream that exhausted it. A sustained
  drag (~5 notches/s) stays under the refill rate and never throttles.
- Gesture boundaries: 150ms idle, direction reversal, or Shift change.
- Both the CLI SGR path and the shell-history path share the gate; an
  ungated momentum stream scrolls a Bash panel to the top of its buffer.
- `terminal_mode=cli` is authoritative for alternate-screen routing after
  a snapshot replay (fixes cause 1's misrouting).

## Evidence

- `runtime/wheel-diag-20261010/round1-ua-gate-never-fired.json` — 0/523
  suppressed, 400 misrouted shell-history events, 5/6-px quantization.
- `round2-win32-platform.json` — platform `Win32|other`, 284/284 emitted.
- `round3-magnitude-gate.json` — 2699 suppressed but 262 large momentum
  events emitted (runs up to 103).
- Unit tests: momentum proportionality, burst cap, stuck-direction
  regression, quantum bursts, reversal, non-quantum integers, tail-after-
  quantum (`terminalCliSupport.test.ts`, 15 cases).

User verification rounds on 9444 (diag2–diag6 builds) converged to PASS on
flicks, drags, reversals, repeated same-direction swipes, and both the
Claude CLI and Bash panels.
