#!/usr/bin/env node

if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
  throw new Error('synthetic selection TUI requires a PTY');
}

process.stdin.setRawMode(true);
process.stdin.resume();

let pendingInput = '';
let unexpected = '';
let acceptedClick = false;
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
  pendingInput += data.toString('latin1');
  if (!acceptedClick) {
    const click = /\x1b\[<0;\d+;\d+M\x1b\[<0;\d+;\d+m/.exec(pendingInput);
    if (click) {
      pendingInput = pendingInput.slice(0, click.index) + pendingInput.slice(click.index + click[0].length);
      acceptedClick = true;
      process.stdout.write('\x1b[14;1HSYNTHETIC_CLI_CLICK_OK');
    }
  }
  if (pendingInput.includes('\x04')) {
    unexpected += pendingInput.replace(/\x04/g, '');
    pendingInput = '';
    finish();
  }
});

process.stdout.write('\x1b[?1049h\x1b[2J\x1b[H');
for (let row = 1; row <= 12; row += 1) {
  process.stdout.write(`SYNTHETIC_CLI_SELECT_ROW_${String(row).padStart(2, '0')}_ABCDEFGHIJKLMNOPQRSTUVWXYZ\r\n`);
}
process.stdout.write('\x1b[?1000h\x1b[?1006h');

const timeout = setTimeout(() => {
  unexpected += pendingInput + 'timeout';
  pendingInput = '';
  finish();
}, 15_000);
