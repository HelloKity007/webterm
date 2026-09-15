import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
// The release test endpoint intentionally uses the LAN development
// certificate. Keep this exception local to the test runner.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const health = () => JSON.parse(execFileSync('curl', ['-ks', 'https://192.168.11.87:9444/api/health'], { encoding: 'utf8' }));
const candidate = health(); assert.equal(candidate.environment, 'release-test');
const origin = process.env.WEBTERM_QA_URL || 'https://192.168.11.87:9444';
const tmuxBinary = process.env.WEBTERM_QA_TMUX_BINARY || `${process.cwd()}/runtime/tmux-fixed/bin/tmux`;
const tmuxSocket = process.env.WEBTERM_QA_TMUX_SOCKET || 'webterm-release-test-fixed';
const root = process.env.WEBTERM_QA_OUTPUT || `runtime/visual-gate-${candidate.version.slice(0, 7)}`;
await mkdir(root, { recursive: true });
const report = { candidate, cases: [], status: 'RUNNING' };
const cases = ['verify-idle-shell-visibility', 'verify-peer-font-stability', 'verify-terminal-switch-stability', 'verify-cross-pane-move', 'verify-terminal-two-display', 'verify-shell-repeat', 'verify-claude-repeat', 'verify-claude-composer', 'verify-mobile', 'verify-mobile-landscape', 'verify-workspace-close'];
const phases = process.env.WEBTERM_QA_PHASES?.split(',') || ['fresh', 'normal', 'hard'];
assert(phases.length > 0 && phases.every(phase => ['fresh', 'normal', 'hard'].includes(phase)), 'Invalid QA phase selection');
report.phases = phases;
report.scope = phases.length === 3 && new Set(phases).size === 3 ? 'full matrix' : 'selected phases only';

async function api(path, options = {}) {
  const response = await fetch(`${origin}${path}`, options);
  const text = await response.text();
  assert(response.ok, `${options.method || 'GET'} ${path} returned ${response.status}: ${text.slice(0, 240)}`);
  return text ? JSON.parse(text) : null;
}

function assertRestorableWorkspace(response) {
  assert.equal(response?.schema_version, 2, 'release fixture must use workspace layout schema v2');
  assert.equal(response?.skipped_tabs, 0, 'release fixture has inaccessible saved terminal tabs');
  assert(Array.isArray(response?.layout?.workspaceTabs) && response.layout.workspaceTabs.length > 0,
    'release fixture has no restorable workspaces');
  for (const workspace of response.layout.workspaceTabs) {
    assert(Number.isSafeInteger(workspace.index) && workspace.index > 0, 'workspace index is invalid');
    assert(workspace.layout?.tree && workspace.layout?.panes && Object.keys(workspace.layout.panes).length > 0,
      `workspace ${workspace.name || workspace.id} has no restorable panel layout`);
  }
}

const testSession = await api('/api/auth/test-session', { method: 'POST' });
const authHeaders = { Authorization: `Bearer ${testSession.token}`, 'Content-Type': 'application/json' };
const readFixture = async () => {
  const fixture = await api('/api/layout', { headers: authHeaders });
  assertRestorableWorkspace(fixture);
  return fixture;
};
const baseline = await readFixture();
const baselineLayout = JSON.stringify({ schema_version: baseline.schema_version, layout: baseline.layout });
report.fixture = { workspaces: baseline.layout.workspaceTabs.map(({ id, index, name, layout }) => ({ id, index, name, panels: Object.keys(layout.panes).length })) };

async function restoreFixtureIfChanged() {
  const current = await readFixture();
  if (JSON.stringify({ schema_version: current.schema_version, layout: current.layout }) === baselineLayout) return;
  await api('/api/layout', { method: 'PUT', headers: authHeaders, body: JSON.stringify({
    schema_version: baseline.schema_version, revision: current.revision, layout: baseline.layout,
  }) });
  const restored = await readFixture();
  assert.equal(JSON.stringify({ schema_version: restored.schema_version, layout: restored.layout }), baselineLayout,
    'visual case changed the shared release fixture and rollback did not restore it');
  throw new Error('visual case changed the shared release fixture; it was rolled back and marked failed');
}

for (const phase of phases) {
  for (const name of cases) {
    assert.equal(health().version, candidate.version, 'Candidate changed mid-acceptance');
    await restoreFixtureIfChanged();
    const path = `${root}/${phase}/${name}`; await mkdir(path, { recursive: true });
    console.log(`START ${phase} ${name}`);
    const started = Date.now(); let log = '';
    const code = await new Promise((resolve, reject) => {
      const child = spawn('xvfb-run', ['-a', 'node', `scripts/${name}.mjs`], { env: {
        ...process.env, WEBTERM_QA_RELOAD: phase, WEBTERM_QA_OUTPUT: path,
        WEBTERM_QA_TMUX_BINARY: tmuxBinary, WEBTERM_QA_TMUX_SOCKET: tmuxSocket,
      } });
      child.stdout.on('data', data => { log += data; }); child.stderr.on('data', data => { log += data; });
      child.on('error', reject); child.on('close', resolve);
    });
    await writeFile(`${path}/runner.log`, log);
    let fixtureError = null;
    try { await restoreFixtureIfChanged(); } catch (error) { fixtureError = error instanceof Error ? error.message : String(error); }
    report.cases.push({ phase, name, status: code === 0 && !fixtureError ? 'PASS' : 'FAIL', elapsedMs: Date.now() - started, path, fixtureError });
    console.log(`${code === 0 ? 'PASS' : 'FAIL'} ${phase} ${name}`);
    if (code !== 0 || fixtureError) { report.status = 'FAIL'; await writeFile(`${root}/report.json`, JSON.stringify(report, null, 2)); throw new Error(fixtureError || `Failed ${phase}/${name}; evidence ${path}/runner.log`); }
    await writeFile(`${root}/report.json`, JSON.stringify(report, null, 2));
  }
}
report.status = 'PASS (automated matrix only; requires visual artifact review and physical-device disclosure)';
await writeFile(`${root}/report.json`, JSON.stringify(report, null, 2));
