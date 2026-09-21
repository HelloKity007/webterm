import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '../ui/node_modules/playwright/index.mjs';
import { sendWindowsNativeClick, sendWindowsNativeDrag } from './windows-native-key.mjs';

// This is a real Windows Edge interaction: the dedicated QA profile owns both
// popup windows and a scheduled task sends OS SendInput mouse events.  CDP is
// used only to arrange owned fixtures and verify the browser result afterwards.
const output = resolve(process.env.WEBTERM_QA_OUTPUT || 'runtime/windows-native-file-tab-cross-window');
const expectedVersion = process.env.WEBTERM_QA_EXPECT_VERSION || 'e388c5a-strict-diagnostic26-custom-select-a11y';
const origin = process.env.WEBTERM_QA_ORIGIN || 'https://192.168.11.87:9444';
const filePath = resolve('README.md');
const fileId = `file:${filePath}`;
await mkdir(output, { recursive: true, mode: 0o700 });

const browser = await chromium.connectOverCDP(process.env.WEBTERM_QA_CDP || 'http://127.0.0.1:19335');
let context;
let source;
let target;
const report = { status: 'RUNNING', scope: 'two real Windows Edge popup windows; dedicated QA profile; OS SendInput mouse drag; no user Edge', errors: [] };

const pointFor = (page, box, xBias = 0) => page.evaluate(({ box, xBias }) => ({
  x: Math.round(window.screenX + (window.outerWidth - window.innerWidth) / 2 + box.x + xBias),
  y: Math.round(window.screenY + (window.outerHeight - window.innerHeight) + box.y + box.height / 2),
}), { box, xBias });

const browserWindow = async (page) => {
  const session = await context.newCDPSession(page);
  const { windowId } = await session.send('Browser.getWindowForTarget');
  return { session, windowId };
};
const closeWithin = async (operation, ms = 5000) => {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((resolve) => { timer = setTimeout(() => resolve('timed out'), ms); }),
    ]);
  } finally { clearTimeout(timer); }
};

