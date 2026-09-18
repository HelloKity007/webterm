import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '../ui/node_modules/playwright/index.mjs';
import { sendWindowsNativeClick } from './windows-native-key.mjs';

const output = resolve(process.env.WEBTERM_QA_OUTPUT || 'runtime/windows-native-pointer');
const expectedVersion = process.env.WEBTERM_QA_EXPECT_VERSION || '';
const origin = process.env.WEBTERM_QA_ORIGIN || 'https://192.168.11.87:9444';
const filePath = resolve('README.md');
const fileId = `file:${filePath}`;
await mkdir(output, { recursive: true, mode: 0o700 });
const browser = await chromium.connectOverCDP(process.env.WEBTERM_QA_CDP || 'http://127.0.0.1:19335');
let context; let page;
const report = { status: 'RUNNING', scope: 'dedicated Windows Edge QA popup; OS SendInput click at measured real file-tab coordinate; no user Edge' };
try {
  context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: null });
  await context.addInitScript(({ sourcePath, sourceId }) => {
    if (!window.name) window.name = 'webterm-native-file-source';
    const key = `webterm:file-workbench:v1:named-${window.name}`;
    localStorage.setItem(key, JSON.stringify({ version: 1, connectionId: 2,
      tabs: [{ id: sourceId, path: sourcePath, name: 'README.md', group: 'primary', refreshMode: 'manual', dirty: false }],
      active: { primary: sourceId, secondary: null }, focusedGroup: 'primary', split: false }));
    window.__nativePointerProbe = [];
    for (const type of ['pointermove', 'mousemove', 'mousedown', 'mouseup', 'click']) document.addEventListener(type, event => {
      const className = event.target?.className;
      window.__nativePointerProbe.push({ type, target: typeof className === 'string' ? className : event.target?.tagName || '' });
    }, true);
  }, { sourcePath: filePath, sourceId: fileId });
  page = await context.newPage();
  await page.goto(origin, { waitUntil: 'networkidle' });
  report.candidate = await page.evaluate(() => fetch('/api/health').then(response => response.json()));
  assert.equal(report.candidate.environment, 'release-test');
  if (expectedVersion) assert.equal(report.candidate.version, expectedVersion);
  assert.match(await page.evaluate(() => navigator.userAgent), /Windows/);
  await page.locator('.activity-files').click();
  await page.locator('[data-testid="file-workspace"]').waitFor();
  await page.locator('[data-editor-tab-id]').first().waitFor();
  await page.evaluate(() => { document.title = 'WebTerm-native-file-source'; });
  const cdp = await context.newCDPSession(page);
  const { windowId } = await cdp.send('Browser.getWindowForTarget');
  await cdp.send('Browser.setWindowBounds', { windowId, bounds: { left: 20, top: 40, width: 840, height: 760 } });
  const box = await page.locator('[data-editor-tab-id]').first().boundingBox();
  assert(box, 'visible real file tab missing');
  report.point = await page.evaluate((tab) => ({
    x: Math.round(window.screenX + (window.outerWidth - window.innerWidth) / 2 + tab.x + tab.width / 2),
    y: Math.round(window.screenY + (window.outerHeight - window.innerHeight) + tab.y + tab.height / 2),
    tab, metrics: { screenX, screenY, outerWidth, outerHeight, innerWidth, innerHeight, devicePixelRatio },
  }), box);
  await page.evaluate(() => { window.__nativePointerProbe = []; });
  report.delivery = await sendWindowsNativeClick({ sourceTitle: 'WebTerm-native-file-source', point: report.point });
  await page.waitForTimeout(250);
  report.events = await page.evaluate(() => window.__nativePointerProbe);
  for (const type of ['mousedown', 'mouseup', 'click']) assert(report.events.some(event => event.type === type), `native ${type} did not reach Edge document`);
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.error = String(error); process.exitCode = 1;
  if (page) {
    try { report.events = await page.evaluate(() => window.__nativePointerProbe || []); await page.screenshot({ path: `${output}/failure.png` }); } catch { /* evidence best effort */ }
  }
} finally {
  // Detach safely after recording evidence. Browser.close() would close the
  // externally managed dedicated Edge process.
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2), { mode: 0o600 });
}
console.log(JSON.stringify({ status: report.status, output, error: report.error }));
process.exit(process.exitCode || 0);
