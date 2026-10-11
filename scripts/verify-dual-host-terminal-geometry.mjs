import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const { chromium } = createRequire(import.meta.url)('../ui/node_modules/playwright');
const origin = 'https://192.168.11.87:9444';
const output = process.env.WEBTERM_QA_OUTPUT || 'runtime/geometry-20260929/dual-host-r10';
const health = () => JSON.parse(execFileSync('curl', ['-ks', `${origin}/api/health`], { encoding: 'utf8' }));
const candidate = health();
assert.equal(candidate.environment, 'release-test');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: false, args: ['--no-sandbox'] });
const events = [], samples = [], errors = [], clients = [], finalStates = [];
let status = 'FAIL';

const open = async (name, width, height) => {
  const context = await browser.newContext({ viewport: { width, height }, ignoreHTTPSErrors: true,
    recordVideo: { dir: `${output}/video`, size: { width: 1280, height: 720 } } });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', ws => {
    if (!ws.url().includes('/ws/ssh/')) return;
    const id = new URL(ws.url()).searchParams.get('terminal_id');
    ws.on('framesent', ({ payload }) => {
      try {
        const message = JSON.parse(String(payload));
        if (message.cols || message.action === 'take_size_control') events.push({ time: Date.now(), name, id, send: message });
      } catch { /* ignore non-geometry frames */ }
    });
    ws.on('framereceived', ({ payload }) => {
      try {
        const message = JSON.parse(String(payload));
        if (!message.data) return;
        const data = message.b64 ? Buffer.from(message.data, 'base64').toString() : message.data;
        const grids = [...data.matchAll(/webterm-grid:(\d+)x(\d+)/g)].map(match => `${match[1]}x${match[2]}`);
        if (grids.length) events.push({ time: Date.now(), name, id, grids });
      } catch { /* never record terminal text or credentials */ }
    });
  });
  await page.goto(origin);
  // Two independently focused physical devices can both report hasFocus=true.
  // This is an explicit browser approximation, not a native two-host claim.
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const tab = page.locator('[data-tab-id]').filter({ hasText: /^6:/ }).first();
  await tab.click();
  const id = await tab.getAttribute('data-tab-id');
  const surface = tab.locator('xpath=ancestor::*[contains(@class,"terminal-grid-cell")]').locator('.terminal-surface:visible');
  await surface.scrollIntoViewIfNeeded();
  await page.waitForFunction(e => e.dataset.gridAuthority === 'server' && e.dataset.rendererReady === 'true', await surface.elementHandle());
  const client = { name, context, page, surface, id };
  clients.push(client);
  return client;
};
const measure = client => client.surface.evaluate(e => {
  const screen = e.querySelector('.xterm-screen').getBoundingClientRect();
  return { focus: document.hasFocus(), cols: +e.dataset.sharedCols, rows: +e.dataset.sharedRows,
    requestedCols: +e.dataset.requestedCols, requestedRows: +e.dataset.requestedRows,
    font: +e.dataset.fittedFontSize, width: e.clientWidth, height: e.clientHeight,
    screenWidth: screen.width, screenHeight: screen.height, scrollWidth: e.scrollWidth, scrollHeight: e.scrollHeight };
});
const aligned = async client => {
  await client.surface.evaluate(e => { delete e.__qaDualHostStable; });
  await client.page.waitForFunction(e => {
    const r = e.querySelector('.xterm-screen').getBoundingClientRect();
    const width = e.clientWidth - parseFloat(getComputedStyle(e).paddingLeft);
    if (!(e.dataset.sharedCols === e.dataset.requestedCols && e.dataset.sharedRows === e.dataset.requestedRows &&
      e.dataset.gridAuthority === 'server' && e.dataset.rendererReady === 'true' &&
      r.width <= width + 1 && r.height <= e.clientHeight + 1)) {
      delete e.__qaDualHostStable;
      return false;
    }
    const key = [e.dataset.sharedCols, e.dataset.sharedRows, width, e.clientHeight, r.width, r.height].join(':');
    if (e.__qaDualHostStable?.key !== key) {
      e.__qaDualHostStable = { key, since: performance.now() };
      return false;
    }
    return performance.now() - e.__qaDualHostStable.since >= 500;
  }, await client.surface.elementHandle());
};
const activate = async client => {
  await client.surface.locator('.xterm-helper-textarea').focus();
  await client.page.keyboard.press('Shift'); // no draft text and never Enter
  await aligned(client);
};
const hold = async (controller, mirror, label) => {
  const initial = await measure(controller);
  assert(initial.focus && (await measure(mirror)).focus, 'both device-focus approximations must remain focused');
  await mirror.page.waitForFunction(({ e, cols, rows }) => +e.dataset.sharedCols === cols && +e.dataset.sharedRows === rows,
    { e: await mirror.surface.elementHandle(), cols: initial.cols, rows: initial.rows });
  // Leave both pages quiet. A passive redraw/scrollbar must not transfer size.
  for (let index = 0; index < 10; index++) {
    await controller.page.waitForTimeout(500);
    const a = await measure(controller), b = await measure(mirror);
    samples.push({ label, index, controller: a, mirror: b });
    assert(a.focus && b.focus);
    assert.equal(a.cols, initial.cols, 'passive focused peer reclaimed columns');
    assert.equal(a.rows, initial.rows, 'passive focused peer reclaimed rows');
    assert.equal(b.cols, initial.cols, 'mirror does not follow controller columns');
    assert.equal(b.rows, initial.rows, 'mirror does not follow controller rows');
    assert.equal(a.font, 16); assert.equal(b.font, 16);
  }
  await controller.surface.screenshot({ path: `${output}/${label}-controller.png` });
  await mirror.surface.screenshot({ path: `${output}/${label}-mirror.png` });
};
try {
  const small = await open('small', 2860, 988);
  const peer = await open('peer', 3836, 1398);
  assert.equal(small.id, peer.id, 'must exercise the same verified terminal identity');
  await activate(peer);
  // Match the observed peer grid using only that peer's local viewport.
  for (let attempt = 0; attempt < 5; attempt++) {
    const m = await measure(peer);
    if (m.requestedCols === 104 && m.requestedRows === 30) break;
    const viewport = peer.page.viewportSize();
    await peer.page.setViewportSize({
      width: Math.round(viewport.width + (104 - m.requestedCols) * m.screenWidth / m.cols * 4),
      height: Math.round(viewport.height + (30 - m.requestedRows) * m.screenHeight / m.rows * 2),
    });
    await peer.page.waitForTimeout(500);
    await activate(peer);
  }
  const peerGrid = await measure(peer);
  assert.equal(peerGrid.requestedCols, 104); assert.equal(peerGrid.requestedRows, 30);
  await hold(peer, small, 'peer-104x30');
  await activate(small);
  const smallGrid = await measure(small);
  assert.equal(smallGrid.requestedCols, 77); assert.equal(smallGrid.requestedRows, 34);
  await hold(small, peer, 'small-77x34');
  assert.equal(health().version, candidate.version);
  assert.deepEqual(errors, []);
  status = 'PASS';
} finally {
  for (const client of clients) {
    try {
      finalStates.push({ name: client.name, state: await measure(client) });
      if (status !== 'PASS') await client.surface.screenshot({ path: `${output}/failure-${client.name}.png` });
    } catch { /* retain the original assertion if a page has already closed */ }
  }
  await browser.close();
  await writeFile(`${output}/results.json`, JSON.stringify({ candidate, status,
    scope: 'two simultaneously focused browser contexts; physical hosts NOT RUN', samples, events, errors, finalStates }, null, 2));
}
console.log('PASS: last deliberate controller stable with both device-focus approximations active');