try {
  context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: null });
  await context.addInitScript(({ sourcePath, sourceId }) => {
    if (!window.name) window.name = 'webterm-native-file-source';
    const target = window.name === 'webterm-native-file-target';
    const key = `webterm:file-workbench:v1:named-${window.name}`;
    const tabs = target ? [] : [{ id: sourceId, path: sourcePath, name: 'README.md', group: 'primary', refreshMode: 'manual', dirty: false }];
    localStorage.setItem(key, JSON.stringify({ version: 1, connectionId: 2, tabs,
      active: { primary: target ? null : sourceId, secondary: null }, focusedGroup: 'primary', split: false }));
    window.__nativeFileDragProbe = [];
    window.__nativePointerProbe = [];
    for (const type of ['dragstart', 'dragenter', 'dragover', 'drop', 'dragend']) {
      document.addEventListener(type, event => window.__nativeFileDragProbe.push({
        type, target: event.target?.className || event.target?.tagName,
        types: [...(event.dataTransfer?.types || [])],
      }), true);
    }
    for (const type of ['pointermove', 'mousemove', 'mousedown', 'mouseup', 'click']) {
      document.addEventListener(type, event => window.__nativePointerProbe.push({ type, target: event.target?.className || event.target?.tagName }), true);
    }
  }, { sourcePath: filePath, sourceId: fileId });
  await context.route('**/api/layout', route => route.fulfill({ json: {
    schema_version: 2, revision: 1,
    layout: { workspaceTabs: [{ id: 'qa-windows-file-drag', index: 1, name: 'QA file drag', layout: { tree: { type: 'leaf', id: 'empty' }, panes: { empty: { tabs: [], activeTabId: null } }, focusedPaneId: 'empty' } }] },
  } }));
  await context.routeWebSocket(/\/ws\/(?!sftp\/)/, route => route.close());

  source = await context.newPage();
  await source.goto(origin, { waitUntil: 'networkidle' });
  report.candidate = await source.evaluate(() => fetch('/api/health').then(response => response.json()));
  assert.equal(report.candidate.environment, 'release-test');
  assert.equal(report.candidate.version, expectedVersion);
  assert.match(await source.evaluate(() => navigator.userAgent), /Windows/);
  await source.locator('.activity-files').click();
  await source.locator('[data-testid="file-workspace"]').waitFor();
  await source.locator('[data-editor-tab-id]').first().waitFor();
  await source.evaluate(() => { document.title = 'WebTerm-native-file-source'; });
  const sourceWindow = await browserWindow(source);
  await sourceWindow.session.send('Browser.setWindowBounds', { windowId: sourceWindow.windowId, bounds: { left: 20, top: 40, width: 840, height: 760 } });

  const popup = source.waitForEvent('popup');
  await source.evaluate(() => window.open(location.href, 'webterm-native-file-target', 'popup=yes,width=840,height=760'));
  target = await popup;
  await target.waitForLoadState('networkidle');
  await target.locator('.activity-files').click();
  await target.locator('[data-testid="file-workspace"]').waitFor();
  assert.equal(await target.locator('[data-editor-tab-id]').count(), 0, 'target must begin without the source tab');
  await target.evaluate(() => { document.title = 'WebTerm-native-file-target'; });
  const targetWindow = await browserWindow(target);
  await targetWindow.session.send('Browser.setWindowBounds', { windowId: targetWindow.windowId, bounds: { left: 920, top: 40, width: 840, height: 760 } });
  await target.waitForTimeout(500);

  // Measure the actual draggable tab surface, not its wrapper (which also
  // contains the independent close button).  Centering the OS pointer in the
  // wrapper can land on the close control at narrow widths.
  const sourceBox = await source.locator('[data-editor-tab-id] [role="tab"]').first().boundingBox();
  const targetBox = await target.locator('[data-editor-group="primary"] .file-editor-tabs').boundingBox();
  assert(sourceBox && targetBox, 'source tab or target editor strip is not visible');
  const sourcePoint = await pointFor(source, sourceBox, sourceBox.width / 2);
  const targetPoint = await pointFor(target, targetBox, Math.min(80, targetBox.width / 2));
  report.pointer = { sourceBox, targetBox, sourcePoint, targetPoint, metrics: await Promise.all([source, target].map(page => page.evaluate(() => ({ screenX, screenY, outerWidth, outerHeight, innerWidth, innerHeight, devicePixelRatio })))) };
  // Prove the actual Windows pointer coordinate reaches the source document
  // before interpreting a missing drag sequence as an app-level failure.
  report.clickDelivery = await sendWindowsNativeClick({ sourceTitle: 'WebTerm-native-file-source', point: sourcePoint });
  await source.waitForTimeout(200);
  report.nativePointer = await source.evaluate(() => window.__nativePointerProbe);
  for (const type of ['mousedown', 'mouseup', 'click']) assert(report.nativePointer.some(event => event.type === type), `Windows native ${type} did not reach source document`);
  report.delivery = await sendWindowsNativeDrag({ sourceTitle: 'WebTerm-native-file-source', sourcePoint, targetPoint, steps: 18 });

  await target.locator('[data-editor-tab-id]').first().waitFor({ timeout: 15000 });
  await source.locator('[data-editor-tab-id]').first().waitFor({ state: 'detached', timeout: 15000 });
  report.nativeEvents = await Promise.all([source, target].map(page => page.evaluate(() => window.__nativeFileDragProbe)));
  report.sourceTabs = await source.locator('[data-editor-tab-id]').count();
  report.targetTabs = await target.locator('[data-editor-tab-id]').count();
  report.storage = await Promise.all([source, target].map(page => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('webterm:file-workbench:v1:')))));
  assert.equal(report.sourceTabs, 0);
  assert.equal(report.targetTabs, 1);
  assert(report.nativeEvents[0].some(event => event.type === 'dragstart'), 'source did not receive native dragstart');
  assert(report.nativeEvents[1].some(event => event.type === 'dragover'), 'target did not receive native dragover');
  assert(report.nativeEvents[1].some(event => event.type === 'drop'), 'target did not receive native drop');
  assert.equal(report.storage[0].length, 1); assert.equal(report.storage[1].length, 1);
  assert.notEqual(report.storage[0][0], report.storage[1][0], 'two windows overwrote a shared workbench key');
  await source.screenshot({ path: `${output}/source-after.png` });
  await target.screenshot({ path: `${output}/target-after.png` });
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.error = String(error);
  report.errors.push(String(error)); process.exitCode = 1;
  if (source || target) {
    try { report.nativeEvents = await Promise.all([source, target].filter(Boolean).map(page => page.evaluate(() => window.__nativeFileDragProbe || []))); }
    catch (eventError) { report.errors.push(`native event capture failed: ${eventError}`); }
  }
  if (source) {
    try { report.nativePointer = await source.evaluate(() => window.__nativePointerProbe || []); }
    catch (pointerError) { report.errors.push(`native pointer capture failed: ${pointerError}`); }
  }
  for (const [index, page] of [source, target].filter(Boolean).entries()) {
    try {
      await page.screenshot({ path: `${output}/failure-${index}.png` });
      report.pages = [...(report.pages || []), { title: await page.title(), url: page.url(), tabs: await page.locator('[data-editor-tab-id]').count() }];
    } catch { /* best-effort failure evidence */ }
  }
} finally {
  // CDP-attached Edge can leave a context-close promise pending after an OS
  // drag has switched native windows. Close only our two popup pages first;
  // bounded cleanup plus process exit releases the CDP transport without ever
  // closing the dedicated browser or a user profile.
  report.cleanup = await closeWithin(Promise.all([source?.close(), target?.close()].filter(Boolean))).catch(error => `page close failed: ${error}`);
  report.contextCleanup = await closeWithin(context?.close() || Promise.resolve()).catch(error => `context close failed: ${error}`);
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2), { mode: 0o600 });
}
console.log(JSON.stringify({ status: report.status, output, error: report.error }));
// Browser.close() would close the remote dedicated Edge. Explicitly terminate
// this one-shot verifier after it has closed its own pages and persisted proof.
process.exit(process.exitCode || 0);
