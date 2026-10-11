import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = createRequire(import.meta.url)('../ui/node_modules/playwright');
const output = process.env.WEBTERM_QA_OUTPUT || 'runtime/wide-short-panel';
await mkdir(output, { recursive: true });

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const result = {};
const openPanel6 = async (width, height) => {
  const context = await browser.newContext({ viewport: { width, height }, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.goto('https://192.168.11.87:9444/', { waitUntil: 'networkidle' });
  const tab = page.locator('[data-tab-id]').filter({ hasText: /^6:/ }).first();
  await tab.click();
  const panel = tab.locator('xpath=ancestor::*[contains(@class,"terminal-grid-cell")]').locator('.terminal-surface:visible');
  await panel.scrollIntoViewIfNeeded();
  await page.waitForTimeout(3000);
  return { context, page, panel };
};
const measure = panel => panel.evaluate(surface => {
  const bounds = surface.getBoundingClientRect();
  const screen = surface.querySelector('.xterm-screen')?.getBoundingClientRect();
  return {
    layoutColumns: Number(surface.closest('.terminal-grid')?.dataset.panelColumns),
    font: Number(surface.dataset.fittedFontSize),
    cols: Number(surface.dataset.sharedCols),
    rows: Number(surface.dataset.sharedRows),
    width: surface.clientWidth,
    height: surface.clientHeight,
    rightGap: screen ? Math.round(bounds.right - screen.right) : null,
    bottomGap: screen ? Math.round(bounds.bottom - screen.bottom) : null,
    outerScroll: surface.scrollWidth > surface.clientWidth + 1 || surface.scrollHeight > surface.clientHeight + 1,
  };
});

try {
  const wide = await openPanel6(2860, 988);
  result.wideBefore = await measure(wide.panel);
  await wide.panel.screenshot({ path: `${output}/wide-before.png` });
  const tall = await openPanel6(3440, 1440);
  await wide.page.waitForTimeout(1000);
  result.wideAfter = await measure(wide.panel);
  result.tall = await measure(tall.panel);
  await wide.panel.screenshot({ path: `${output}/wide-after.png` });
  await tall.panel.screenshot({ path: `${output}/tall.png` });

  assert.equal(result.wideAfter.layoutColumns, 4);
  assert(result.wideAfter.rows <= 37, `wide short display grew shared rows: ${JSON.stringify(result)}`);
  assert(result.wideAfter.rightGap <= 80, `wide short Panel remains mostly blank: ${JSON.stringify(result)}`);
  assert(result.tall.rightGap <= 30, `peer widened the tall Panel's right gap: ${JSON.stringify(result)}`);
  for (const frame of [result.wideAfter, result.tall]) {
    assert(!frame.outerScroll && frame.rightGap >= 0 && frame.bottomGap >= 0, `terminal frame clipped: ${JSON.stringify(frame)}`);
  }
  await tall.context.close();
  await wide.context.close();
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  await browser.close();
}
