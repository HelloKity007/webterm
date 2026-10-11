import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = createRequire(import.meta.url)('../ui/node_modules/playwright');
const output = process.env.WEBTERM_QA_OUTPUT || 'runtime/cli-legibility';
const url = process.env.WEBTERM_QA_URL || 'https://192.168.11.87:9444/';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const frames = [];

async function open(width, height) {
  const context = await browser.newContext({ viewport: { width, height }, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(url, { waitUntil: 'networkidle' });
  return { context, page, errors };
}

async function measure(view, number, name) {
  const tab = view.page.locator('[data-tab-id]').filter({ hasText: new RegExp(`^${number}:`) }).first();
  await tab.click();
  const surface = tab.locator('xpath=ancestor::*[contains(@class,"terminal-grid-cell")]').locator('.terminal-surface:visible');
  await surface.scrollIntoViewIfNeeded();
  await view.page.waitForTimeout(3000);
  const metric = await surface.evaluate(element => {
    const screen = element.querySelector('.xterm-screen')?.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    return {
      mode: element.dataset.terminalMode,
      cols: Number(element.dataset.sharedCols),
      rows: Number(element.dataset.sharedRows),
      font: Number(element.dataset.fittedFontSize),
      lineHeight: Number(element.dataset.fittedLineHeight),
      width: element.clientWidth,
      height: element.clientHeight,
      rightGap: screen ? Math.round(box.right - screen.right) : null,
      bottomGap: screen ? Math.round(box.bottom - screen.bottom) : null,
      topGap: screen ? Math.round(screen.top - box.top) : null,
      outerScroll: element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1,
    };
  });
  await surface.screenshot({ path: `${output}/${name}-panel${number}.png` });
  frames.push({ name, panel: number, metric, errors: [...view.errors] });
  return metric;
}

try {
  const wide = await open(2860, 988);
  const codexBefore = await measure(wide, 3, 'wide-before');
  const claudeBefore = await measure(wide, 6, 'wide-before');
  const tall = await open(3440, 1440);
  const codexTall = await measure(tall, 3, 'tall');
  const claudeTall = await measure(tall, 6, 'tall');
  const codexAfter = await measure(wide, 3, 'wide-after');
  const claudeAfter = await measure(wide, 6, 'wide-after');

  for (const frame of frames) {
    const { metric } = frame;
    assert.equal(frame.errors.length, 0, `${frame.name} Panel ${frame.panel} raised a browser error`);
    assert.equal(metric.mode, 'cli', `${frame.name} Panel ${frame.panel} is not a CLI`);
    assert(metric.font >= 13.2, `${frame.name} Panel ${frame.panel} text is too small: ${JSON.stringify(metric)}`);
    assert(!metric.outerScroll && metric.topGap >= 0 && metric.bottomGap >= 0 && metric.rightGap >= 0,
      `${frame.name} Panel ${frame.panel} clips the frame: ${JSON.stringify(metric)}`);
    assert(metric.rightGap <= (frame.name === 'tall' ? 70 : 10),
      `${frame.name} Panel ${frame.panel} leaves excessive right space: ${JSON.stringify(metric)}`);
  }
  assert.equal(codexBefore.font, codexAfter.font, 'Codex font changed when the tall peer joined');
  assert.equal(claudeBefore.font, claudeAfter.font, 'Claude font changed when the tall peer joined');
  assert.deepEqual([codexTall.cols, codexTall.rows], [codexAfter.cols, codexAfter.rows]);
  assert.deepEqual([claudeTall.cols, claudeTall.rows], [claudeAfter.cols, claudeAfter.rows]);
  await tall.context.close();
  await wide.context.close();
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify(frames, null, 2));
  console.log(JSON.stringify(frames));
  await browser.close();
}
