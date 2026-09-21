import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '../ui/node_modules/playwright/index.mjs';
import { sendWindowsNativeClick, sendWindowsNativeDrag } from './windows-native-key.mjs';

// Isolates the Windows OS-input/Edge HTML5 DnD path from WebTerm. This is not
// a product acceptance test: a failure here proves only that the dedicated
// remote-input desktop cannot produce browser drag events.
const output = resolve(process.env.WEBTERM_QA_OUTPUT || 'runtime/windows-native-html5-drag');
await mkdir(output, { recursive: true, mode: 0o700 });
const browser = await chromium.connectOverCDP(process.env.WEBTERM_QA_CDP || 'http://127.0.0.1:19335');
let context;
let source;
let target;
const report = { status: 'RUNNING', scope: 'two real Windows Edge QA popups; generic HTML5 draggable probe; OS mouse input only' };

const html = (destination) => `<!doctype html><meta charset="utf-8"><style>
  body { margin: 0; background: #111; color: #fff; font: 18px sans-serif; }
  #drag, #drop { margin: 100px; width: 240px; height: 90px; display: grid; place-items: center; border: 2px solid #75d; }
  #drag { background: #246; } #drop { background: #264; }
</style><div id="${destination ? 'drop' : 'drag'}" ${destination ? '' : 'draggable="true"'}>${destination ? 'drop target' : 'drag source'}</div>
<script>
  window.__events = [];
  for (const type of ['pointerdown', 'mousedown', 'dragstart', 'dragenter', 'dragover', 'drop', 'dragend']) {
    document.addEventListener(type, event => window.__events.push({ type, x: event.clientX, y: event.clientY, target: event.target.id }), true);
  }
  const drag = document.querySelector('#drag');
  if (drag) drag.addEventListener('dragstart', event => event.dataTransfer.setData('text/plain', 'probe'));
  const drop = document.querySelector('#drop');
  if (drop) { drop.addEventListener('dragover', event => event.preventDefault()); drop.addEventListener('drop', event => { event.preventDefault(); drop.textContent = 'dropped'; }); }
</script>`;

const pointFor = (page, box) => page.evaluate((box) => ({
  x: Math.round(window.screenX + (window.outerWidth - window.innerWidth) / 2 + box.x + box.width / 2),
  y: Math.round(window.screenY + (window.outerHeight - window.innerHeight) + box.y + box.height / 2),
}), box);
const browserWindow = async (page) => {
  const session = await context.newCDPSession(page);
  const { windowId } = await session.send('Browser.getWindowForTarget');
  return { session, windowId };
};

try {
  context = await browser.newContext({ viewport: null });
  source = await context.newPage();
  await source.setContent(html(false));
  await source.evaluate(() => { document.title = 'WebTerm-native-file-source'; });
  const sourceWindow = await browserWindow(source);
  await sourceWindow.session.send('Browser.setWindowBounds', { windowId: sourceWindow.windowId, bounds: { left: 20, top: 40, width: 840, height: 560 } });
  const popup = source.waitForEvent('popup');
  await source.evaluate(() => window.open('about:blank', 'webterm-native-html5-target', 'popup=yes,width=840,height=560'));
  target = await popup;
  await target.setContent(html(true));
  await target.evaluate(() => { document.title = 'WebTerm-native-html5-target'; });
  const targetWindow = await browserWindow(target);
  await targetWindow.session.send('Browser.setWindowBounds', { windowId: targetWindow.windowId, bounds: { left: 920, top: 40, width: 840, height: 560 } });
  await target.waitForTimeout(300);
  const sourceBox = await source.locator('#drag').boundingBox();
  const targetBox = await target.locator('#drop').boundingBox();
  assert(sourceBox && targetBox, 'generic source/target must be visible');
  const sourcePoint = await pointFor(source, sourceBox);
  const targetPoint = await pointFor(target, targetBox);
  report.pointer = { sourcePoint, targetPoint, sourceBox, targetBox };
  report.click = await sendWindowsNativeClick({ sourceTitle: 'WebTerm-native-file-source', point: sourcePoint });
  await source.waitForTimeout(150);
  report.clickEvents = await source.evaluate(() => window.__events);
  assert(report.clickEvents.some((event) => event.type === 'mousedown'), 'native click did not reach generic source');
  await Promise.all([source, target].map((page) => page.evaluate(() => { window.__events = []; })));
  report.drag = await sendWindowsNativeDrag({ sourceTitle: 'WebTerm-native-file-source', sourcePoint, targetPoint, steps: 18 });
  await target.waitForTimeout(500);
  report.events = await Promise.all([source, target].map((page) => page.evaluate(() => window.__events)));
  report.dropText = await target.locator('#drop').textContent();
  assert(report.events[0].some((event) => event.type === 'dragstart'), 'generic source did not receive dragstart');
  assert(report.events[1].some((event) => event.type === 'dragover'), 'generic target did not receive dragover');
  assert.equal(report.dropText, 'dropped');
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.error = String(error); process.exitCode = 1;
  if (source || target) report.events = await Promise.all([source, target].filter(Boolean).map((page) => page.evaluate(() => window.__events || []).catch(() => [])));
} finally {
  await Promise.all([source?.close(), target?.close()].filter(Boolean));
  await context?.close();
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2), { mode: 0o600 });
}
console.log(JSON.stringify({ status: report.status, output, error: report.error }));
process.exit(process.exitCode || 0);
