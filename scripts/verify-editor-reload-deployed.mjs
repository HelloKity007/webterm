import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, firefox, webkit } from '../ui/node_modules/playwright/index.mjs';
const engineName = process.env.WEBTERM_QA_BROWSER || 'chromium';
const engine = { chromium, firefox, webkit }[engineName];
assert(engine, 'Unsupported browser engine');
const cdpEndpoint = process.env.WEBTERM_QA_CDP || '';
assert(!cdpEndpoint || engineName === 'chromium', 'CDP attachment is supported only for Chromium-family browsers');
const origin = 'https://192.168.11.87:9444';
const expectedVersion = process.env.WEBTERM_QA_VERSION || 'e388c5a-strict-diagnostic33-context-anchor';
const output = process.env.WEBTERM_QA_OUTPUT || 'runtime/incident-20260917-production-tmux/editor-reload-deployed';
const filePath = resolve('README.md');
assert((await readFile(filePath, 'utf8')).startsWith('# WebTerm'));
const id = `file:${filePath}`;
await mkdir(output, { recursive: true, mode: 0o700 });
await chmod(output, 0o700);
const browser = cdpEndpoint ? await chromium.connectOverCDP(cdpEndpoint) : await engine.launch();
const attachedBrowser = Boolean(cdpEndpoint);
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 }, recordVideo: { dir: `${output}/video` } });
const errors = [], actions = [], results = [], blocked = [];
let tickets = 0, candidate, failure;
const browserIdentity = { engine: engineName, version: browser.version() };
await context.addInitScript(({ filePath, id }) => {
  if (!localStorage.getItem('qa-editor-seeded')) {
    localStorage.setItem('webterm:file-workbench:v1', JSON.stringify({ version: 1, connectionId: 2, tabs: [{ id, path: filePath, name: 'README.md', group: 'primary', refreshMode: 'manual', dirty: false }], active: { primary: id, secondary: null }, focusedGroup: 'primary', split: false }));
    localStorage.setItem('qa-editor-seeded', '1');
  }
}, { filePath, id });
await context.route('**/api/layout', route => {
  blocked.push({ kind: 'layout', method: route.request().method() });
  return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ schema_version: 2, revision: 1, layout: { workspaceTabs: [{ id: 'qa-editor-empty', index: 1, name: 'Isolated editor QA', layout: { tree: { type: 'leaf', id: 'qa-empty-pane' }, panes: { 'qa-empty-pane': { tabs: [], activeTabId: null } }, focusedPaneId: 'qa-empty-pane' } }] } }) });
});
await context.route('**/api/ws-tickets', async route => {
  const scope = route.request().postDataJSON();
  if (scope.endpoint !== 'sftp') { blocked.push({ kind: 'ticket', endpoint: scope.endpoint }); return route.fulfill({ status: 403, body: '{}' }); }
  tickets++;
  await new Promise(r => setTimeout(r, 1200));
  await route.continue();
});
await context.routeWebSocket(/\/ws\/(?!sftp\/)/, route => { blocked.push({ kind: 'non-sftp-websocket' }); route.close(); });
// Intercept only SFTP messages to guarantee the diagnostic cannot write. The
// browser-facing routed socket may OPEN before upstream, so this is NOT claimed
// as a native delayed-handshake test; the separate localhost test proves that.
await context.routeWebSocket(/\/ws\/sftp\//, route => {
  const upstream = route.connectToServer();
  route.onMessage(raw => {
    const value = JSON.parse(String(raw));
    actions.push({ action: value.action });
    if (!['read', 'list', 'stat', 'ping', 'home', 'getwd'].includes(value.action)) { errors.push(`Non-read-only action blocked: ${value.action}`); route.close(); return; }
    upstream.send(raw);
  });
});
const page = await context.newPage();
page.on('pageerror', e => errors.push(String(e)));
try {
  for (let round = 0; round <= 5; round++) {
    if (round === 0) await page.goto(origin); else await page.reload();
    await page.locator('.activity-files').click();
    await page.locator('[data-testid="file-workspace"]').waitFor();
    await page.locator('.cm-content').filter({ hasText: '# WebTerm' }).waitFor({ timeout: 30000 });
    assert.equal(await page.locator('[data-editor-tab-id]').filter({ hasText: 'README.md' }).count(), 1);
    const health = await page.evaluate(async () => (await fetch('/api/health')).json());
    assert.equal(health.environment, 'release-test');
    assert.equal(health.version, expectedVersion);
    if (candidate) assert.deepEqual(health, candidate); else candidate = health;
    assert.deepEqual(errors, []);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('webterm:file-workbench:v1')));
    assert.equal(saved.tabs.length, 1); assert.equal(saved.tabs[0].path, filePath);
    results.push({ round, status: 'PASS', restoredTabs: saved.tabs.length, readRequests: actions.filter(a => a.action === 'read').length });
    // Avoid screenshots of unrelated directory names: only the editor group.
    await page.locator('.cm-editor').screenshot({ path: `${output}/round-${round}-editor.png` });
  }
  assert.equal(actions.filter(a => a.action === 'read').length, 6);
  if (process.env.WEBTERM_QA_AXE === '1') {
    await page.addScriptTag({ path: resolve('ui/node_modules/axe-core/axe.min.js') });
    const accessibility = await page.evaluate(async () => window.axe.run(
      document.querySelector('[data-testid="file-workspace"]'),
      { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } },
    ));
    await writeFile(`${output}/axe.json`, JSON.stringify(accessibility, null, 2), { mode: 0o600 });
    assert.equal(accessibility.violations.length, 0, accessibility.violations.map(v => `${v.id}: ${v.help}`).join('; '));
    // Incomplete checks need manual review; never convert this scan to a
    // blanket accessibility PASS, even when automatic violations are zero.
  }
} catch (e) { failure = String(e); }
finally {
  await writeFile(`${output}/report.json`, JSON.stringify({ status: failure ? 'FAIL' : 'PASS', browser: browserIdentity, failure, candidate, results, errors, actions, blocked, tickets, reload: 'Playwright page.reload; NOT Windows native Ctrl+Shift+R', delay: '1200ms REST ticket delay; routed WebSocket OPEN semantics are not native handshake delay', isolation: 'fresh context; fixture GET layout; all layout writes intercepted; non-SFTP tickets/sockets blocked; SFTP allowlist read-only' }, null, 2), { mode: 0o600 });
  await chmod(`${output}/report.json`, 0o600);
  await context.close();
  // A CDP browser belongs to a named, isolated Windows QA profile. Closing
  // its Browser object would close that profile (and can never be correct for
  // an attached user browser), so release only our temporary context.
  if (!attachedBrowser) await browser.close();
}
if (failure) { console.error(failure); process.exitCode = 1; } else console.log('PASS: deployed assets, real read-only SFTP, initial load plus five reloads');
