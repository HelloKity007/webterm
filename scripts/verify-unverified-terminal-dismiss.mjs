import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '../ui/node_modules/playwright/index.mjs';

const origin = process.env.WEBTERM_QA_ORIGIN || 'https://192.168.11.87:9444';
const apiOrigin = process.env.WEBTERM_QA_API_ORIGIN || 'http://127.0.0.1:8889';
const expectedVersion = process.env.WEBTERM_QA_EXPECT_VERSION || '';
const output = resolve(process.env.WEBTERM_QA_OUTPUT || 'runtime/unverified-terminal-dismiss');
await mkdir(output, { recursive: true, mode: 0o700 });

let browser;
let context;
let failure;
const report = { status: 'RUNNING', expectedVersion, checks: [], isolation: 'fresh browser context; read-only connection lookup; all layout routes are intercepted; the explicit new-panel POST is mocked; no terminal create, adoption, input, or remote-process mutation' };
try {
  const sessionResponse = await fetch(`${apiOrigin}/api/auth/test-session`, { method: 'POST' });
  assert.equal(sessionResponse.ok, true, 'test-session endpoint failed');
  const session = await sessionResponse.json();
  const connectionsResponse = await fetch(`${apiOrigin}/api/connections`, { headers: { Authorization: `Bearer ${session.token}` } });
  assert.equal(connectionsResponse.ok, true, 'connection lookup failed');
  const connections = await connectionsResponse.json();
  const connection = connections.find(candidate => Number.isInteger(candidate.id));
  assert(connection, 'a readable test connection is required');
  const terminalID = `unverified-dismiss-${Date.now()}`;
  const pane = 'dismiss-qa-pane';
  let layout = { schema_version: 2, revision: 1, layout: { workspaceTabs: [{ id: 'dismiss-qa-workspace', index: 98, name: 'Dismiss QA', layout: { tree: { type: 'leaf', id: pane }, panes: { [pane]: { tabs: [{ id: terminalID, type: 'ssh', title: 'Unverified dismiss QA', connId: connection.id, labelNumber: 1 }], activeTabId: terminalID } }, focusedPaneId: pane } }] } };
  browser = await chromium.launch();
  context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1360, height: 900 } });
  await context.addInitScript(({ token, user }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('webterm-user', JSON.stringify(user));
  }, { token: session.token, user: session.user });
  await context.route('**/api/layout', route => route.fulfill({ json: layout }));
  const replacementID = `terminal-safe-replacement-${Date.now()}`;
  await context.route('**/api/terminal-sessions/*', route => {
    if (route.request().method() === 'POST') return route.fulfill({ json: { terminal_id: replacementID } });
    return route.continue();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(origin, { waitUntil: 'networkidle' });
  const health = await page.evaluate(async () => await (await fetch('/api/health')).json());
  if (expectedVersion) assert.equal(health.version, expectedVersion);
  await page.getByRole('alert').waitFor({ timeout: 10000 });
  report.checks.push({ name: 'unregistered layout tab reaches the identity guard', status: 'PASS' });
  await page.getByRole('button', { name: '从布局移除（保留远端会话）' }).click();
  await page.waitForFunction(id => !document.querySelector(`[data-tab-id="${id}"]`), terminalID);
  assert.deepEqual(errors, []);
  report.checks.push({ name: 'identity guard directly dismisses only the unverified local layout tab', status: 'PASS' });

  const blockedTerminalID = `unverified-new-panel-${Date.now()}`;
  layout = { schema_version: 2, revision: 2, layout: { workspaceTabs: [{ id: 'dismiss-qa-workspace', index: 98, name: 'Dismiss QA', layout: { tree: { type: 'leaf', id: pane }, panes: { [pane]: { tabs: [{ id: blockedTerminalID, type: 'ssh', title: 'Unverified new Panel QA', connId: connection.id, labelNumber: 1 }], activeTabId: blockedTerminalID } }, focusedPaneId: pane } }] } };
  const replacementPage = await context.newPage();
  const replacementErrors = [];
  replacementPage.on('pageerror', error => replacementErrors.push(String(error)));
  await replacementPage.goto(origin, { waitUntil: 'networkidle' });
  await replacementPage.getByRole('alert').waitFor({ timeout: 10000 });
  await replacementPage.getByRole('button', { name: '新建安全 Panel（保留旧会话）' }).click();
  await replacementPage.waitForFunction(({ oldID, newID }) => !document.querySelector(`[data-tab-id="${oldID}"]`) && Boolean(document.querySelector(`[data-tab-id="${newID}"]`)), { oldID: blockedTerminalID, newID: replacementID });
  assert.deepEqual(replacementErrors, []);
  report.checks.push({ name: 'identity guard offers an explicit mocked safe new Panel path without touching the legacy tab', status: 'PASS' });
} catch (error) {
  failure = String(error);
} finally {
  if (context) await context.close();
  if (browser) await browser.close();
  report.status = failure ? 'FAIL' : 'PASS';
  report.failure = failure;
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
}
if (failure) { console.error(failure); process.exitCode = 1; }
else console.log(`PASS: ${report.checks.map(check => check.name).join('; ')}`);
