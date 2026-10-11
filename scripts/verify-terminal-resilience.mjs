import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile, stat, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { chromium } from '../ui/node_modules/playwright/index.mjs';

const origin = 'https://192.168.11.87:9444';
const apiOrigin = 'http://127.0.0.1:8889';
const root = resolve('runtime/resilience-20260927');
const db = resolve(process.env.WEBTERM_QA_DB || `${root}/test.db`);
assert(db.includes('/runtime/'), 'test database only');
const binary = resolve('runtime/tmux-fixed/bin/tmux');
const output = resolve(process.env.WEBTERM_QA_OUTPUT || `${root}/browser`);
await mkdir(output, { recursive: true, mode: 0o700 });
const health = await (await fetch(`${apiOrigin}/api/health`)).json();
assert.equal(health.environment, 'release-test');
assert(health.version.includes('resilience'));
const auth = await (await fetch(`${apiOrigin}/api/auth/test-session`, { method: 'POST' })).json();
const headers = { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' };
const created = [];
let browser;
const checks = [];
let failure;
function row(id) {
  assert.match(id, /^terminal-[a-f0-9]{32}$/);
  return JSON.parse(execFileSync('sqlite3', ['-readonly', '-json', db, `select * from terminal_instances where terminal_id='${id}'`], { encoding: 'utf8' }))[0];
}
function tmux(instance, ...args) {
  assert.equal(instance.environment, 'release-test');
  assert(instance.socket.startsWith(`${homedir()}/.local/state/webterm/webterm-release-test/`));
  return execFileSync(binary, ['-N', '-S', instance.socket, ...args], { encoding: 'utf8' }).trim();
}
function inventory(instance) { return tmux(instance, 'display-message', '-p', '-t', `=${instance.canonical_name}:`, '#{pid} #{pane_pid} #{session_id} #{@webterm_incarnation}'); }
try {
  for (let i = 0; i < 2; i++) {
    const response = await fetch(`${apiOrigin}/api/terminal-sessions/2`, { method: 'POST', headers, body: '{}' });
    assert.equal(response.status, 200, await response.clone().text());
    const { terminal_id } = await response.json(); created.push(terminal_id);
  }
  const [a, b] = created.map(row);
  assert.notEqual(a.socket, b.socket);
  assert.equal(tmux(a, 'display-message', '-p', '-t', `=${a.canonical_name}:`, '#{history_limit}|#{window-size}|#{status}|#{mouse}|#{exit-unattached}'), '200000|largest|off|1|0');
  checks.push('new private server has explicit history, mouse, persistence and largest-grid settings');
  const before = inventory(b);
  assert.notEqual(inventory(a).split(' ')[0], before.split(' ')[0]);
  checks.push('two explicit creations have independent servers and registered sockets');
  browser = await chromium.launch();
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1360, height: 900 }, recordVideo: { dir: output } });
  await context.addInitScript(({ token, user }) => { localStorage.setItem('token', token); localStorage.setItem('webterm-user', JSON.stringify(user)); }, auth);
  const panes = {};
  for (const [i, id] of created.entries()) panes[`resilience-${i}`] = { tabs: [{ id, type: 'ssh', title: `Resilience ${i + 1}`, connId: 2, labelNumber: i + 1 }], activeTabId: id };
  let layout = { schema_version: 2, revision: 1, layout: { workspaceTabs: [{ id: 'resilience-workspace', index: 99, name: 'Disposable resilience QA', layout: { tree: { type: 'split', direction: 'horizontal', ratios: [0.5, 0.5], children: [{ type: 'leaf', id: 'resilience-0' }, { type: 'leaf', id: 'resilience-1' }] }, panes, focusedPaneId: 'resilience-0' } }] } };
  await context.route('**/api/layout', async route => {
    if (route.request().method() === 'PUT') { const next = route.request().postDataJSON(); layout = { ...next, revision: layout.revision + 1 }; }
    await route.fulfill({ json: layout });
  });
  const page = await context.newPage();
  let sshSockets = 0;
  const modes = [];
  const faults = [];
  page.on('websocket', ws => {
    if (!ws.url().includes('/ws/ssh/')) return;
    sshSockets++;
    ws.on('framereceived', ({ payload }) => { try { const msg = JSON.parse(String(payload)); if (msg.type === 'terminal_mode') modes.push(msg); if (msg.type === 'error') faults.push(msg); } catch {} });
  });
  await page.goto(origin);
  await page.waitForFunction(() => document.querySelectorAll('.terminal-surface[data-output-batches]').length === 2, null, { timeout: 15000 });
  for (let attempt = 0; attempt < 100 && modes.length < 2; attempt++) await page.waitForTimeout(100);
  assert(modes.length >= 2, JSON.stringify({ faults, sshSockets }));
  await page.screenshot({ path: `${output}/before.png` });
  const localSurface = page.locator('.terminal-surface').first();
  const originalFont = Number(await localSurface.getAttribute('data-fitted-font-size'));
  assert(originalFont > 0);
  const peer = await context.newPage();
  let peerModes = 0;
  peer.on('websocket', ws => { if (ws.url().includes('/ws/ssh/')) ws.on('framereceived', ({ payload }) => { try { if (JSON.parse(String(payload)).type === 'terminal_mode') peerModes++; } catch {} }); });
  await peer.setViewportSize({ width: 3440, height: 1440 });
  await peer.goto(origin);
  for (let attempt = 0; attempt < 100 && peerModes < 2; attempt++) await page.waitForTimeout(100);
  assert(peerModes >= 2);
  await page.waitForTimeout(800);
  assert(Number(await localSurface.getAttribute('data-fitted-font-size')) >= originalFont, 'isolated server peer attachment shrank local font');
  assert.equal(inventory(b), before);
  await page.screenshot({ path: `${output}/isolated-small-with-peer.png` });
  await peer.screenshot({ path: `${output}/isolated-large-peer.png` });
  await peer.close();
  checks.push('large peer attaches to both isolated sessions without shrinking the small display font or changing process identity');
  const pid = Number(inventory(a).split(' ')[0]);
  // This exact PID was read from a socket created by this test only.
  process.kill(pid, 'SIGABRT');
  await page.getByText('终端服务不可达', { exact: true }).waitFor({ timeout: 30000 });
  assert(faults.some(f => f.code === 'TERMINAL_SERVER_UNAVAILABLE' && f.retryable === false));
  const connections = sshSockets;
  await page.waitForTimeout(2500);
  assert.equal(sshSockets, connections, 'confirmed loss kept reconnecting');
  assert.equal(inventory(b), before, 'peer identity changed after crash');
  const backend = await fetch(`${apiOrigin}/api/terminal-health/2?terminal_id=${a.terminal_id}`, { headers });
  assert.equal(backend.status, 503);
  assert.equal((await backend.json()).fault.code, 'TERMINAL_SERVER_UNAVAILABLE');
  const peerHealth = await fetch(`${apiOrigin}/api/terminal-health/2?terminal_id=${b.terminal_id}`, { headers });
  assert.equal(peerHealth.status, 200, await peerHealth.clone().text());
  checks.push('SIGABRT: correct fault, retries stop, peer PID/identity unchanged, authenticated health 503 versus 200');
  await page.screenshot({ path: `${output}/crashed.png` });
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    const retry = page.getByRole('button', { name: '重新检查原会话' });
    await retry.scrollIntoViewIfNeeded();
    const bounds = await retry.boundingBox();
    assert(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height, 'fault recovery action clipped on mobile');
    await page.screenshot({ path: `${output}/fault-${viewport.width}.png` });
  }
  await page.setViewportSize({ width: 1360, height: 900 });
  checks.push('fault recheck action remains visible in portrait and landscape mobile viewports');
  await page.getByRole('button', { name: '重新检查原会话' }).click();
  await page.getByText('终端服务不可达', { exact: true }).waitFor();
  assert.equal(sshSockets, connections + 1);
  checks.push('explicit retry rechecks original identity without creating a replacement');
  for (const phase of ['normal', 'hard']) {
    if (phase === 'hard') { const cdp = await context.newCDPSession(page); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }); }
    await page.reload();
    await page.getByText('终端服务不可达', { exact: true }).waitFor();
    assert.equal(inventory(b), before);
    await page.screenshot({ path: `${output}/${phase}.png` });
  }
  checks.push('normal and cache-disabled reload preserve loss status and healthy peer identity');
  const newResponse = page.waitForResponse(r => r.url().includes('/api/terminal-sessions/2') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '新建独立终端（不恢复原进程）' }).click();
  const replacement = (await (await newResponse).json()).terminal_id;
  created.push(replacement);
  assert.notEqual(replacement, a.terminal_id);
  assert.notEqual(row(replacement).socket, a.socket);
  assert.equal(inventory(b), before);
  checks.push('explicit new terminal receives a new ID/socket; original identity is retained');
  const crashDir = `${homedir()}/.local/state/webterm/cores-release-test/${a.socket.split('/').at(-1)}`;
  assert.match(await readFile(`${crashDir}/binary-version.txt`, 'utf8'), /tmux 3\.7c/);
  const coreName = (await readdir(crashDir)).find(name => /^core(?:\.[0-9]+)?$/.test(name));
  assert(coreName, 'no private core dump collected');
  const core = await stat(`${crashDir}/${coreName}`);
  assert(core.size > 0 && core.size <= 256 * 1024 * 1024);
  checks.push(`private bounded core collected (${core.size} bytes) with binary version/hash; no content exported`);
  await page.screenshot({ path: `${output}/new-terminal.png` });
  await context.close();
} catch (error) { failure = String(error); }
finally {
  if (browser) await browser.close();
  for (const id of created) {
    const instance = row(id);
    try { tmux(instance, 'kill-server'); } catch { /* already crashed */ }
    await fetch(`${apiOrigin}/api/terminal-sessions/2?terminal_id=${id}&terminate=1`, { method: 'DELETE', headers });
  }
  await writeFile(`${output}/report.json`, JSON.stringify({ status: failure ? 'FAIL' : 'PASS', health, checks, failure, terminalIDs: created, isolation: 'disposable isolated release-test sessions; browser layout intercepted; no production mutations' }, null, 2));
}
if (failure) { console.error(failure); process.exitCode = 1; } else console.log(checks.join('\n'));
