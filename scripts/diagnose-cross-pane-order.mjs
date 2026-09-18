import { chromium } from '../ui/node_modules/playwright/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
const output = 'runtime/cross-pane-order-diagnostic';
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 3440, height: 1440 } });
const origin = 'https://192.168.11.87:9444';
const health = await (await context.request.get(`${origin}/api/health`)).json();
if (health.environment !== 'release-test') throw new Error('Test only');
const { token } = await (await context.request.post(`${origin}/api/auth/test-session`)).json();
const headers = { Authorization: `Bearer ${token}` };
const baseline = await (await context.request.get(`${origin}/api/layout`, { headers })).json();
const report = { health, steps: [] };
try {
  const page = await context.newPage();
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    window.__dragEvents = [];
    for (const type of ['dragstart', 'dragover', 'drop', 'dragend']) document.addEventListener(type, e => {
      const tab = e.target.closest?.('[data-tab-id]');
      const bar = e.target.closest?.('.terminal-tabbar');
      if (!bar) return;
      window.__dragEvents.push({ type, x: e.clientX, y: e.clientY, target: tab?.dataset.tabId || e.target.className,
        rect: tab && { left: tab.getBoundingClientRect().left, width: tab.getBoundingClientRect().width }, scrollLeft: bar.scrollLeft });
    }, true);
  });
  const source = page.locator('[data-tab-id]').filter({ hasText: /^5:/ }).first();
  const sourceID = await source.getAttribute('data-tab-id');
  const pane = source.locator('xpath=ancestor::*[contains(@class,"terminal-grid-cell")]');
  await pane.evaluate(e => e.dataset.qaSource = 'true');
  const stablePane = page.locator('[data-qa-source="true"]');
  const target = page.locator('[data-tab-id]').filter({ hasText: /^6:/ }).first().locator('xpath=ancestor::*[contains(@class,"terminal-grid-cell")]');
  const order = () => stablePane.locator('[data-tab-id]').evaluateAll(nodes => nodes.map(e => e.dataset.tabId));
  const initial = await order(); report.initial = initial;
  await source.click();
  for (let i = 0; i < 5; i++) {
    await page.locator(`[data-tab-id="${sourceID}"]`).dragTo(target.locator('.terminal-tabbar-spacer'));
    await page.waitForTimeout(800);
    await page.locator(`[data-tab-id="${sourceID}"]`).dragTo(stablePane.locator('.terminal-tabbar-spacer'));
    await page.waitForTimeout(800);
    report.steps.push({ step: `cycle-${i}`, order: await order() });
  }
  const anchor = stablePane.locator(`[data-tab-id="${initial[1]}"]`);
  const box = await anchor.boundingBox();
  report.anchorBefore = box;
  await page.locator(`[data-tab-id="${sourceID}"]`).dragTo(anchor, { targetPosition: { x: 2, y: box.height / 2 } });
  await page.waitForTimeout(800);
  report.final = await order();
  report.events = await page.evaluate(() => window.__dragEvents);
  await stablePane.screenshot({ path: `${output}/after.png` });
  await page.close();
} finally {
  for (const page of context.pages()) await page.close();
  const latest = await (await context.request.get(`${origin}/api/layout`, { headers })).json();
  const restored = await context.request.put(`${origin}/api/layout`, { headers, data: { schema_version: baseline.schema_version, revision: latest.revision, layout: baseline.layout } });
  report.restored = restored.ok();
  await writeFile(`${output}/result.json`, JSON.stringify(report, null, 2));
  await browser.close();
  if (!report.restored) throw new Error('Failed to restore fixture');
}
console.log(report);
