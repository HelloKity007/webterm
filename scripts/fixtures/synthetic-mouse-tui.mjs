#!/usr/bin/env node

if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
  throw new Error('synthetic mouse TUI requires a PTY');
}

process.stdin.setRawMode(true);
process.stdin.resume();

let pending = '';
let wheelEvents = 0;
let unexpected = '';
let finished = false;

function finish() {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  const encodedUnexpected = Buffer.from(unexpected, 'latin1').toString('hex');
  process.stdout.write(`\x1b[?1000l\x1b[?1006l\x1b[?1049lSYNTHETIC_MOUSE_RESULT wheel=${wheelEvents} unexpected=${encodedUnexpected}\n`);
  process.exit(wheelEvents === 100 && unexpected === '' ? 0 : 1);
}

function consume() {
  pending = pending.replace(/\x1b\[<(64|65);\d+;\d+[Mm]/g, () => {
    wheelEvents += 1;
    return '';
  });
  if (pending.includes('\x04')) {
    unexpected += pending.replace(/\x04/g, '');
    pending = '';
    finish();
    return;
  }

  // Keep a possible partial SGR report for the next chunk. Everything before
  // the last ESC is definitely unrelated input and is reported as pollution.
  const lastEscape = pending.lastIndexOf('\x1b');
  if (lastEscape < 0) {
    unexpected += pending;
    pending = '';
  } else if (lastEscape > 0) {
    unexpected += pending.slice(0, lastEscape);
    pending = pending.slice(lastEscape);
  }
}

process.stdin.on('data', (data) => {
  pending += data.toString('latin1');
  consume();
});

process.stdout.write('\x1b[?1049h\x1b[2J\x1b[H');
for (let i = 1; i <= 120; i += 1) {
  process.stdout.write(`SYNTHETIC_CLI_HISTORY_${String(i).padStart(3, '0')}\r\n`);
}
process.stdout.write('\x1b[?1000h\x1b[?1006hSYNTHETIC_MOUSE_READY\r\n');

const timeout = setTimeout(() => {
  unexpected += 'timeout';
  finish();
}, 10_000);
