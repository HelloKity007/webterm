import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { visualReloadPhase } from './visual-reload-phase.mjs';
const { chromium } = createRequire(import.meta.url)('../ui/node_modules/playwright');
const target = 'wt01-01-06-ee8f330da4330735';
const tmux = args => execFileSync(process.env.WEBTERM_QA_TMUX_BINARY || 'tmux', ['-L', process.env.WEBTERM_QA_TMUX_SOCKET || 'webterm-release-test-fixed', ...args], { encoding: 'utf8' }).trimEnd();
const composer = () => {
  assert.equal(tmux(['display-message', '-pt', target, '#{pane_current_command}']), 'claude');
  const lines = tmux(['capture-pane', '-pt', target]).split('\n');
  const start = lines.findLastIndex(line => line.startsWith('❯'));
  assert(start >= 0, 'Claude composer not found');
  const end = lines.findIndex((line, i) => i > start && /^─{5}/.test(line));
  assert(end > start, 'Composer boundary not found');
  return lines.slice(start, end).join('').replace(/^❯/, '').replace(/\s/g, '');
};
const output = process.env.WEBTERM_QA_OUTPUT || 'runtime/claude-repeat';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: false, args: ['--no-sandbox'] });
const results = [];
try {
  for (const width of [1920, 3440]) {
    const page = await browser.newPage({ viewport: { width, height: width === 1920 ? 1080 : 1440 }, ignoreHTTPSErrors: true });
    await page.goto('https://192.168.11.87:9444/', { waitUntil: 'networkidle' }); await visualReloadPhase(page);
    const tab = page.locator('[data-tab-id]').filter({ hasText: /^6:/ }); await tab.click();
    const panel = tab.locator('xpath=ancestor::*[contains(@class,"terminal-grid-cell")]').locator('.terminal-surface:visible');
    await panel.scrollIntoViewIfNeeded(); await page.waitForTimeout(1000);
    assert.equal(composer(), '', 'Never overwrite an existing Claude draft');
    await panel.locator('.xterm-helper-textarea').focus();
    let typed = 0;
    try {
      while (typed < 160) {
        await page.keyboard.down('z'); typed++;
        if (typed % 40 === 0) { await page.waitForTimeout(150); await panel.screenshot({ path: `${output}/${width}-${typed}.png` }); }
      }
      await page.keyboard.up('z'); await page.waitForTimeout(400);
      assert.equal(composer(), 'z'.repeat(typed), 'Repeated input did not arrive intact');
    } finally {
      await page.keyboard.up('z');
      if (composer() === 'z'.repeat(typed)) {
        for (let i = 0; i < typed; i++) await page.keyboard.press('Backspace');
        await page.waitForTimeout(400);
      }
    }
    assert.equal(composer(), '', 'QA text must be removed, without submitting a prompt');
    results.push({ width, keys: typed, draftRestored: true }); await page.close();
  }
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
} finally { await browser.close(); }
