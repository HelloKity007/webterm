import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { browserSmokeStatus } from './browser-smoke-result.mjs';

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
    // Every engine starts with an isolated profile. Obtain a short-lived test
    // token from the already restricted 9444 candidate rather than relying on
    // Chromium's incidental persisted login state (which WebKit never has).
    let token = process.env.WEBTERM_QA_TOKEN;
    if (!token) {
      const response = await page.request.post(new URL('/api/auth/test-session', target).href);
      assert.equal(response.status(), 200, 'release-test did not provide a test session');
      token = (await response.json()).token;
      assert.equal(typeof token, 'string');
    }
    await page.addInitScript((value) => localStorage.setItem('token', value), token);
    // Persistent SFTP WebSockets intentionally keep the network busy. Waiting
    // for networkidle converts a healthy Chromium workspace into a timeout;
    // the visible workspace and its file shell are the actual readiness gate.
    await page.goto(target.origin, { waitUntil: 'domcontentloaded' });
    const filesActivity = page.locator('.activity-files');
    await filesActivity.waitFor({ timeout: 10000 });
    await filesActivity.click();
    const workspace = page.locator('[data-testid="file-workspace"]');
    await workspace.waitFor();
    await workspace.locator('.sftp-shell').waitFor();
    await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true });
    results.push({ browser: name, status: 'PASS', fileShells: await workspace.locator('.sftp-shell').count() });
  } catch (error) {
    const message = String(error?.message || error);
    if (/executable doesn't exist/i.test(message)) results.push({ browser: name, status: 'NOT_RUN', reason: 'Playwright browser binary is not installed' });
    else results.push({ browser: name, status: 'FAIL', reason: message.replace(/([?&]ticket=)[^&\s']+/g, '$1[redacted]') });
  } finally {
    await browser?.close();
  }
}
const status = browserSmokeStatus(results);
const report = { status, scope: 'File workspace visibility smoke only; not comparative visual acceptance', results, output };
await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify(report));
if (status !== 'PASS') process.exitCode = 1;
