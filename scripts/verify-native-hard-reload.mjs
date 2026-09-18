import { chromium } from '../ui/node_modules/playwright/index.mjs';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const output = 'runtime/native-hard-reload';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: false });
const results = [];
try {
  for (const number of [2, 14]) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1920, height: 1080 } });
    const page = await context.newPage();
    await page.goto('https://192.168.11.87:9444', { waitUntil: 'networkidle' });
    const tab = page.locator('[data-tab-id]').filter({ hasText: new RegExp(`^${number}:`) }).first();
    await tab.click();
    const surface = tab.locator('xpath=ancestor::*[contains(@class,"terminal-grid-cell")]').locator('.terminal-surface:visible');
    await surface.hover();
    await surface.locator('textarea').evaluate(e => e.focus({ preventScroll: true }));
    for (let i = 0; i < 27; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(100); }
    await page.waitForTimeout(1500);
    for (let round = 0; round < 5; round++) {
      await surface.locator('textarea').evaluate(e => e.focus({ preventScroll: true }));
      await page.evaluate(() => { document.title = 'WebTerm-native-reload-QA'; });
      await page.waitForTimeout(300);
      const before = await surface.evaluate(e => {
        const read = () => {
          const bar = e.querySelector('.scrollbar.vertical').getBoundingClientRect();
          const slider = e.querySelector('.scrollbar.vertical').firstElementChild.getBoundingClientRect();
          return { top: e.scrollTop, history: slider.top - bar.top };
        };
        const frames = [];
        let stopped = false;
        const sample = () => { frames.push(read()); if (!stopped) requestAnimationFrame(sample); };
        requestAnimationFrame(sample);
        window.addEventListener('beforeunload', () => {
          stopped = true; frames.push(read()); sessionStorage.setItem('qa-pre-reload-frames', JSON.stringify(frames));
        }, { once: true });
        return read();
      });
      const windowId = execFileSync('xdotool', ['search', '--name', 'WebTerm-native-reload-QA'], { encoding: 'utf8' }).trim().split('\n').at(-1);
      execFileSync('xdotool', ['windowfocus', '--sync', windowId]);
      const navigation = page.waitForEvent('framenavigated', frame => frame === page.mainFrame());
      execFileSync('xdotool', ['key', '--clearmodifiers', 'ctrl+shift+r']);
      await navigation;
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);
      const frames = await page.evaluate(() => JSON.parse(sessionStorage.getItem('qa-pre-reload-frames') || '[]'));
      assert(frames.length > 0, 'Must capture pre-navigation frames');
      for (const frame of frames) assert.deepEqual(frame, before, `Panel ${number} flashed before reload`);
      const after = await surface.evaluate(e => {
        const bar = e.querySelector('.scrollbar.vertical').getBoundingClientRect();
        const slider = e.querySelector('.scrollbar.vertical').firstElementChild.getBoundingClientRect();
        return { top: e.scrollTop, history: slider.top - bar.top };
      });
      results.push({ number, round, before, after, frames });
      assert.deepEqual(after, before, `Panel ${number} moved after hard reload`);
      await surface.screenshot({ path: `${output}/${number}-${round}.png` });
    }
    await context.close();
  }
} finally {
  await browser.close();
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
}
console.log(`PASS: ${results.length} native browser hard reloads (Linux/X11 Chromium)`);
