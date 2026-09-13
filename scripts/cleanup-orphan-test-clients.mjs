// Detach confirmed orphan test transports, never persistent terminal sessions.
// Dry-run by default. Production sockets are intentionally not configurable.
import { execFileSync } from 'node:child_process';
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
if (process.argv.includes('--apply')) throw new Error('Cleanup disabled pending investigation of the 2026-09-13 test-session recreation. Read-only audit only.');
const candidates = run('ps', ['-eo', 'pid,ppid,args']).split('\n').flatMap(line => {
  const match = line.match(/^\s*(\d+)\s+1\s+tmux -L webterm-release-test -C attach-session -t (wt01-[\w-]+)$/);
  return match ? [{ pid: match[1], session: match[2] }] : [];
});
const clients = run('tmux', ['-L', 'webterm-release-test', 'list-clients', '-F', '#{client_name}']).split('\n');
const verified = candidates.filter(c => clients.includes(`client-${c.pid}`));
console.log(JSON.stringify({ apply: process.argv.includes('--apply'), count: verified.length, clients: verified }, null, 2));
if (process.argv.includes('--apply')) {
  const before = run('tmux', ['-L', 'webterm-release-test', 'list-sessions', '-F', '#{session_name}']);
  for (const c of verified) {
    // Recheck parent and command immediately before detaching the exact client.
    const current = run('ps', ['-p', c.pid, '-o', 'ppid=,args=']);
    if (current !== `1 tmux -L webterm-release-test -C attach-session -t ${c.session}`) continue;
    run('tmux', ['-L', 'webterm-release-test', 'detach-client', '-t', `client-${c.pid}`]);
    // Orphans can be stuck waiting for their vanished SSH pipe and cannot
    // finish the detach handshake. Terminate that validated client process,
    // never the tmux server or its pane child (Bash/Claude).
    process.kill(Number(c.pid), 'SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 100));
    try {
      if (run('ps', ['-p', c.pid, '-o', 'ppid=,args=']) === current) process.kill(Number(c.pid), 'SIGKILL');
    } catch { /* Already exited. */ }
  }
  const after = run('tmux', ['-L', 'webterm-release-test', 'list-sessions', '-F', '#{session_name}']);
  if (before !== after) throw new Error('Session list changed during orphan cleanup; investigate');
  console.log('Persistent session names unchanged. No history cleared.');
}
