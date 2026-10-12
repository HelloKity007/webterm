import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '../ui/node_modules/playwright/index.mjs';

// Post-deploy browser smoke against the freshly deployed release-test on
// 9444. Read-only for user data: it loads the existing layout, waits for
// every panel to attach or auto-replace, renders the mobile shell, and
// fails on identity-fault overlays or page errors. It never creates,
// closes or types into terminals.

const origin = 'https://192.168.11.87:9444';
const api = 'http://127.0.0.1:8889';
const output = resolve(process.env.WEBTERM_QA_OUTPUT || 'runtime/release-gate/latest');
await mkdir(output, { recursive: true, mode: 0o700 });

const health = await (await fetch(`${api}/api/health`)).json();
assert.equal(health.environment, 'release-test', 'gate must run against release-test');
const auth = await (await fetch(`${api}/api/auth/test-session`, { method: 'POST' })).json();

const checks = [];
const pageErrors = [];
const wsErrors = [];
let terminalModes = 0;
let failure;
let browser;
try {
  browser = await chromium.launch();
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1360, height: 900 } });
  await context.addInitScript(({ token, user }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('webterm-user', JSON.stringify(user));
  }, auth);
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('websocket', ws => {
    if (!ws.url().includes('/ws/ssh/')) return;
    ws.on('framereceived', ({ payload }) => {
      try {
        const message = JSON.parse(String(payload));
        if (message.type === 'terminal_mode') terminalModes++;
        if (message.type === 'error') wsErrors.push(message.code || message.error);
      } catch { /* terminal data */ }
    });
  });
  await page.goto(origin, { waitUntil: 'domcontentloaded' });

  const surfaces = await page.waitForFunction(
    () => document.querySelectorAll('.terminal-surface').length,
    null, { timeout: 15000 },
  ).then(handle => handle.jsonValue());
  assert.ok(surfaces >= 1, `no terminal panels rendered (surfaces=${surfaces})`);
  checks.push(`${surfaces} terminal panels rendered`);

  await page.waitForFunction(
    () => document.querySelectorAll('.terminal-surface').length
      - document.querySelectorAll('.terminal-surface[data-output-batches]').length === 0,
    null, { timeout: 30000 },
  );
  for (let attempt = 0; attempt < 150 && terminalModes < surfaces; attempt++) await page.waitForTimeout(200);
  assert.ok(terminalModes >= surfaces, `only ${terminalModes}/${surfaces} panels attached; ws errors: ${wsErrors.join(',')}`);
  checks.push(`all ${surfaces} panels attached (${terminalModes} terminal_mode events)`);

  const bodyText = await page.locator('body').innerText();
  for (const forbidden of ['终端会话未通过身份校验', '终端服务不可达', '原终端会话已结束']) {
    assert.ok(!bodyText.includes(forbidden), `fault overlay visible: ${forbidden}`);
  }
  checks.push('no identity-fault or backend-fault overlays');
  await page.screenshot({ path: `${output}/desktop.png` });

  // The app switches to the mobile shell by user agent, not viewport width,
  // so a desktop context merely resized would still render the desktop grid.
  const mobileContext = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  });
  await mobileContext.addInitScript(({ token, user }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('webterm-user', JSON.stringify(user));
  }, auth);
  const mobilePage = await mobileContext.newPage();
  mobilePage.on('pageerror', error => pageErrors.push(`mobile: ${error.message}`));
  await mobilePage.goto(origin, { waitUntil: 'domcontentloaded' });
  await mobilePage.waitForTimeout(1500);
  const mobileNav = await mobilePage.locator('.mobile-panel-switcher').count();
  assert.ok(mobileNav >= 1, 'mobile panel switcher did not render for a mobile user agent');
  const mobileSurfaces = await mobilePage.locator('.terminal-surface').count();
  assert.ok(mobileSurfaces >= 1, 'no terminal surface in mobile layout');
  const firstPanelButton = mobilePage.locator('.mobile-panel-switcher button').first();
  const buttonBox = await firstPanelButton.boundingBox();
  assert.ok(buttonBox && buttonBox.height >= 36 && buttonBox.width >= 36, `panel switcher touch target too small: ${JSON.stringify(buttonBox)}`);
  const switcherPadding = await mobilePage.locator('.mobile-panel-switcher').evaluate(
    el => getComputedStyle(el).paddingBottom,
  );
  assert.ok(switcherPadding !== '', 'panel switcher has no bottom padding for the home indicator');
  checks.push('mobile shell renders with panel switcher and a visible terminal');
  await mobilePage.screenshot({ path: `${output}/mobile.png` });
  await mobileContext.close();
  await context.close();
} catch (error) {
  failure = String(error);
} finally {
  if (browser) await browser.close();
}
const report = {
  status: failure ? 'FAIL' : 'PASS',
  version: health.version,
  checks,
  failure,
  pageErrors,
  wsErrors,
  scope: 'read-only post-deploy smoke on release-test 9444; no terminal mutation',
};
await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (failure || pageErrors.length > 0) process.exit(1);
