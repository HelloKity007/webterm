import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = createRequire(import.meta.url)('../ui/node_modules/playwright');
const origin = process.env.WEBTERM_QA_URL || 'https://192.168.11.87:9444';
assert.equal(new URL(origin).port, '9444', 'This gate only permits release-test 9444');
const output = process.env.WEBTERM_QA_OUTPUT || `runtime/layout-presence-${Date.now()}`;
await mkdir(output, { recursive: true, mode: 0o700 });
const browser = await chromium.launch({ executablePath: process.env.WEBTERM_QA_CHROME || '/usr/bin/google-chrome', headless: false, args: ['--no-sandbox'] });
const admin = await browser.newContext({ ignoreHTTPSErrors: true });
const report = { status: 'RUNNING', checks: [] };
let adminToken, userToken, fixtureUser, connectionID;
const terminalIDs = [`qa-presence-a-${randomUUID()}`, `qa-presence-b-${randomUUID()}`];

const api = async (method, path, data, token = userToken) => {
  const response = await admin.request.fetch(origin + path, { method, data, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const text = await response.text();
  return { status: response.status(), body: text ? JSON.parse(text) : null };
};
const ok = async (...args) => {
  const response = await api(...args);
  assert(response.status >= 200 && response.status < 300, `${args[0]} ${args[1]} returned ${response.status}`);
  return response.body;
};
const openFixturePage = async () => {
  const context = await browser.newContext({ viewport: { width: 3440, height: 1440 }, ignoreHTTPSErrors: true });
  await context.route('**/api/auth/test-session', route => route.fulfill({ status: 404, body: '' }));
  await context.addInitScript(({ token, user }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('webterm-user', JSON.stringify(user));
  }, { token: userToken, user: { id: fixtureUser, username: `qa-presence-${fixtureUser}`, role: 'admin' } });
  const page = await context.newPage();
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelectorAll('.xterm').length === 2);
  return { context, page };
};

let clientA, clientB;
try {
  const health = await ok('GET', '/api/health', undefined, undefined);
  assert.equal(health.environment, 'release-test');
  report.candidate = health.version;
  const adminPage = await admin.newPage();
  await adminPage.goto(origin, { waitUntil: 'networkidle' });
  await adminPage.waitForFunction(() => !!localStorage.getItem('token'));
  adminToken = await adminPage.evaluate(() => localStorage.getItem('token'));
  const username = `qa-presence-${randomUUID()}`;
  const password = randomUUID();
  fixtureUser = (await ok('POST', '/api/users', { username, password, role: 'admin' }, adminToken)).id;
  const login = await ok('POST', '/api/auth/login', { username, password }, undefined);
  userToken = login.token;
  connectionID = (await ok('POST', '/api/quick-connect/local', {}, userToken)).connection.id;
  const saved = await ok('GET', '/api/layout', undefined, userToken);
  const pane = (index) => ({ tabs: [{ id: terminalIDs[index], type: 'ssh', title: `Presence ${index + 1}`, connId: connectionID, labelNumber: index + 1 }], activeTabId: terminalIDs[index] });
  const layout = { workspaceTabs: [{ id: 'qa-presence-workspace', index: 1, name: 'Presence QA', layout: {
    tree: { type: 'split', direction: 'horizontal', ratios: [0.5, 0.5], children: [{ type: 'leaf', id: 'qa-left' }, { type: 'leaf', id: 'qa-right' }] },
    panes: { 'qa-left': pane(0), 'qa-right': pane(1) }, focusedPaneId: 'qa-left',
  } }] };
  await ok('PUT', '/api/layout', { schema_version: 2, revision: saved.revision, layout }, userToken);
  clientA = await openFixturePage();
  clientB = await openFixturePage();
  await clientA.page.locator('[data-presence-count="2"]').first().waitFor({ timeout: 30000 });
  assert.equal(await clientA.page.locator('[data-presence-count="2"]').count(), 2);
  report.checks.push('presence snapshot/delta counts two distinct clients on both terminals');

  await clientB.page.reload({ waitUntil: 'networkidle' });
  await clientB.page.waitForFunction(() => document.querySelectorAll('.xterm').length === 2);
  await clientA.page.waitForTimeout(1000);
  assert.equal(await clientA.page.locator('[data-presence-count="2"]').count(), 2, 'refresh grace changed the distinct-client count');
  report.checks.push('same-tab reload reconnects inside grace without count flicker');

  const divider = clientA.page.locator('[data-layout-divider="root:0"]');
  await divider.waitFor();
  const before = await clientA.page.locator('.terminal-grid-cell:visible').first().boundingBox();
  const bounds = await divider.boundingBox();
  assert(before && bounds);
  await clientA.page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await clientA.page.mouse.down();
  await clientA.page.mouse.move(bounds.x + 500, bounds.y + bounds.height / 2, { steps: 12 });
  await clientA.page.mouse.up();
  await clientA.page.waitForTimeout(1200);
  const after = await clientA.page.locator('.terminal-grid-cell:visible').first().boundingBox();
  assert(after.width > before.width + 300, `divider did not resize the first panel: ${before.width} -> ${after.width}`);
  await clientB.page.waitForFunction(() => document.querySelector('.terminal-grid-cell')?.getBoundingClientRect().width > 1900);
  const authoritative = await ok('GET', '/api/layout', undefined, userToken);
  const ratios = authoritative.layout.workspaceTabs[0].layout.tree.ratios;
  assert(ratios[0] > 0.6 && ratios[0] < 0.9, `unexpected saved ratios ${ratios}`);
  report.checks.push('pointer divider resizes live, saves once after release and converges on peer');
  await clientA.page.screenshot({ path: `${output}/divider-and-presence.png` });

  const conflictA = structuredClone(authoritative.layout);
  const conflictB = structuredClone(authoritative.layout);
  conflictA.workspaceTabs[0].layout.tree.ratios = [0.55, 0.45];
  conflictB.workspaceTabs[0].layout.tree.ratios = [0.45, 0.55];
  const conflicts = await Promise.all([
    api('PUT', '/api/layout', { schema_version: 2, revision: authoritative.revision, layout: conflictA }, userToken),
    api('PUT', '/api/layout', { schema_version: 2, revision: authoritative.revision, layout: conflictB }, userToken),
  ]);
  assert.deepEqual(conflicts.map(result => result.status).sort(), [200, 409]);
  assert.equal(conflicts.find(result => result.status === 409).body.code, 'LAYOUT_CONFLICT');
  report.checks.push('simultaneous layout writes produce one success and one stable LAYOUT_CONFLICT');

  const keyboardBefore = await clientA.page.locator('.terminal-grid-cell:visible').first().boundingBox();
  await clientA.page.locator('[data-layout-divider="root:0"]').focus();
  await clientA.page.keyboard.press('ArrowLeft');
  await clientA.page.waitForTimeout(800);
  const keyboardAfter = await clientA.page.locator('.terminal-grid-cell:visible').first().boundingBox();
  assert(Math.abs(keyboardAfter.width - keyboardBefore.width) > 20, 'keyboard divider adjustment did not change panel width');
  report.checks.push('divider is keyboard focusable and arrow-adjustable');

  const contextLoss = await clientA.page.evaluate(() => {
    const surface = document.querySelector('.terminal-surface[data-renderer="webgl"]');
    const canvas = surface?.querySelector('canvas');
    if (!surface || !canvas) return { supported: false };
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    return { supported: true };
  });
  if (contextLoss.supported) {
    await clientA.page.waitForFunction(() => document.querySelector('.terminal-surface')?.dataset.contextLosses === '1');
    assert.equal(await clientA.page.locator('.terminal-surface').first().getAttribute('data-renderer'), 'dom');
    report.checks.push('synthetic WebGL context loss falls back to DOM without remounting the terminal');
  } else {
    report.checks.push('browser started in DOM fallback; WebGL context-loss injection not applicable');
  }
  const renderer = await clientA.page.evaluate(() => window.__webtermRendererMetrics);
  assert(renderer && renderer.webglActive + renderer.domActive === 2 && renderer.mounts >= 2);
  report.renderer = renderer;
  report.checks.push('renderer lifecycle is observable and active renderer count matches visible terminals');

  await clientB.context.close();
  clientB = null;
  await clientA.page.waitForFunction(() => document.querySelectorAll('[data-presence-count="1"]').length === 2, undefined, { timeout: 20000 });
  report.checks.push('disconnect expires after grace with no ghost client');
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL';
  report.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  if (clientB) await clientB.context.close().catch(() => {});
  if (clientA) await clientA.context.close().catch(() => {});
  if (connectionID && userToken) {
    for (let index = 0; index < terminalIDs.length; index++) {
      await api('DELETE', `/api/terminal-sessions/${connectionID}?terminal_id=${terminalIDs[index]}&workspace_index=1&panel_number=${index + 1}&terminate=1`, undefined, userToken).catch(() => {});
    }
  }
  if (fixtureUser && adminToken) await api('DELETE', `/api/users/${fixtureUser}`, undefined, adminToken).catch(() => {});
  await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2), { mode: 0o600 });
  await browser.close();
  console.log(JSON.stringify(report));
}
