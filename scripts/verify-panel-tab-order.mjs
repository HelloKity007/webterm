import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require('../ui/node_modules/playwright');
const output = 'runtime/panel-tab-order-qa';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: false, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
  await page.goto('https://192.168.11.87:9444/', { waitUntil: 'networkidle' });
  await page.locator('[data-tab-id]').first().waitFor();
  const bar = page.locator('.terminal-tabbar').filter({ has: page.locator('[data-terminal-tab]') });
  let group;
  for (const candidate of await bar.all()) {
    if (await candidate.locator('[data-terminal-tab]').count() > 1) { group = candidate; break; }
  }
  assert(group, 'A multi-tab panel is required');
  const ids = () => group.locator('[data-tab-id]').evaluateAll(nodes => nodes.map(n => n.dataset.tabId));
  const before = await ids();
  const active = await group.locator('[data-active="true"]').getAttribute('data-tab-id');
  const source = group.locator(`[data-tab-id="${before[0]}"]`);
  const target = group.locator(`[data-tab-id="${before[1]}"]`);
  await group.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  await source.dragTo(target, { targetPosition: { x: box.width - 4, y: box.height / 2 } });
  await page.waitForTimeout(500);
  const expected = [before[1], before[0], ...before.slice(2)];
  try {
    assert.deepEqual(await ids(), expected);
    assert.equal(await group.locator('[data-active="true"]').getAttribute('data-tab-id'), active);
    await group.screenshot({ path: `${output}/reordered.png` });
  } finally {
    // Restore the user's ordering without closing or typing into any session.
    await source.dragTo(target, { targetPosition: { x: 2, y: box.height / 2 } });
    await page.waitForTimeout(500);
  }
  assert.deepEqual(await ids(), before);
  await writeFile(`${output}/result.json`, JSON.stringify({ before, expected, restored: await ids(), active, passed: true }, null, 2));
  console.log('PASS: native mouse drag reorder, active identity, original ordering restored');
} finally { await browser.close(); }
