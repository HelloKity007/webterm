import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { visualReloadPhase } from './visual-reload-phase.mjs';
const { chromium } = createRequire(import.meta.url)('../ui/node_modules/playwright');
const output = process.env.WEBTERM_QA_OUTPUT || 'runtime/terminal-switch-stability';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: false, args: ['--no-sandbox'] });
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
  await page.goto('https://192.168.11.87:9444/', { waitUntil: 'networkidle' });
  await visualReloadPhase(page);
  await page.locator('[data-tab-id]').first().waitFor();
  for (const width of [1920, 3440, 1920, 3440]) {
    await page.setViewportSize({ width, height: width === 1920 ? 1080 : 1440 });
    await page.waitForTimeout(2000);
    const group = page.locator('.terminal-grid-cell').filter({ has: page.locator('[data-tab-id]') });
    let pane;
    for (const item of await group.all()) if (await item.locator('[data-tab-id]').count() > 1) { pane = item; break; }
    assert(pane);
    const tabs = pane.locator('[data-tab-id]');
    const original = await pane.locator('[data-active="true"]').getAttribute('data-tab-id');
    const restore = () => pane.locator(`[data-tab-id="${original}"]`).click();
    try {
      await tabs.nth(0).click(); await page.waitForTimeout(1000);
      await pane.evaluate(e => { e.__qaTerminal = e.querySelector('.terminal-surface'); });
      for (let i = 0; i < 5; i++) {
        await tabs.nth(1).click(); await page.waitForTimeout(150);
        await tabs.nth(0).click(); await page.waitForTimeout(150);
        await tabs.nth(0).click();
      }
      const retained = await pane.evaluate(e => e.__qaTerminal?.isConnected);
      results.push({ width, retained });
      await pane.screenshot({ path: `${output}/${results.length}-${width}.png` });
      assert(retained, 'Switching tabs must not destroy the existing terminal canvas/session');
    } finally { await restore(); }
  }
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  await browser.close();
}
