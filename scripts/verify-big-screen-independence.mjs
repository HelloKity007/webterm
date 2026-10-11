import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = createRequire(import.meta.url)('../ui/node_modules/playwright');
const output = process.env.WEBTERM_QA_OUTPUT || 'runtime/big-screen-independence';
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
    font: Number(surface.dataset.fittedFontSize),
    cols: Number(surface.dataset.sharedCols),
    rows: Number(surface.dataset.sharedRows),
    width: surface.clientWidth,
    height: surface.clientHeight,
    outerScroll: surface.scrollWidth > surface.clientWidth + 1 || surface.scrollHeight > surface.clientHeight + 1,
    topGap: screen ? Math.round(screen.top - bounds.top) : null,
    bottomGap: screen ? Math.round(bounds.bottom - screen.bottom) : null,
    rightGap: screen ? Math.round(bounds.right - screen.right) : null,
  };
});

try {
  const big = await openPanel6(3440, 1440);
  result.bigBefore = await measure(big.panel);
  await big.panel.screenshot({ path: `${output}/big-before.png` });
  const small = await openPanel6(1920, 1080);
  result.small = await measure(small.panel);
  await small.panel.screenshot({ path: `${output}/small.png` });
  await big.page.waitForTimeout(3000);
  result.bigAfter = await measure(big.panel);
  await big.panel.screenshot({ path: `${output}/big-after.png` });

  assert(result.bigBefore.font > result.small.font, 'large Panel did not retain its independent larger font');
  assert(Math.abs(result.bigBefore.font - result.bigAfter.font) < 0.05, 'small peer changed large Panel font');
  assert.deepEqual([result.bigAfter.cols, result.bigAfter.rows], [result.small.cols, result.small.rows]);
  assert(result.bigBefore.rightGap <= 30 && result.bigAfter.rightGap <= 30,
    `large Panel leaves unused right space: ${JSON.stringify(result)}`);
  for (const frame of [result.bigBefore, result.bigAfter, result.small]) {
    assert(!frame.outerScroll && frame.topGap >= -1 && frame.bottomGap >= 0, `terminal frame does not fit: ${JSON.stringify(frame)}`);
  }
  await small.context.close();
  await big.context.close();
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  await browser.close();
}
