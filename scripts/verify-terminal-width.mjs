import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require('../ui/node_modules/playwright');
const output = process.env.WEBTERM_QA_OUTPUT || 'runtime/terminal-width-qa';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: false, args: ['--no-sandbox'] });
const results = [];
try {
  for (const [width, height, deviceScaleFactor] of [[1920,1080,1],[1920,1080,1.25],[2860,988,1.203125],[3440,1440,1]]) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor, ignoreHTTPSErrors: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    const health = await (await context.request.get('https://192.168.11.87:9444/api/health')).json();
    assert.equal(health.environment, 'release-test');
    await page.goto('https://192.168.11.87:9444/', { waitUntil: 'networkidle' });
    await page.locator('.terminal-surface:visible').first().waitFor();
    await page.waitForTimeout(2000);
    // xterm intentionally suspends offscreen renderers. Visit the extra row
    // before measuring it so the check covers its first visible frame too.
    await page.locator('.terminal-grid').evaluate(e => { e.scrollTop = e.scrollHeight; });
    await page.waitForTimeout(1000);
    const panels = await page.locator('.terminal-surface:visible').evaluateAll(es => es.map(e => {
      const s = e.querySelector('.xterm-screen').getBoundingClientRect();
      const b = e.querySelector('.scrollbar.vertical').getBoundingClientRect();
      return { cols: e.dataset.sharedCols, gap: b.left - s.right, edge: e.getBoundingClientRect().right - b.right, heightOverflow: s.height - e.clientHeight };
    }));
    results.push({ width, height, deviceScaleFactor, health, panels, errors });
    await page.screenshot({ path: `${output}/${width}-${deviceScaleFactor}.png` });
    await context.close();
  }
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  for (const result of results) {
    assert.equal(result.errors.length, 0);
    for (const panel of result.panels) {
      assert(panel.gap >= -0.05 && panel.gap < 5, `scrollbar boundary gap ${panel.gap} at ${result.width}/${result.deviceScaleFactor}`);
      assert(Math.abs(panel.edge) < 1);
      assert(panel.heightOverflow <= 1);
    }
  }
} finally { await browser.close(); }
