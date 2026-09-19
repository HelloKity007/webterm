import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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
const runId = randomUUID();
const sourceTitle = `WebTerm native file source ${runId}`;
const targetTitle = `WebTerm native file target ${runId}`;
const targetWindowName = `webterm-file-target-${runId}`;
await mkdir(output, { recursive: true, mode: 0o700 }); await chmod(output, 0o700);
const report = { status: 'RUNNING', scope: 'two real Chrome X11 windows; xdotool native pointer drag; no terminal sockets', errors: [] };
const runX = (...args) => execFileSync('xdotool', args, { encoding: 'utf8' }).trim();
const runXInfo = (...args) => execFileSync('xwininfo', args, { encoding: 'utf8' }).trim();
const visibleWindowNames = () => {
  try { return runX('search', '--onlyvisible', '--name', '.').split('\n').filter(Boolean).map(id => ({ id, name: runX('getwindowname', id) })); } catch { return []; }
};
const windowMatches = (title) => {
  try {
    // Chrome may append its product name to document.title. The UUID is still
    // unique to this run; inspect each matching caption before choosing it.
    return runX('search', '--onlyvisible', '--name', title).split('\n').filter(Boolean)
      .filter(id => runX('getwindowname', id).startsWith(title));
  } catch (error) { throw new Error(`X11 window lookup failed for ${title}: ${error}`); }
};
const windowId = (title) => {
  try {
    const matches = windowMatches(title);
    assert.equal(matches.length, 1, `Expected exactly one owned X11 window for ${title}; visible=${JSON.stringify(visibleWindowNames())}`);
    return matches[0];
  } catch (error) { throw new Error(`X11 window lookup failed for ${title}: ${error}`); }
};
const windowGeometry = (id) => Object.fromEntries(runX('getwindowgeometry', '--shell', id).split('\n')
  .map(line => line.split('='))
  .filter(([key, value]) => key && value !== undefined)
  .map(([key, value]) => [key, Number(value)]));
