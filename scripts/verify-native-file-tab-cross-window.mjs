import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '../ui/node_modules/playwright/index.mjs';

// This is intentionally an X11-native test, not a synthetic DragEvent: the
// pointer button remains down while xdotool moves between two Chrome windows.
const output = resolve(process.env.WEBTERM_QA_OUTPUT || `runtime/native-file-tab-cross-window-${Date.now()}`);
const origin = 'https://192.168.11.87:9444';
const expected = process.env.WEBTERM_QA_EXPECT_VERSION || 'e388c5a-strict-diagnostic33-context-anchor';
const filePath = resolve('README.md');
const fileId = `file:${filePath}`;
await mkdir(output, { recursive: true, mode: 0o700 }); await chmod(output, 0o700);
const report = { status: 'RUNNING', scope: 'two real Chrome X11 windows; xdotool native pointer drag; no terminal sockets', errors: [] };
const runX = (...args) => execFileSync('xdotool', args, { encoding: 'utf8' }).trim();
const visibleWindowNames = () => {
  try { return runX('search', '--onlyvisible', '--name', '.').split('\n').filter(Boolean).map(id => ({ id, name: runX('getwindowname', id) })); } catch { return []; }
};
const windowId = (title) => {
  try { return runX('search', '--name', title).split('\n').filter(Boolean).at(-1); }
  catch { throw new Error(`X11 window not found for ${title}; visible=${JSON.stringify(visibleWindowNames())}`); }
};
let browser, context, source, target;
try {
  assert(process.env.DISPLAY, 'DISPLAY is required; invoke through xvfb-run with a window manager');
  browser = await chromium.launch({ headless: false, executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-features=Translate'] });
  context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 860, height: 760 } });
  await context.addInitScript(({ filePath, fileId }) => {
    const target = window.name === 'webterm-file-target';
    const tabs = target ? [] : [{ id: fileId, path: filePath, name: 'README.md', group: 'primary', refreshMode: 'manual', dirty: false }];
    localStorage.setItem('webterm:file-workbench:v1', JSON.stringify({ version: 1, connectionId: 2, tabs, active: { primary: target ? null : fileId, secondary: null }, focusedGroup: 'primary', split: false }));
    window.__nativeFileDragProbe = [];
    window.__nativePointerProbe = [];
    for (const type of ['dragstart', 'dragenter', 'dragover', 'drop', 'dragend']) document.addEventListener(type, event => window.__nativeFileDragProbe.push({ type, target: event.target?.className || event.target?.tagName, types: [...(event.dataTransfer?.types || [])] }), true);
    for (const type of ['pointermove', 'mousemove', 'mousedown', 'mouseup', 'click']) document.addEventListener(type, event => window.__nativePointerProbe.push({ type, target: event.target?.className || event.target?.tagName }), true);
  }, { filePath, fileId });
  const layout = {
    schema_version: 2, revision: 1,
    layout: { workspaceTabs: [{
      id: 'qa-file-drag', index: 1, name: 'QA file drag',
      layout: { tree: { type: 'leaf', id: 'empty' }, panes: { empty: { tabs: [], activeTabId: null } }, focusedPaneId: 'empty' },
    }] },
  };
  await context.route('**/api/layout', route => route.fulfill({ json: layout }));
  await context.route('**/api/ws-tickets', route => {
    const request = route.request().postDataJSON();
    return request.endpoint === 'sftp' ? route.continue() : route.fulfill({ status: 403, body: '{}' });
  });
  await context.routeWebSocket(/\/ws\/(?!sftp\/)/, route => route.close());
  source = await context.newPage();
  await source.goto(origin, { waitUntil: 'networkidle' });
  assert.equal((await source.evaluate(() => fetch('/api/health').then(r => r.json()))).version, expected);
  await source.locator('.activity-files').click();
  await source.locator('[data-testid="file-workspace"]').waitFor();
  await source.locator('[data-editor-tab-id]').first().waitFor();
  await source.evaluate(() => { document.title = 'WebTerm native file source'; });
  const popupPromise = source.waitForEvent('popup');
  await source.evaluate(() => window.open(location.href, 'webterm-file-target', 'popup=yes,width=860,height=760'));
  target = await popupPromise;
  await target.waitForLoadState('networkidle');
  await target.locator('.activity-files').click();
  await target.locator('[data-testid="file-workspace"]').waitFor();
  assert.equal(await target.locator('[data-editor-tab-id]').count(), 0, 'target must not begin with the source tab');
  await target.evaluate(() => { document.title = 'WebTerm native file target'; });
  await target.waitForTimeout(500);
  const sourceWindow = windowId('WebTerm native file source');
  const targetWindow = windowId('WebTerm native file target');
  assert(sourceWindow && targetWindow && sourceWindow !== targetWindow, 'two separate X11 browser windows were not found');
  runX('windowmove', sourceWindow, '20', '20'); runX('windowsize', sourceWindow, '860', '760');
  runX('windowmove', targetWindow, '920', '20'); runX('windowsize', targetWindow, '860', '760');
  await source.waitForTimeout(300);
  const sourceBox = await source.locator('[data-editor-tab-id]').first().boundingBox();
  const targetBox = await target.locator('[data-editor-group="primary"] .file-editor-tabs').boundingBox();
  assert(sourceBox && targetBox, 'native drag source or target is not visible');
  // Playwright boxes are viewport-relative, while xdotool uses X11 screen
  // coordinates. Account for Chrome's title/address chrome explicitly; using
  // xdotool --window would drop into the browser toolbar instead of the page.
  const screenPoint = async (page, box, biasX = 0) => page.evaluate(({ box, biasX }) => ({
    x: Math.round(window.screenX + (window.outerWidth - window.innerWidth) / 2 + box.x + biasX),
    y: Math.round(window.screenY + (window.outerHeight - window.innerHeight) + box.y + box.height / 2),
  }), { box, biasX });
  const sourcePoint = await screenPoint(source, sourceBox, sourceBox.width / 2);
  const targetPoint = await screenPoint(target, targetBox, Math.min(80, targetBox.width / 2));
  const [screenWidth, screenHeight] = runX('getdisplaygeometry').split(/\s+/).map(Number);
  assert(Number.isFinite(screenWidth) && Number.isFinite(screenHeight), 'X11 display geometry is unavailable');
  assert(sourcePoint.x >= 0 && sourcePoint.x < screenWidth && sourcePoint.y >= 0 && sourcePoint.y < screenHeight,
    `source pointer is outside X11 display ${screenWidth}x${screenHeight}: ${JSON.stringify(sourcePoint)}`);
  assert(targetPoint.x >= 0 && targetPoint.x < screenWidth && targetPoint.y >= 0 && targetPoint.y < screenHeight,
    `target pointer is outside X11 display ${screenWidth}x${screenHeight}: ${JSON.stringify(targetPoint)}`);
  report.pointer = { sourcePoint, targetPoint, sourceBox, targetBox, sourceWindow, targetWindow,
    screen: { width: screenWidth, height: screenHeight },
    metrics: await Promise.all([source, target].map(page => page.evaluate(() => ({ screenX, screenY, outerWidth, outerHeight, innerWidth, innerHeight })))),
  };
  // Verify that the same XTEST input path can deliver a normal source click
  // before treating a missing drag sequence as an application defect.
  runX('mousemove', String(sourcePoint.x), String(sourcePoint.y));
  runX('click', '1');
  await source.waitForTimeout(180);
  report.clickDelivery = await source.evaluate(() => window.__nativePointerProbe || []);
  for (const type of ['mousedown', 'mouseup', 'click']) assert(report.clickDelivery.some(event => event.type === type), `X11 native ${type} did not reach source document`);
  await source.evaluate(() => { window.__nativePointerProbe = []; });
  runX('mousemove', String(sourcePoint.x), String(sourcePoint.y));
  runX('mousedown', '1');
  // Let Chromium consume the physical button transition before any move. A
  // same-tick move can hide an XTEST ordering problem as an apparent app DnD
  // failure, so record and require the source mousedown explicitly.
  await source.waitForTimeout(150);
  report.downDelivery = await source.evaluate(() => window.__nativePointerProbe || []);
  assert(report.downDelivery.some(event => event.type === 'mousedown'), 'X11 native mousedown did not reach source document before drag movement');
  // Several physical intermediate moves are required for Chromium to promote
  // mouse-down into a native drag and dispatch dragenter/dragover in the other
  // X11 window; a one-hop move is only a click on some window managers.
  for (let step = 1; step <= 16; step++) {
    const ratio = step / 16;
    runX('mousemove', String(Math.round(sourcePoint.x + (targetPoint.x - sourcePoint.x) * ratio)), String(Math.round(sourcePoint.y + (targetPoint.y - sourcePoint.y) * ratio)));
    await target.waitForTimeout(45);
  }
  report.pointer.afterMove = runX('getmouselocation', '--shell');
  await source.waitForTimeout(700);
  runX('mouseup', '1');
  report.nativeEvents = await Promise.all([source, target].map(page => page.evaluate(() => window.__nativeFileDragProbe)));
  report.nativePointer = await Promise.all([source, target].map(page => page.evaluate(() => window.__nativePointerProbe || [])));
  await target.locator('[data-editor-tab-id]').first().waitFor({ timeout: 10000 });
  await source.locator('[data-editor-tab-id]').first().waitFor({ state: 'detached', timeout: 10000 });
  report.sourceTabs = await source.locator('[data-editor-tab-id]').count();
  report.targetTabs = await target.locator('[data-editor-tab-id]').count();
  report.storage = await Promise.all([source, target].map(page => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('webterm:file-workbench:v1:')))));
  assert.equal(report.sourceTabs, 0); assert.equal(report.targetTabs, 1);
  assert.equal(report.storage[0].length, 1); assert.equal(report.storage[1].length, 1);
  assert.notEqual(report.storage[0][0], report.storage[1][0], 'windows overwrote a shared file-workbench state');
  await source.screenshot({ path: `${output}/source-after.png` }); await target.screenshot({ path: `${output}/target-after.png` });
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.error = String(error); process.exitCode = 1;
  for (const [index, page] of (context?.pages() || []).entries()) {
    try {
      await page.screenshot({ path: `${output}/failure-${index}.png` });
      report.pages = [...(report.pages || []), { url: page.url(), title: await page.title(), editorTabs: await page.locator('[data-editor-tab-id]').count(), roles: await page.locator('[role="tab"]').count() }];
    } catch { /* evidence best-effort */ }
  }
  if (!report.nativePointer && source) {
    try { report.nativePointer = await source.evaluate(() => window.__nativePointerProbe || []); } catch { /* best effort evidence */ }
  }
}
finally { await browser?.close(); await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2), { mode: 0o600 }); await chmod(`${output}/report.json`, 0o600); }
console.log(JSON.stringify({ output, status: report.status, error: report.error }));
