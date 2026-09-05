#!/usr/bin/env node

if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
  throw new Error('synthetic selection TUI requires a PTY');
}

process.stdin.setRawMode(true);
process.stdin.resume();

let unexpected = '';
let finished = false;

function finish() {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  const encodedUnexpected = Buffer.from(unexpected, 'latin1').toString('hex');
  process.stdout.write(`\x1b[?1000l\x1b[?1006l\x1b[?1049lSYNTHETIC_SELECTION_RESULT unexpected=${encodedUnexpected}\n`);
  process.exit(unexpected === '' ? 0 : 1);
}

process.stdin.on('data', (data) => {
  const input = data.toString('latin1');
  if (input.includes('\x04')) {
    unexpected += input.replace(/\x04/g, '');
    finish();
    return;
  }
  unexpected += input;
});

process.stdout.write('\x1b[?1049h\x1b[2J\x1b[H');
for (let row = 1; row <= 12; row += 1) {
  process.stdout.write(`SYNTHETIC_CLI_SELECT_ROW_${String(row).padStart(2, '0')}_ABCDEFGHIJKLMNOPQRSTUVWXYZ\r\n`);
}
process.stdout.write('\x1b[?1000h\x1b[?1006h');

const timeout = setTimeout(() => {
  unexpected += 'timeout';
  finish();
}, 15_000);
