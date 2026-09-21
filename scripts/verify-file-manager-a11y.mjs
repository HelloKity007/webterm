import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('../ui/node_modules/playwright');
const axePath = require.resolve('../ui/node_modules/axe-core/axe.min.js');
const target = new URL(process.env.WEBTERM_QA_URL || 'https://192.168.11.87:9444/');
assert.equal(target.protocol, 'https:');
assert.equal(target.port, '9444');
const output = resolve(process.env.WEBTERM_QA_OUTPUT || `runtime/file-manager-a11y-${Date.now()}`);
await mkdir(output, { recursive: true, mode: 0o700 });
const browser = await chromium.launch({ headless: true, executablePath: process.env.WEBTERM_QA_CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
  let token = process.env.WEBTERM_QA_TOKEN;
  if (!token) {
    const response = await page.request.post(new URL('/api/auth/test-session', target).href);
    assert.equal(response.status(), 200, 'release-test did not provide a test session');
    token = (await response.json()).token;
    assert.equal(typeof token, 'string');
  }
  await page.addInitScript((value) => localStorage.setItem('token', value), token);
  await page.goto(target.origin, { waitUntil: 'domcontentloaded' });
  const filesActivity = page.locator('.activity-files');
  await filesActivity.waitFor({ timeout: 10000 });
  await filesActivity.click();
  await page.locator('[data-testid="file-workspace"]').waitFor();
  await page.addScriptTag({ path: axePath });
  const result = await page.evaluate(async () => window.axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
  }));
  await writeFile(resolve(output, 'axe.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
  assert.equal(result.violations.length, 0, result.violations.map((v) => `${v.id}: ${v.help}`).join('; '));
  console.log(JSON.stringify({ status: 'PASS', violations: 0, passes: result.passes.length, output }));
} finally {
  await browser.close();
}
