#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const socket = `webterm-cli-${randomBytes(6).toString('hex')}`;
const fixture = fileURLToPath(new URL('./fixtures/synthetic-mouse-tui.mjs', import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function tmux(args, options = {}) {
  return execFileSync('tmux', ['-L', socket, '-f', '/dev/null', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

function attach(sessionName) {
  const child = spawn('script', [
    '-qfec',
    `TERM=xterm-256color tmux -L ${socket} -f /dev/null attach-session -t ${sessionName}`,
    '/dev/null',
  ], {
    env: { ...process.env, TERM: 'xterm-256color' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString('latin1'); });
  child.stderr.on('data', (chunk) => { output += chunk.toString('latin1'); });
  return { child, output: () => output };
}

function configureWebTermMouse(sessionName) {
  tmux(['set-option', '-t', sessionName, 'mouse', 'on']);
  tmux(['set-option', '-t', sessionName, '@webterm_mouse_passthrough', 'on']);
  tmux([
    'bind-key', '-n', '-T', 'root', 'WheelUpPane',
    'if-shell', '-F', '#{&&:#{@webterm_mouse_passthrough},#{mouse_any_flag}}',
    'send-keys -M',
    'if-shell -F "#{pane_in_mode}" "send-keys -M" "copy-mode -e; send-keys -M"',
  ]);
}

async function waitFor(check, message, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await sleep(25);
  }
  throw new Error(message);
}

async function verifyShellHistory() {
  // history-limit is copied when a tmux window is created, so configure the
  // isolated server before creating the shell pane (matching WebTerm).
  tmux(['start-server', ';', 'set-option', '-g', 'history-limit', '200000', ';', 'new-session', '-d', '-s', 'shell', 'bash --noprofile --norc']);
  // Reproduce the user's legacy binding that omitted mouse_any_flag. The
  // WebTerm wrapper must fix tagged sessions without changing its fallback.
  tmux(['bind-key', '-n', '-T', 'root', 'WheelUpPane', 'if-shell', '-F', '#{pane_in_mode}', 'send-keys -M', 'copy-mode -e; send-keys -M']);
  configureWebTermMouse('shell');
  tmux(['send-keys', '-t', 'shell', "seq -f 'WEBTERM_HISTORY_%05g' 1 5000", 'Enter']);
  await waitFor(
    () => tmux(['capture-pane', '-p', '-S', '-', '-t', 'shell']).includes('WEBTERM_HISTORY_05000'),
    'shell did not produce 5,000 history markers',
  );
  const history = tmux(['capture-pane', '-p', '-S', '-', '-t', 'shell']);
  if (!history.includes('WEBTERM_HISTORY_00001') || !history.includes('WEBTERM_HISTORY_05000')) {
    throw new Error('tmux did not retain the full shell marker range');
  }

  const client = attach('shell');
  await sleep(300);
  client.child.stdin.write(Buffer.from('\x1b[<64;10;10M'.repeat(20), 'latin1'));
  await waitFor(
    () => tmux(['display-message', '-p', '-t', 'shell', '#{pane_in_mode}']).trim() === '1',
    'wheel did not enter tmux copy mode for shell history',
  );
  client.child.stdin.write(Buffer.from('q', 'latin1'));
  await waitFor(
    () => tmux(['display-message', '-p', '-t', 'shell', '#{pane_in_mode}']).trim() === '0',
    'q did not exit tmux copy mode',
  );
  client.child.stdin.write(Buffer.from("printf '__WEBTERM_COMPOSER_SAFE__\\n'\r", 'latin1'));
  await waitFor(
    () => tmux(['capture-pane', '-p', '-S', '-', '-t', 'shell']).includes('__WEBTERM_COMPOSER_SAFE__'),
    'shell did not accept input after leaving history mode',
  );
  const afterWheel = tmux(['capture-pane', '-p', '-S', '-', '-t', 'shell']);
  if (afterWheel.includes('[<64;') || afterWheel.includes('[<65;')) {
    throw new Error('raw SGR mouse bytes leaked into the shell composer');
  }
  client.child.stdin.write(Buffer.from('\x02d', 'latin1'));
  await waitFor(() => client.child.exitCode !== null, 'shell tmux client did not detach');
  return Number(tmux(['display-message', '-p', '-t', 'shell', '#{history_size}']).trim());
}

async function verifyMouseTui() {
  tmux(['new-session', '-d', '-s', 'tui', `node ${JSON.stringify(path.resolve(fixture))}`]);
  configureWebTermMouse('tui');
  const client = attach('tui');
  await waitFor(() => client.output().includes('SYNTHETIC_MOUSE_READY'), 'synthetic TUI did not become ready');

  const reports = Array.from({ length: 100 }, (_, index) => (
    `\x1b[<${index % 2 === 0 ? 64 : 65};10;10M`
  )).join('');
  client.child.stdin.write(Buffer.from(reports + '\x04', 'latin1'));
  await waitFor(() => client.output().includes('SYNTHETIC_MOUSE_RESULT'), 'synthetic TUI did not report its result');
  await waitFor(() => client.child.exitCode !== null, 'synthetic TUI client did not exit');

  const result = /SYNTHETIC_MOUSE_RESULT wheel=(\d+) unexpected=([0-9a-f]*)/.exec(client.output());
  if (!result || Number(result[1]) !== 100 || result[2] !== '') {
    throw new Error(`mouse protocol verification failed: ${result?.[0] || 'missing result'}`);
  }
}

try {
  const historySize = await verifyShellHistory();
  await verifyMouseTui();
  process.stdout.write(`${JSON.stringify({ shellMarkers: 5000, historySize, mouseReports: 100, rawComposerBytes: 0 })}\n`);
} finally {
  try { tmux(['kill-server']); } catch { /* isolated server may already be gone */ }
}
