import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = createRequire(import.meta.url)('../ui/node_modules/playwright');
const origin = 'https://192.168.11.87:9444';
const output = process.env.WEBTERM_QA_OUTPUT || 'runtime/workspace-close-qa';
await mkdir(output, { recursive: true });
const binary = `${process.cwd()}/runtime/tmux-fixed/bin/tmux`;
const tmux = args => execFileSync(binary, ['-L', 'webterm-release-test-fixed', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const originalClaude = tmux(['display-message', '-pt', 'wt01-01-06-ee8f330da4330735', '#{pid}:#{pane_pid}:#{pane_current_command}']);
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: false, args: ['--no-sandbox'] });
const admin = await browser.newContext({ ignoreHTTPSErrors: true });
let fixtureUser, userToken, adminToken;
const tabIDs = Array.from({ length: 4 }, () => `qa-close-${randomUUID()}`);
const report = { checks: [], originalClaude, dialogs: [] };
const api = async (method, path, data, token = userToken) => {
  const response = await admin.request.fetch(origin + path, { method, data, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  assert(response.ok(), `${method} ${path.split('?')[0]} returned ${response.status()}`);
  return response.json();
};
const pad = n => String(n).padStart(2, '0');
const sessionName = i => `wt${pad(fixtureUser)}-${i === 3 ? '02' : '01'}-${pad(i === 3 ? 1 : i + 1)}-${createHash('sha256').update(tabIDs[i]).digest('hex').slice(0, 16)}`;
const exists = i => { try { tmux(['has-session', '-t', sessionName(i)]); return true; } catch { return false; } };
const waitFor = async (predicate, message) => {
  for (let i = 0; i < 50; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 200)); }
  throw new Error(message);
};
try {
  const health = await api('GET', '/api/health'); assert.equal(health.environment, 'release-test'); report.candidate = health.version;
  const adminPage = await admin.newPage(); await adminPage.goto(origin, { waitUntil: 'networkidle' });
  adminToken = await adminPage.evaluate(() => localStorage.getItem('token')); assert(adminToken);
  const username = `qa-close-${randomUUID()}`; const password = randomUUID();
  fixtureUser = (await api('POST', '/api/users', { username, password, role: 'admin' }, adminToken)).id;
  assert(fixtureUser > 1);
  const login = await api('POST', '/api/auth/login', { username, password }); userToken = login.token; assert(userToken);
  const tab = i => ({ id: tabIDs[i], type: 'ssh', connId: 2, title: `QA close ${i + 1}`, labelNumber: i === 3 ? 1 : i + 1 });
  const pane = ids => ({ tabs: ids.map(tab), activeTabId: tabIDs[ids[0]] });
  const layout = { workspaceTabs: [
    { id: 'qa-workspace-one', index: 1, name: '关闭验收甲', layout: { tree: { type: 'split', direction: 'horizontal', ratio: 0.5, children: [{ type: 'leaf', id: 'qa-left' }, { type: 'leaf', id: 'qa-right' }] }, panes: { 'qa-left': pane([0, 1]), 'qa-right': pane([2]) }, focusedPaneId: 'qa-left' } },
    { id: 'qa-workspace-two', index: 2, name: '关闭验收乙', layout: { tree: { type: 'leaf', id: 'qa-last' }, panes: { 'qa-last': pane([3]) }, focusedPaneId: 'qa-last' } },
  ] };
  const saved = await api('GET', '/api/layout');
  await api('PUT', '/api/layout', { schema_version: 2, revision: saved.revision, layout });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
  await context.addInitScript(({ token, user }) => { localStorage.setItem('token', token); localStorage.setItem('webterm-user', JSON.stringify(user)); }, { token: userToken, user: { id: fixtureUser, username, role: 'admin' } });
  const page = await context.newPage(); await page.goto(origin, { waitUntil: 'networkidle' });
  await page.locator('.workspace-tabs-toggle').click();
  await page.locator(`[data-tab-id="${tabIDs[1]}"]`).click();
  await waitFor(() => [0, 1, 2].every(exists), 'Fixture sessions did not start');
  await page.getByRole('tab', { name: '2: 关闭验收乙', exact: true }).click();
  await waitFor(() => exists(3), 'Last workspace fixture did not start');
  await page.getByRole('tab', { name: '1: 关闭验收甲', exact: true }).click();
  const peer = await context.newPage(); await peer.goto(origin, { waitUntil: 'networkidle' });
  await peer.locator('.workspace-tabs-toggle').click();
  const closeOne = page.getByRole('button', { name: '关闭工作区: 1: 关闭验收甲', exact: true });
  page.once('dialog', async dialog => { report.dialogs.push(dialog.message()); await dialog.dismiss(); });
  await closeOne.click(); assert([0, 1, 2, 3].every(exists));
  report.checks.push('cancel leaves all sessions intact');
  await page.screenshot({ path: `${output}/before-close.png` });
  // One cleanup failure: successful closes are irreversible, failed workspace remains retryable.
  await page.route(`**/api/terminal-sessions/2?terminal_id=${tabIDs[1]}&**`, route => route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"QA injected failure"}' }));
  page.once('dialog', dialog => dialog.accept()); await closeOne.click();
  await page.getByRole('status').filter({ hasText: '部分终端关闭失败' }).waitFor();
  assert(await closeOne.isVisible()); assert(exists(1)); assert(!exists(0) && !exists(2));
  report.checks.push('partial failure keeps workspace and shows retry message');
  await page.unrouteAll();
  page.once('dialog', dialog => dialog.accept()); await closeOne.click();
  await closeOne.waitFor({ state: 'detached' });
  await waitFor(() => !exists(1), 'Retry did not terminate the remaining session');
  await peer.getByRole('tab', { name: '1: 关闭验收甲', exact: true }).waitFor({ state: 'detached' });
  assert(exists(3)); report.checks.push('all nested tabs close and peer layout synchronizes; other workspace survives');
  await page.reload({ waitUntil: 'networkidle' }); await page.locator('.workspace-tabs-toggle').click();
  const closeLast = page.getByRole('button', { name: '关闭工作区: 2: 关闭验收乙', exact: true });
  await closeLast.waitFor();
  page.once('dialog', dialog => dialog.accept()); await closeLast.click(); await closeLast.waitFor({ state: 'detached' });
  await waitFor(() => !exists(3), 'Last workspace session survived close');
  await waitFor(async () => {
    const state = (await api('GET', '/api/layout')).layout;
    return state.workspaceTabs.length === 1 && Object.values(state.workspaceTabs[0].layout.panes).every(p => p.tabs.length === 0);
  }, 'Empty replacement workspace was not persisted');
  await page.reload({ waitUntil: 'networkidle' }); await page.locator('.workspace-tabs-toggle').click();
  assert.equal(await page.locator('.workspace-tabs [role="tab"]').count(), 1);
  assert.equal(await page.locator('[data-tab-id]').count(), 0);
  await page.screenshot({ path: `${output}/last-closed.png` });
  await new Promise(resolve => setTimeout(resolve, 5000));
  assert([0, 1, 2, 3].every(i => !exists(i)), 'A peer recreated an explicitly closed session');
  assert.equal(tmux(['display-message', '-pt', 'wt01-01-06-ee8f330da4330735', '#{pid}:#{pane_pid}:#{pane_current_command}']), originalClaude);
  report.checks.push('last workspace leaves a persisted empty workspace; no recreation or existing-user impact');
  assert(report.dialogs[0].includes('Panel: 3') && report.dialogs[0].includes('无法撤销'));
  report.status = 'PASS';
} catch (error) { report.status = 'FAIL'; report.error = error.message; throw error; }
finally {
  // Only the exact throwaway account and terminal IDs created by this runner.
  if (fixtureUser && userToken) {
    for (let i = 0; i < 4; i++) await api('DELETE', `/api/terminal-sessions/2?terminal_id=${tabIDs[i]}&workspace_index=${i === 3 ? 2 : 1}&panel_number=${i === 3 ? 1 : i + 1}&terminate=1`).catch(() => {});
    await api('DELETE', `/api/users/${fixtureUser}`, undefined, adminToken);
  }
  await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2));
  await browser.close();
  console.log(JSON.stringify(report));
}
