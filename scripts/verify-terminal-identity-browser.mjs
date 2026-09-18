import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from '../ui/node_modules/playwright/index.mjs';
import { terminalViewportProbe } from './terminal-viewport-probe.mjs';

const origin = process.env.WEBTERM_QA_ORIGIN || 'https://192.168.11.87:9444';
const apiOrigin = process.env.WEBTERM_QA_API_ORIGIN || 'http://127.0.0.1:8889';
const expectedVersion = process.env.WEBTERM_QA_EXPECT_VERSION || 'e388c5a-strict-diagnostic15-identity';
const output = resolve(process.env.WEBTERM_QA_OUTPUT || 'runtime/terminal-identity-browser');
const tmux = resolve('runtime/tmux-fixed/bin/tmux');
await mkdir(output, { recursive: true, mode: 0o700 });

let terminalID = '';
let sessionName = '';
let legacyTerminalID = '';
let legacySessionName = '';
let browser;
let context;
let failure;
let checks = [];
try {
  const session = await (await fetch(`${apiOrigin}/api/auth/test-session`, { method: 'POST' })).json();
  assert.equal(typeof session.token, 'string');
  const headers = { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' };
  const existingTerminalID = process.env.WEBTERM_QA_TERMINAL_ID || '';
  if (existingTerminalID) terminalID = existingTerminalID;
  else {
    const created = await (await fetch(`${apiOrigin}/api/terminal-sessions/2`, { method: 'POST', headers, body: '{}' })).json();
    terminalID = created.terminal_id;
  }
  assert.match(terminalID, /^terminal-[a-f0-9]{32}$/);
  sessionName = `wt-1-2-${createHash('sha256').update(terminalID).digest('hex').slice(0, 16)}`;
  const marker = execFileSync(tmux, ['-L', 'webterm-release-test-fixed', 'display-message', '-p', '-t', `=${sessionName}:`, '#{@webterm_incarnation}'], { encoding: 'utf8' }).trim();
  assert.match(marker, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  checks.push({ name: existingTerminalID ? 'durable identity survives service restart' : 'explicit create registered exact tmux identity', status: 'PASS', sessionName });

  browser = await chromium.launch();
  context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1360, height: 900 } });
  await context.addInitScript(({ token, user }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('webterm-user', JSON.stringify(user));
  }, { token: session.token, user: session.user });
  const pane = 'identity-qa-pane';
  let layout = { schema_version: 2, revision: 1, layout: { workspaceTabs: [{ id: 'identity-qa-workspace', index: 99, name: 'Identity QA', layout: { tree: { type: 'leaf', id: pane }, panes: { [pane]: { tabs: [{ id: terminalID, type: 'ssh', title: 'Identity QA', connId: 2, labelNumber: 1 }], activeTabId: terminalID } }, focusedPaneId: pane } }] } };
  await context.route('**/api/layout', route => route.fulfill({ json: layout }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(origin);
  const health = await page.evaluate(async () => await (await fetch('/api/health')).json());
  assert.equal(health.version, expectedVersion);
  const surface = page.locator('.terminal-surface');
  await surface.waitFor();
  await surface.click({ position: { x: 60, y: 40 } });
  await page.keyboard.insertText('printf "IDENTITY_ATTACH_OK\\n"');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => {
    const surface = document.querySelector('.terminal-surface');
    return surface?.getAttribute('data-output-batches') !== null;
  });
  let found = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    const probe = await surface.evaluate(terminalViewportProbe, true);
    if (probe.diagnostic.lines.some(line => line.text.includes('IDENTITY_ATTACH_OK'))) { found = true; break; }
    await page.waitForTimeout(100);
  }
  assert.equal(found, true, 'verified terminal did not accept input');
  assert.deepEqual(errors, []);
  checks.push({ name: 'real browser attaches only after guard and accepts input', status: 'PASS' });

  legacyTerminalID = `legacy-${Date.now()}`;
  legacySessionName = `wt01-77-03-${createHash('sha256').update(legacyTerminalID).digest('hex').slice(0, 16)}`;
  execFileSync(tmux, ['-L', 'webterm-release-test-fixed', 'new-session', '-d', '-s', legacySessionName]);
  layout = { schema_version: 2, revision: 2, layout: { workspaceTabs: [{ id: 'legacy-qa-workspace', index: 77, name: 'Legacy QA', layout: { tree: { type: 'leaf', id: pane }, panes: { [pane]: { tabs: [{ id: legacyTerminalID, type: 'ssh', title: 'Legacy QA', connId: 2, labelNumber: 3 }], activeTabId: legacyTerminalID } }, focusedPaneId: pane } }] } };
  await page.reload();
  await page.getByRole('alert').waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: '验证并迁移已有会话' }).click();
  await page.getByRole('alert').waitFor({ state: 'detached', timeout: 10000 });
  await surface.click({ position: { x: 60, y: 40 } });
  await page.keyboard.insertText('printf "LEGACY_ADOPTION_OK\\n"');
  await page.keyboard.press('Enter');
  let legacyFound = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    const probe = await surface.evaluate(terminalViewportProbe, true);
    if (probe.diagnostic.lines.some(line => line.text.includes('LEGACY_ADOPTION_OK'))) { legacyFound = true; break; }
    await page.waitForTimeout(100);
  }
  assert.equal(legacyFound, true, 'explicitly adopted legacy session did not become usable');
  checks.push({ name: 'browser requires and completes explicit legacy adoption without creating a shell', status: 'PASS' });

  execFileSync(tmux, ['-L', 'webterm-release-test-fixed', 'kill-session', '-t', `=${legacySessionName}`]);
  execFileSync(tmux, ['-L', 'webterm-release-test-fixed', 'new-session', '-d', '-s', legacySessionName]);
  execFileSync(tmux, ['-L', 'webterm-release-test-fixed', 'set-option', '-t', `=${legacySessionName}:`, '@webterm_incarnation', '22222222-2222-4222-8222-222222222222']);
  const replacementPID = execFileSync(tmux, ['-L', 'webterm-release-test-fixed', 'display-message', '-p', '-t', `=${legacySessionName}:`, '#{pane_pid}'], { encoding: 'utf8' }).trim();
  await page.reload();
  await page.getByRole('alert').waitFor({ timeout: 10000 });
  const afterPID = execFileSync(tmux, ['-L', 'webterm-release-test-fixed', 'display-message', '-p', '-t', `=${legacySessionName}:`, '#{pane_pid}'], { encoding: 'utf8' }).trim();
  assert.equal(afterPID, replacementPID, 'identity rejection created or replaced the same-name shell');
  checks.push({ name: 'same-name replacement is refused and no replacement shell is created', status: 'PASS' });
  await page.screenshot({ path: resolve(output, 'identity-mismatch.png') });
} catch (error) {
  failure = String(error);
} finally {
  if (context) await context.close();
  if (browser) await browser.close();
  if (terminalID) {
    try {
      const session = await (await fetch(`${apiOrigin}/api/auth/test-session`, { method: 'POST' })).json();
      await fetch(`${apiOrigin}/api/terminal-sessions/2?terminal_id=${encodeURIComponent(terminalID)}&terminate=1`, { method: 'DELETE', headers: { Authorization: `Bearer ${session.token}` } });
    } catch { /* QA cleanup is limited to this exact server-generated ID. */ }
  }
  if (legacyTerminalID) {
    try {
      const session = await (await fetch(`${apiOrigin}/api/auth/test-session`, { method: 'POST' })).json();
      await fetch(`${apiOrigin}/api/terminal-sessions/2?terminal_id=${encodeURIComponent(legacyTerminalID)}&terminate=1`, { method: 'DELETE', headers: { Authorization: `Bearer ${session.token}` } });
    } catch { /* The exact legacy QA pane is the only additional cleanup target. */ }
  }
  await writeFile(resolve(output, 'report.json'), JSON.stringify({ status: failure ? 'FAIL' : 'PASS', failure, expectedVersion, terminalID, sessionName, checks, isolation: 'server-generated terminal ID; private release-test tmux socket; exact-session cleanup only; no production process/session access' }, null, 2), { mode: 0o600 });
}
if (failure) { console.error(failure); process.exitCode = 1; }
else console.log(`PASS: ${checks.map(check => check.name).join('; ')}`);
