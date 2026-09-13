import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { visualReloadPhase } from './visual-reload-phase.mjs';
const { chromium } = createRequire(import.meta.url)('../ui/node_modules/playwright');
const output = process.env.WEBTERM_QA_OUTPUT || 'runtime/peer-font-stability';
await mkdir(output, { recursive: true });
const identity = () => execFileSync('tmux', ['-L', 'webterm-release-test', 'display-message', '-pt', 'wt01-01-06-ee8f330da4330735', '#{pid}:#{session_created}:#{pane_pid}:#{pane_current_command}'], { encoding: 'utf8' }).trim();
const original = identity();
assert(original.endsWith(':claude'), 'Panel 6 must already be running Claude');
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: false, args: ['--no-sandbox'] });
const result = { original };
const open = async width => {
  const page = await browser.newPage({ viewport: { width, height: width === 1920 ? 1080 : 1440 }, ignoreHTTPSErrors: true });
  await page.goto('https://192.168.11.87:9444/', { waitUntil: 'networkidle' });
  await visualReloadPhase(page);
  const tab = page.locator('[data-tab-id]').filter({ hasText: /^6:/ });
  await tab.click();
  const pane = tab.locator('xpath=ancestor::*[contains(@class,"terminal-grid-cell")]').locator('.terminal-surface:visible');
  await pane.scrollIntoViewIfNeeded(); await page.waitForTimeout(2500);
  return { page, pane };
};
const measure = pane => pane.evaluate(e => ({ font: Number(e.dataset.fittedFontSize), cols: Number(e.dataset.sharedCols), rows: Number(e.dataset.sharedRows), width: e.clientWidth, height: e.clientHeight }));
try {
  const small = await open(1920);
  result.before = await measure(small.pane);
  await small.pane.screenshot({ path: `${output}/small-before.png` });
  const large = await open(3440);
  await small.page.waitForTimeout(2000);
  result.after = await measure(small.pane);
  result.large = await measure(large.pane);
  await small.pane.screenshot({ path: `${output}/small-after.png` });
  await large.pane.screenshot({ path: `${output}/large.png` });
  assert.equal(identity(), original, 'Existing Claude session must survive');
  assert.equal(result.after.width, result.before.width);
  assert.equal(result.after.height, result.before.height);
  assert(Math.abs(result.after.font - result.before.font) < 0.05, 'Peer attachment changed the unchanged small viewport font');
} finally {
  await browser.close();
  result.finalIdentity = identity();
  await writeFile(`${output}/results.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
