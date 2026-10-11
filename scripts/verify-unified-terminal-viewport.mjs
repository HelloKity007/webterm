import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = createRequire(import.meta.url)('../ui/node_modules/playwright');
const origin = process.env.WEBTERM_GEOMETRY_DEV_URL || 'http://127.0.0.1:5173';
const output = process.env.WEBTERM_QA_OUTPUT || 'runtime/geometry-viewport';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: Number(process.env.WEBTERM_QA_DPR || 1), recordVideo: { dir: output } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
await page.route(`${origin}/geometry-harness`, route => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
const results = [];
try {
  await page.goto(`${origin}/geometry-harness`);
  await page.evaluate(async () => {
    await import('/node_modules/@xterm/xterm/css/xterm.css');
    await import('/src/App.css');
    const { Terminal } = await import('/node_modules/@xterm/xterm/lib/xterm.mjs');
    const { createDesktopTerminalViewport } = await import('/src/components/terminal/desktopTerminalViewport.ts');
    const surface = document.createElement('div');
    surface.className = 'terminal-surface desktop-local-viewport';
    Object.assign(surface.style, { width: '900px', height: '320px', overflow: 'auto' });
    document.body.append(surface);
    const term = new Terminal({ cols: 100, rows: 40, fontSize: 16, scrollback: 2000 });
    term.open(surface);
    const view = createDesktopTerminalViewport(term, surface, () => {});
    window.fixture = { surface, term, view };
    await new Promise(resolve => term.write(Array.from({ length: 300 }, (_, i) => `history-${String(i).padStart(4, '0')}\r\n`).join(''), resolve));
    view.refresh();
    view.revealCursor();
  });
  await page.waitForFunction(() => window.fixture.surface.scrollHeight > 3000);
  const measure = () => page.evaluate(() => {
    const { surface, term } = window.fixture;
    const visibleRails = [...surface.querySelectorAll('.scrollbar.vertical')].filter(el => getComputedStyle(el).display !== 'none').length;
    return { top: surface.scrollTop, extent: surface.scrollHeight, height: surface.clientHeight,
      base: term.buffer.active.baseY, line: term.buffer.active.viewportY,
      screenTop: surface.querySelector('.xterm-screen').getBoundingClientRect().top - surface.getBoundingClientRect().top,
      cell: surface.querySelector('.xterm-screen').getBoundingClientRect().height / term.rows,
      visibleRails, font: term.options.fontSize };
  });
  results.push(await measure());
  assert.equal(results[0].visibleRails, 0, 'xterm duplicates the native surface rail');
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => { const { surface, view } = window.fixture; surface.scrollTop = 0; view.refresh(); });
    await page.waitForFunction(() => window.fixture.term.buffer.active.viewportY === 0);
    const top = await measure();
    assert(Math.abs(top.screenTop) < top.cell, `history top not visible: ${JSON.stringify(top)}`);
    results.push(top);
    await page.screenshot({ path: `${output}/history-${i}.png` });
    await page.evaluate(() => window.fixture.view.revealCursor());
    await page.waitForFunction(() => window.fixture.term.buffer.active.viewportY === window.fixture.term.buffer.active.baseY);
    const bottom = await measure();
    assert(bottom.top > bottom.base * bottom.cell, 'live frame tail not reachable');
    results.push(bottom);
  }
  await page.evaluate(() => window.fixture.view.scrollLines(-3));
  const wheeled = await measure();
  assert(Math.abs(results.at(-1).top - wheeled.top - 3 * wheeled.cell) < 2, 'wheel skipped between independent scroll coordinates');
  await page.evaluate(() => window.fixture.term.scrollToLine(10));
  await page.evaluate(async () => {
    await new Promise(resolve => window.fixture.term.write('background-output\r\n', resolve));
  });
  assert.equal((await measure()).line, 10, 'background output stole a restored history reader');
  await page.evaluate(async () => {
    const { term, view } = window.fixture;
    await new Promise(resolve => term.write('\x1b[?1049h\x1b[40;1Hstatusline\x1b[38;1Hcomposer', resolve));
    view.revealCursor();
  });
  const alternate = await measure();
  assert.equal(alternate.base, 0);
  assert(alternate.top > 0, 'alternate-screen composer tail inaccessible');
  assert(alternate.screenTop + 40 * alternate.cell <= alternate.height + 1, 'statusline below composer is clipped');
  assert.equal(alternate.font, 16);
  await page.screenshot({ path: `${output}/alternate.png` });
  assert.deepEqual(errors, []);
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify({ results, errors }, null, 2));
  await context.close();
  await browser.close();
}
console.log('PASS: unified history/live-frame scroll and alternate-screen cursor');
