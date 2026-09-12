import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require('../ui/node_modules/playwright');
const output = process.env.WEBTERM_QA_OUTPUT || 'runtime/claude-composer-qa';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: false, args: ['--no-sandbox'] });
const results = [];
try {
  for (const [width, height] of [[1920,1080],[2860,988],[3440,1440]]) {
    const context = await browser.newContext({ viewport: { width, height }, ignoreHTTPSErrors: true });
    const health = await (await context.request.get('https://192.168.11.87:9444/api/health')).json();
    assert.equal(health.environment, 'release-test');
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto('https://192.168.11.87:9444/', { waitUntil: 'networkidle' });
    const panel = page.locator('.terminal-surface:visible').nth(5);
    await panel.waitFor();
    const layout = await page.locator('.terminal-grid').evaluate(e => {
      const bounds = e.getBoundingClientRect();
      return { columns: Number(e.dataset.panelColumns), rows: Number(e.dataset.panelRows),
        scrollHeight: e.scrollHeight, clientHeight: e.clientHeight,
        firstScreenPanels: Array.from(e.querySelectorAll('.terminal-surface')).filter(p => {
          const r = p.getBoundingClientRect();
          return r.width > 0 && r.top >= bounds.top && r.bottom <= bounds.bottom + 1;
        }).length };
    });
    assert.equal(layout.columns, width < 3000 ? 2 : 4);
    assert.equal(layout.firstScreenPanels, width < 3000 ? 4 : 8);
    if (width < 3000) assert(layout.scrollHeight > layout.clientHeight);
    await page.screenshot({ path: `${output}/${width}-layout.png` });
    await panel.scrollIntoViewIfNeeded();
    await page.waitForTimeout(5000);
    const measure = () => panel.evaluate(e => {
      const screen = e.querySelector('.xterm-screen').getBoundingClientRect();
      const bar = e.querySelector('.scrollbar.vertical').getBoundingClientRect();
      return { authority: e.dataset.gridAuthority, font: e.dataset.fittedFontSize, cols: Number(e.dataset.sharedCols), rows: Number(e.dataset.sharedRows), rightGap: bar.left - screen.right, bottomGap: e.getBoundingClientRect().bottom - screen.bottom };
    });
    const before = await measure();
    await panel.screenshot({ path: `${output}/${width}-before.png` });
    await panel.hover();
    for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, -100); await page.waitForTimeout(80); }
    await page.waitForTimeout(200);
    await panel.screenshot({ path: `${output}/${width}-history.png` });
    for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 100); await page.waitForTimeout(80); }
    await page.waitForTimeout(5000);
    const after = await measure();
    await panel.screenshot({ path: `${output}/${width}-returned.png` });
    results.push({ width, height, health, layout, before, after, errors });
    assert.equal(before.authority, 'server');
    assert(before.bottomGap >= 0 && before.rightGap >= 0);
    assert.equal(after.rows, before.rows);
    assert.equal(after.cols, before.cols);
    assert(after.bottomGap >= 0 && after.rightGap >= 0);
    assert.equal(errors.length, 0);
    await context.close();
  }
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  await browser.close();
}
