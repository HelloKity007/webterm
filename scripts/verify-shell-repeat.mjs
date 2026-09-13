import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require('../ui/node_modules/playwright');
const output = 'runtime/shell-repeat-qa';
await mkdir(output, { recursive: true });
const capture = () => execFileSync('tmux', ['-L', 'webterm-release-test', 'capture-pane', '-pJt', 'wt01-01-02-2ceeceecf3172937'], { encoding: 'utf8' }).trimEnd();
// -J joins wrapped lines. Compare the complete prompt/draft, not the viewport's
// unrelated leading history, which changes when another client resizes tmux.
const draft = () => capture().split('\n').at(-1);
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: false, args: ['--no-sandbox'] });
const results = [];
try {
  for (const width of [1920, 3440]) {
    const page = await browser.newPage({ viewport: { width, height: width === 1920 ? 1080 : 1440 }, ignoreHTTPSErrors: true });
    await page.goto('https://192.168.11.87:9444/', { waitUntil: 'networkidle' });
    const panel = page.locator('.terminal-surface:visible').nth(1);
    await panel.waitFor(); await page.waitForTimeout(2000);
    const before = draft();
    const input = panel.locator('textarea.xterm-helper-textarea');
    await input.focus();
    let typed = 0;
    try {
      for (; typed < 240; typed++) await page.keyboard.down('z');
      await page.keyboard.up('z');
      await page.waitForTimeout(600);
      const after = capture();
      // No Enter: append to, but never execute or clear, the existing draft.
      assert(after.endsWith('z'.repeat(240)), 'Repeated key input must reach Bash intact');
      const actualCols = execFileSync('tmux', ['-L', 'webterm-release-test', 'display-message', '-pt', 'wt01-01-02-2ceeceecf3172937', '#{pane_width}'], { encoding: 'utf8' }).trim();
      assert.equal(await panel.getAttribute('data-shared-cols'), actualCols);
      await panel.screenshot({ path: `${output}/${width}-repeat.png` });
      results.push({ width, repeatedKeys: typed, sharedCols: actualCols, draftRestored: false });
    } finally {
      await page.keyboard.up('z');
      // Only delete our own identifiable suffix. Never clear user content.
      if (capture().endsWith('z'.repeat(typed)) && typed > 0) {
        for (let i = 0; i < typed; i++) await page.keyboard.press('Backspace');
        await page.waitForTimeout(600);
      }
    }
    assert.equal(draft(), before, 'User draft must be unchanged after cleanup');
    results.at(-1).draftRestored = true;
    await page.close();
  }
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally { await browser.close(); }
