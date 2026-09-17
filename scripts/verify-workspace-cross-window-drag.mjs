import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('../ui/node_modules/playwright');
const base = (process.env.WEBTERM_BASE_URL || 'https://192.168.11.87:9444').replace(/\/$/, '');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
  const first = await context.newPage();
  await first.goto(`${base}/`, { waitUntil: 'networkidle' });
  const tabs = first.getByRole('tab');
  await tabs.first().waitFor();
  const initial = await tabs.count();
  if (initial < 2) {
    await first.getByRole('button', { name: /新建工作区|New workspace/ }).click();
    const dialog = first.getByRole('dialog');
    await dialog.waitFor();
    await dialog.getByRole('button').last().click();
    await first.getByRole('tab').nth(initial).waitFor();
  }
  const second = await context.newPage();
  await second.goto(`${base}/`, { waitUntil: 'networkidle' });
  await second.getByRole('tab').nth(1).waitFor();
  const before = await second.getByRole('tab').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')));
  await first.evaluate(() => {
    const source = document.querySelector('[role="tab"]');
    const target = document.querySelectorAll('[role="tab"]')[1];
    if (!source || !target) throw new Error('two workspace tabs are required');
    const data = new DataTransfer();
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: data }));
    const rect = target.getBoundingClientRect();
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: data, clientX: rect.right - 2 }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: data, clientX: rect.right - 2 }));
  });
  await second.waitForTimeout(1200);
  const after = await second.getByRole('tab').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')));
  assert.notDeepEqual(after, before, 'cross-window drop did not reorder persisted workspace tabs');
  console.log(JSON.stringify({ status: 'PASS', before, after }));
} finally {
  await browser.close();
}
