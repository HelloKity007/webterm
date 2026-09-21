import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { browserSmokeStatus } from './browser-smoke-result.mjs';

const require = createRequire(import.meta.url);
const { chromium, firefox, webkit } = require('../ui/node_modules/playwright');
const target = new URL(process.env.WEBTERM_QA_URL || 'https://192.168.11.87:9444/');
assert.equal(target.protocol, 'https:');
assert.equal(target.port, '9444');
const output = resolve(process.env.WEBTERM_QA_OUTPUT || `runtime/file-manager-browsers-${Date.now()}`);
await mkdir(output, { recursive: true, mode: 0o700 });
const baselineRoot = resolve('docs/qa/visual-baselines/file-workspace');
const updateBaseline = process.env.WEBTERM_QA_UPDATE_BASELINE === '1';
const maxChangedPixels = Number(process.env.WEBTERM_QA_VISUAL_MAX_PIXELS || '0');
assert(Number.isSafeInteger(maxChangedPixels) && maxChangedPixels >= 0, 'WEBTERM_QA_VISUAL_MAX_PIXELS must be a non-negative integer');
const engines = { chromium, firefox, webkit };
const viewports = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
];
const results = [];
const changedPixels = (baseline, actual) => {
  try {
    execFileSync('compare', ['-metric', 'AE', baseline, actual, 'null:'], { stdio: ['ignore', 'ignore', 'pipe'] });
    return 0;
  } catch (error) {
    const metric = String(error.stderr || '').trim().match(/^(\d+)/)?.[1];
    if (metric === undefined) throw error;
    return Number(metric);
  }
};
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
    // Screenshots must represent a settled workspace rather than the transient
    // loading placeholder, otherwise a visual baseline would be nondeterministic.
    await workspace.locator('.sftp-file-list:not([aria-busy="true"])').waitFor({ timeout: 15000 });
    // Remote directory names and timestamps are live operational data, not
    // layout. Mask only those volatile glyphs so the versioned baseline still
    // compares the actual browser-rendered shell, controls, split/editor area,
    // typography metrics, borders, and responsive geometry.
    await page.addStyleTag({ content: `
      .sftp-file-list [data-file-row], .sftp-file-list > [aria-hidden="true"] { visibility: hidden !important; }
      .sftp-path { color: transparent !important; text-shadow: none !important; }
    ` });
    const rendered = [];
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(150);
      const metrics = await page.evaluate(() => ({
        viewportWidth: document.documentElement.clientWidth,
        documentWidth: document.documentElement.scrollWidth,
      }));
      assert(metrics.documentWidth <= metrics.viewportWidth, `horizontal document overflow at ${viewport.width}px`);
      const fileName = `${name}-${viewport.name}.png`;
      const screenshot = resolve(output, fileName);
      const baseline = resolve(baselineRoot, fileName);
      await workspace.screenshot({ path: screenshot });
      if (updateBaseline) {
        await mkdir(baselineRoot, { recursive: true, mode: 0o700 });
        await copyFile(screenshot, baseline);
      } else {
        await stat(baseline).catch(() => { throw new Error(`visual baseline is missing: ${baseline}; run with WEBTERM_QA_UPDATE_BASELINE=1 after review`); });
        const changed = changedPixels(baseline, screenshot);
        assert(changed <= maxChangedPixels, `visual regression ${fileName}: ${changed} pixels changed (budget ${maxChangedPixels})`);
        rendered.push({ viewport, ...metrics, baseline, changedPixels: changed });
        continue;
      }
      rendered.push({ viewport, ...metrics, baseline, changedPixels: null });
    }
    results.push({ browser: name, status: 'PASS', fileShells: await workspace.locator('.sftp-shell').count(), rendered });
  } catch (error) {
    const message = String(error?.message || error);
    if (/executable doesn't exist/i.test(message)) results.push({ browser: name, status: 'NOT_RUN', reason: 'Playwright browser binary is not installed' });
    else results.push({ browser: name, status: 'FAIL', reason: message.replace(/([?&]ticket=)[^&\s']+/g, '$1[redacted]') });
  } finally {
    await browser?.close();
  }
}
const status = browserSmokeStatus(results);
const report = { status, scope: 'Responsive cross-browser workspace screenshot and baseline comparison', baselineRoot, updateBaseline, maxChangedPixels, results, output };
await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify(report));
if (status !== 'PASS') process.exitCode = 1;
