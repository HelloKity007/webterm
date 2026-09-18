import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { visualReloadPhase } from './visual-reload-phase.mjs';
import { dragTerminalTab } from './terminal-tab-drag.mjs';
const { chromium } = createRequire(import.meta.url)('../ui/node_modules/playwright');
const output = process.env.WEBTERM_QA_OUTPUT || 'runtime/cross-pane-move';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: false, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 3440, height: 1440 }, ignoreHTTPSErrors: true });
  await page.goto('https://192.168.11.87:9444/', { waitUntil: 'networkidle' });
  await visualReloadPhase(page);
  const results = [];
  for (const number of [5, 6]) {
  const sourceTab = page.locator('[data-tab-id]').filter({ hasText: new RegExp(`^${number}:`) });
  await sourceTab.locator('xpath=ancestor::*[contains(@class,"terminal-grid-cell")]').evaluate((e, n) => { e.dataset.qaMoveSource = String(n); }, number);
  await page.locator('[data-tab-id]').filter({ hasText: number === 5 ? /^6:/ : /^5:/ }).locator('xpath=ancestor::*[contains(@class,"terminal-grid-cell")]').evaluate((e, n) => { e.dataset.qaMoveTarget = String(n); }, number);
  const sourcePane = page.locator(`[data-qa-move-source="${number}"]`);
  const targetPane = page.locator(`[data-qa-move-target="${number}"]`);
  const sourceID = await sourceTab.getAttribute('data-tab-id');
  const ids = () => sourcePane.locator('[data-tab-id]').evaluateAll(nodes => nodes.map(n => n.dataset.tabId));
  const before = await ids();
  const sourceActive = await sourcePane.locator('[data-active="true"]').getAttribute('data-tab-id');
  const targetActive = await targetPane.locator('[data-active="true"]').getAttribute('data-tab-id');
  await writeFile(`${output}/before-${number}.json`, JSON.stringify({ before, sourceID, sourceActive, targetActive }, null, 2));
  await sourceTab.click(); await page.waitForTimeout(1000);
  await sourcePane.evaluate(e => { window.__qaMoved = [...e.querySelectorAll('.terminal-surface')].find(n => n.offsetWidth > 0); });
  try {
    for (let round = 0; round < 5; round++) {
      await dragTerminalTab(page.locator(`[data-tab-id="${sourceID}"]`), targetPane.locator('.terminal-tabbar-spacer'));
      await page.waitForTimeout(800);
      assert.equal(await page.locator(`[data-tab-id="${sourceID}"]`).count(), 1);
      assert.equal(await targetPane.locator(`[data-tab-id="${sourceID}"]`).count(), 1);
      assert(await targetPane.evaluate(e => e.contains(window.__qaMoved)), 'Move recreated the terminal instead of reparenting it');
      await dragTerminalTab(page.locator(`[data-tab-id="${sourceID}"]`), sourcePane.locator('.terminal-tabbar-spacer'));
      await page.waitForTimeout(800);
      assert(await sourcePane.evaluate(e => e.contains(window.__qaMoved)));
    }
    await sourcePane.screenshot({ path: `${output}/returned-${number}.png` });
  } finally {
    const moved = page.locator(`[data-tab-id="${sourceID}"]`);
    if (await targetPane.locator(`[data-tab-id="${sourceID}"]`).count()) {
      await dragTerminalTab(moved, sourcePane.locator('.terminal-tabbar-spacer')); await page.waitForTimeout(500);
    }
    // Restore the original index as well as the original active selections.
    const index = before.indexOf(sourceID);
    const anchorID = before[index + 1] || before[index - 1];
    if (anchorID) {
    const anchor = sourcePane.locator(`[data-tab-id="${anchorID}"]`);
    await dragTerminalTab(moved, anchor, { after: !before[index + 1] });
    }
    await sourcePane.locator(`[data-tab-id="${sourceActive}"]`).click();
    await targetPane.locator(`[data-tab-id="${targetActive}"]`).click();
    await page.waitForTimeout(700);
  }
  assert.deepEqual(await ids(), before);
  // Layout saves are debounced. In a hard-reload phase a moved layout can be
  // persisted before this in-page restoration has reached the server. Wait
  // through the restore save and prove it survives a real reload, so the
  // shared-fixture runner never has to discover (and roll back) a transient
  // reordered layout after this test exits.
  await page.waitForTimeout(1200);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  const restoredSourcePane = page.locator(`[data-tab-id="${sourceActive}"]`).locator('xpath=ancestor::*[contains(@class,"terminal-grid-cell")]');
  const restoredTargetPane = page.locator(`[data-tab-id="${targetActive}"]`).locator('xpath=ancestor::*[contains(@class,"terminal-grid-cell")]');
  assert.deepEqual(await restoredSourcePane.locator('[data-tab-id]').evaluateAll(nodes => nodes.map(n => n.dataset.tabId)), before,
    'restored Pane order did not persist across reload');
  assert.equal(await restoredSourcePane.locator('[data-active="true"]').getAttribute('data-tab-id'), sourceActive);
  assert.equal(await restoredTargetPane.locator('[data-active="true"]').getAttribute('data-tab-id'), targetActive);
  results.push({ panel: number, cycles: 5, retained: true, restored: before });
  }
  await writeFile(`${output}/result.json`, JSON.stringify(results, null, 2));
} finally { await browser.close(); }
