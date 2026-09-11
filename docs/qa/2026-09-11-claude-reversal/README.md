# Claude bottom reversal and resize regression

Deployed test source: b30837df4c56f6ba956c5cd9b2b64c048109d51b.
URL: https://192.168.11.87:9444/. Main repository; no worktree or production deployment.

User clarified that per-notch three-line scrolling is acceptable; remaining issues
are long stalls reversing from the bottom and missing lower-screen composer.

## Changes

- Fit now measures native dimensions without temporarily resizing the active
  alternate buffer. The old fit() intermediate shrink could discard bottom rows.
- Wheel delivery holds only the latest notch, replacing unfinished reports.
  Direction reversal immediately sends the new direction instead of waiting
  behind an unbounded queue. Disposal cancels pending reports.
- Bash local scrolling is unchanged.

## Actual browser checks (browser-qa)

Opencli attached to Chrome; CDP wheel events in Claude panel 6. Test auto-login
remained enabled. Existing pending composer text was preserved; no prompt was submitted.

1. Scrolled downward 150 times to the actual end (latest FINAL_KEYBOARD_OK response).
2. At 1280x720, sent 40 additional down events, immediately reversed up: visible
   terminal buffer changed upward in 98ms. See reverse-at-bottom.json.
3. Resized back to 1920x1080, repeated the bottom/down-burst/reversal check:
   upward buffer change in 94ms. See reverse-at-bottom-1920.json.
4. Inspected resize-1280.png and resized-back.png: composer and bottom status
   rows visible at both sizes. No transient native fit resizing is used anymore.
5. 77 UI tests, eslint, TypeScript/Vite build, Go tests and deployment health passed.
   Added fake-timer regression for 100 down notches followed immediately by up,
   with no stale down deliveries and cleanup cancellation.

Timing measures first changed xterm buffer, not a pixel presentation benchmark.
These are targeted desktop-browser checks, not mobile-touch, accessibility or
whole-product acceptance. The original unavailable-composer symptom was not
reproduced on the already-open 1920 tab before modification; the unsafe intermediate
buffer shrink was identified in code and removed, then both resized screenshots checked.
browser-use was not available; no claim that it ran. User manual review remains pending.

Verdict: targeted checks passed; ready for user review in their original browser.
