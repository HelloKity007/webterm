// Only creates its own unique fixture socket; never touches WebTerm sockets.
import { spawn, execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const binary = process.env.WEBTERM_QA_TMUX_BINARY;
assert(binary?.startsWith('/'), 'Supply an absolute isolated tmux executable');
const socket = `webterm-qa-churn-${process.pid}`;
const run = (...args) => execFileSync(binary, ['-L', socket, ...args], { encoding: 'utf8' }).trim();
run('-f', '/dev/null', 'new-session', '-d', '-s', 'fixture', 'sleep 3600');
const identity = () => run('display-message', '-pt', 'fixture', '#{pid}:#{pane_pid}:#{session_created}');
const before = identity();
let completed = 0;
try {
  for (let batch = 0; batch < 50; batch++) {
    await Promise.all(Array.from({ length: 8 }, (_, i) => new Promise((resolve, reject) => {
      const child = spawn(binary, ['-L', socket, '-C', 'attach-session', '-t', 'fixture']);
      child.stdout.resume(); child.stderr.resume();
      child.stdin.on('error', () => {});
      child.on('error', reject);
      child.on('close', () => { completed++; resolve(); });
      // Exercise orderly detach and disconnect during identify/initialization.
      if (i % 2) child.stdin.end('detach-client\n');
      else setTimeout(() => child.kill('SIGTERM'), i);
    })));
    assert.equal(identity(), before, 'Server/pane identity changed during churn');
  }
  await mkdir('runtime/tmux-control-churn', { recursive: true });
  const result = { version: run('-V'), socket, before, after: identity(), completed, status: 'PASS' };
  await writeFile('runtime/tmux-control-churn/results.json', JSON.stringify(result, null, 2));
  console.log(result);
} finally {
  // Explicit unique fixture created above, never a user or deployment socket.
  run('kill-session', '-t', 'fixture');
}
