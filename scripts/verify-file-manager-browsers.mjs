import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium, firefox, webkit } = require('../ui/node_modules/playwright');
const target = new URL(process.env.WEBTERM_QA_URL || 'https://192.168.11.87:9444/');
assert.equal(target.protocol, 'https:');
assert.equal(target.port, '9444');
const output = resolve(process.env.WEBTERM_QA_OUTPUT || `runtime/file-manager-browsers-${Date.now()}`);
await mkdir(output, { recursive: true, mode: 0o700 });
const engines = { chromium, firefox, webkit };
const results = [];
for (const [name, engine] of Object.entries(engines)) {
  let browser;
  try {
    browser = await engine.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
    if (process.env.WEBTERM_QA_TOKEN) await page.addInitScript((token) => localStorage.setItem('token', token), process.env.WEBTERM_QA_TOKEN);
    await page.goto(target.origin, { waitUntil: 'networkidle' });
    assert(await page.locator('.activity-files').count(), 'release-test session is required');
    await page.locator('.activity-files').click();
    const workspace = page.locator('[data-testid="file-workspace"]');
    await workspace.waitFor();
    await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true });
    results.push({ browser: name, status: 'PASS', endpoints: await workspace.locator('.sftp-endpoint').count() });
  } catch (error) {
    const message = String(error?.message || error);
    if (/executable doesn't exist|browserType\.launch/i.test(message)) results.push({ browser: name, status: 'NOT_RUN', reason: 'Playwright browser binary is not installed' });
    else throw error;
  } finally {
    await browser?.close();
  }
}
assert(results.some((result) => result.status === 'PASS'), 'no browser engine completed the visual smoke test');
console.log(JSON.stringify({ status: 'PASS', results, output }));