const windowParent = (id) => {
  const tree = runXInfo('-id', id, '-tree');
  const match = tree.match(/Parent window id: 0x([0-9a-f]+)/i);
  const root = tree.match(/Root window id: 0x([0-9a-f]+)/i);
  assert(match, `Could not determine X11 parent for owned window ${id}`);
  const parentId = String(Number.parseInt(match[1], 16));
  const rootId = root ? String(Number.parseInt(root[1], 16)) : null;
  // A direct child of the root is already focusable. Popup content can instead
  // have a separately focusable Xwayland container one level above it.
  return { id: parentId, focusId: parentId === rootId ? id : parentId, tree };
};
const activeWindow = () => {
  try { return runX('getactivewindow'); } catch { return null; }
};
const focusOwnedWindow = (id) => {
  // GNOME's Xwayland bridge can omit _NET_ACTIVE_WINDOW, so EWMH activation
  // alone is not a reliable focus operation. XSetInputFocus is scoped to the
  // uniquely named QA window and works on both plain X11 and that bridge.
  try { runX('windowfocus', '--sync', id); } catch { runX('windowactivate', '--sync', id); }
};
const setBrowserWindowBounds = async (page, bounds) => {
  const session = await context.newCDPSession(page);
  const { windowId } = await session.send('Browser.getWindowForTarget');
  await session.send('Browser.setWindowBounds', { windowId, bounds });
  const actual = await session.send('Browser.getWindowBounds', { windowId });
  return { windowId, requested: bounds, actual: actual.bounds };
};
let browser, context, source, target;
try {
  assert(process.env.DISPLAY, 'DISPLAY is required; invoke through xvfb-run with a window manager');
  browser = await chromium.launch({ headless: false, executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-features=Translate'] });
  context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 860, height: 760 } });
  await context.addInitScript(({ filePath, fileId, targetWindowName }) => {
    const target = window.name === targetWindowName;
    const tabs = target ? [] : [{ id: fileId, path: filePath, name: 'README.md', group: 'primary', refreshMode: 'manual', dirty: false }];
    localStorage.setItem('webterm:file-workbench:v1', JSON.stringify({ version: 1, connectionId: 2, tabs, active: { primary: target ? null : fileId, secondary: null }, focusedGroup: 'primary', split: false }));
    window.__nativeFileDragProbe = [];
    window.__nativePointerProbe = [];
    for (const type of ['dragstart', 'dragenter', 'dragover', 'drop', 'dragend']) document.addEventListener(type, event => window.__nativeFileDragProbe.push({ type, target: event.target?.className || event.target?.tagName, types: [...(event.dataTransfer?.types || [])] }), true);
    for (const type of ['pointermove', 'mousemove', 'mousedown', 'mouseup', 'click']) document.addEventListener(type, event => window.__nativePointerProbe.push({ type, target: event.target?.className || event.target?.tagName }), true);
  }, { filePath, fileId, targetWindowName });
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
  await source.evaluate(title => { document.title = title; }, sourceTitle);
  const popupPromise = source.waitForEvent('popup');
  await source.evaluate(name => window.open(location.href, name, 'popup=yes,width=860,height=760'), targetWindowName);
  target = await popupPromise;
  await target.waitForLoadState('networkidle');
  await target.locator('.activity-files').click();
  await target.locator('[data-testid="file-workspace"]').waitFor();
  assert.equal(await target.locator('[data-editor-tab-id]').count(), 0, 'target must not begin with the source tab');
  await target.evaluate(title => { document.title = title; }, targetTitle);
  await target.waitForTimeout(500);
  const sourceBrowserWindow = await setBrowserWindowBounds(source, { left: 20, top: 60, width: 860, height: 760 });
  const targetBrowserWindow = await setBrowserWindowBounds(target, { left: 1000, top: 60, width: 860, height: 760 });
  report.browserWindows = { source: sourceBrowserWindow, target: targetBrowserWindow };
  await source.waitForTimeout(300);
  const sourceWindow = windowId(sourceTitle);
  const sourceScaleProbe = await source.evaluate(() => ({ screenX, screenY, outerWidth, outerHeight }));
  const sourceScaleGeometry = windowGeometry(sourceWindow);
  const scaleX = sourceScaleGeometry.WIDTH / sourceScaleProbe.outerWidth;
  const scaleY = sourceScaleGeometry.HEIGHT / sourceScaleProbe.outerHeight;
  assert(Number.isFinite(scaleX) && scaleX > 0 && Number.isFinite(scaleY) && scaleY > 0, 'Unable to map browser logical metrics to X11 geometry');
  const targetMetrics = await target.evaluate(() => ({ screenX, screenY, outerWidth, outerHeight }));
  const targetCandidates = windowMatches(targetTitle).map(id => ({ id, geometry: windowGeometry(id) }));
  assert(targetCandidates.length > 0, `No owned X11 target window for ${targetTitle}`);
  // A Chrome popup can surface a guard/helper X11 window with the same title.
  // The page's logical screen coordinates identify the real content window;
  // do not choose an arbitrary last search result on a user's desktop.
  const targetWindow = targetCandidates.sort((left, right) => {
    const score = candidate => Math.abs(candidate.geometry.X - targetMetrics.screenX * scaleX) +
      Math.abs(candidate.geometry.Y - targetMetrics.screenY * scaleY) +
      Math.abs(candidate.geometry.WIDTH - targetMetrics.outerWidth * scaleX) +
      Math.abs(candidate.geometry.HEIGHT - targetMetrics.outerHeight * scaleY);
    return score(left) - score(right);
  })[0].id;
  report.targetWindowCandidates = targetCandidates;
  assert(sourceWindow !== targetWindow, 'source and target resolved to the same X11 window');
  await source.waitForTimeout(300);
  const sourceBox = await source.locator('[data-editor-tab-id]').first().boundingBox();
  const targetBox = await target.locator('[data-editor-group="primary"] .file-editor-tabs').boundingBox();
  const plainBox = await source.locator('[data-testid="file-workspace"]').boundingBox();
  assert(sourceBox && targetBox && plainBox, 'native drag source, target, or plain input probe is not visible');
  // Playwright boxes are viewport-relative, while xdotool uses X11 screen
  // coordinates. Account for Chrome's title/address chrome explicitly; using
  // xdotool --window would drop into the browser toolbar instead of the page.
  const sourceGeometry = windowGeometry(sourceWindow);
  const targetGeometry = windowGeometry(targetWindow);
  const sourceContainer = windowParent(sourceWindow);
  const targetContainer = windowParent(targetWindow);
  // Browser outer metrics are logical pixels under desktop fractional scaling,
  // while xdotool needs root-window physical pixels. Scale CSS page boxes from
  // the actual X11 window geometry rather than combining those two spaces.
  const screenPoint = async (page, box, geometry, biasX = 0) => page.evaluate(({ box, geometry, biasX }) => ({
    x: Math.round(geometry.X + (box.x + biasX) * geometry.WIDTH / window.innerWidth),
    y: Math.round(geometry.Y + (box.y + box.height / 2) * geometry.HEIGHT / window.innerHeight),
  }), { box, geometry, biasX });
  const sourcePoint = await screenPoint(source, sourceBox, sourceGeometry, sourceBox.width / 2);
  // The page-bearing X11 source maps to the CDP outer bounds at a stable
  // physical scale. Popup helper windows do not, so derive the target point
  // from its own CDP bounds using that measured source scale.
  const targetPoint = await screenPoint(target, targetBox, targetGeometry, Math.min(80, targetBox.width / 2));
  const plainPoint = await screenPoint(source, plainBox, sourceGeometry, 10);
  const [screenWidth, screenHeight] = runX('getdisplaygeometry').split(/\s+/).map(Number);
  assert(Number.isFinite(screenWidth) && Number.isFinite(screenHeight), 'X11 display geometry is unavailable');
  report.pointer = { sourcePoint, targetPoint, plainPoint, sourceBox, targetBox, plainBox, sourceWindow, sourceFocusWindow: sourceContainer.focusId, targetWindow, targetFocusWindow: targetContainer.focusId, sourceGeometry, targetGeometry,
    screen: { width: screenWidth, height: screenHeight },
    metrics: await Promise.all([source, target].map(page => page.evaluate(() => ({ screenX, screenY, outerWidth, outerHeight, innerWidth, innerHeight, devicePixelRatio })))),
  };
  assert(sourcePoint.x >= 0 && sourcePoint.x < screenWidth && sourcePoint.y >= 0 && sourcePoint.y < screenHeight,
    `source pointer is outside X11 display ${screenWidth}x${screenHeight}: ${JSON.stringify(sourcePoint)}`);
  assert(targetPoint.x >= 0 && targetPoint.x < screenWidth && targetPoint.y >= 0 && targetPoint.y < screenHeight,
    `target pointer is outside X11 display ${screenWidth}x${screenHeight}: ${JSON.stringify(targetPoint)}`);
  // On a physical desktop, a click-to-focus window manager can consume the
  // first button transition. Activate the uniquely titled QA source before
  // the input proof; this does not target or inspect another application.
  focusOwnedWindow(sourceContainer.focusId);
  report.activeWindowBeforeInput = activeWindow();
  if (report.activeWindowBeforeInput !== null) assert.equal(report.activeWindowBeforeInput, sourceWindow, 'QA source window did not become active before native input');
  // Calibrate the destination separately before any held-button operation.
  // A page-relative box is not sufficient proof under fractional desktop
  // scaling or a popup guard window; the real target must receive this click.
  focusOwnedWindow(targetContainer.focusId);
  report.activeTargetWindowBeforeInput = activeWindow();
  if (report.activeTargetWindowBeforeInput !== null) assert.equal(report.activeTargetWindowBeforeInput, targetWindow, 'QA target window did not become active before native input');
  report.targetWindowTree = targetContainer.tree;
  runX('mousemove', String(targetPoint.x), String(targetPoint.y));
  runX('click', '1');
  await target.waitForTimeout(180);
  report.targetClickDelivery = await target.evaluate(() => window.__nativePointerProbe || []);
  for (const type of ['mousedown', 'mouseup', 'click']) assert(report.targetClickDelivery.some(event => event.type === type), `X11 native ${type} did not reach target document`);
  await target.evaluate(() => { window.__nativePointerProbe = []; });
  focusOwnedWindow(sourceContainer.focusId);
  const activeSourceAfterTargetProbe = activeWindow();
  if (activeSourceAfterTargetProbe !== null) assert.equal(activeSourceAfterTargetProbe, sourceWindow, 'QA source window did not regain focus before native input');
  // Verify that the same XTEST input path can deliver a normal source click
  // before treating a missing drag sequence as an application defect.
  runX('mousemove', String(sourcePoint.x), String(sourcePoint.y));
  runX('click', '1');
  await source.waitForTimeout(180);
  report.clickDelivery = await source.evaluate(() => window.__nativePointerProbe || []);
  for (const type of ['mousedown', 'mouseup', 'click']) assert(report.clickDelivery.some(event => event.type === type), `X11 native ${type} did not reach source document`);
  await source.evaluate(() => { window.__nativePointerProbe = []; });
  // Establish whether an isolated held button is delivered at all before
  // interpreting the source tab's draggable behaviour.
  runX('mousemove', String(plainPoint.x), String(plainPoint.y));
  runX('mousedown', '1');
  await source.waitForTimeout(150);
  report.plainDownDelivery = await source.evaluate(() => window.__nativePointerProbe || []);
  runX('mouseup', '1');
  assert(report.plainDownDelivery.some(event => event.type === 'mousedown'), 'X11 native mousedown did not reach a non-draggable source document region');
  await source.evaluate(() => { window.__nativePointerProbe = []; });
  runX('mousemove', String(sourcePoint.x), String(sourcePoint.y));
  runX('mousedown', '1');
  // Let Chromium consume the physical button transition before any move. A
  // same-tick move can hide an XTEST ordering problem as an apparent app DnD
  // failure, so record and require the source mousedown explicitly.
  await source.waitForTimeout(150);
  report.downDelivery = await source.evaluate(() => window.__nativePointerProbe || []);
  // Chromium may hand a physical press on an HTML draggable element directly
  // to its native DnD controller before exposing mousedown to page listeners.
  // The preceding non-draggable control proves the held button reached the
  // document; the authoritative assertion below is dragstart/dragover/drop.
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
