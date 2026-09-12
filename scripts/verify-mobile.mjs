import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('../ui/node_modules/playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const target = new URL(process.env.WEBTERM_QA_URL || 'https://192.168.11.87:9444/');
assert.equal(target.protocol, 'https:', 'QA requires HTTPS');
assert.equal(target.port, '9444', 'This smoke runner only permits release-test port 9444');
assert(!target.username && !target.password && !target.search, 'Do not put credentials in QA URLs');
const output = resolve(root, process.env.WEBTERM_QA_OUTPUT || `runtime/mobile-qa/${Date.now()}`);
await mkdir(output, { recursive: true, mode: 0o700 });
const report = { target: target.origin, checks: [], notRun: [
  'Physical Android/iOS IME and orientation acceptance',
  'Remote CLI history end-to-end, input and 5000-line fixtures',
  'M3–M8 security, reliability, capacity and performance gates',
  'Pixel-baseline visual regression and complete accessibility audit',
] };
const browser = await chromium.launch({ headless: false,
  executablePath: process.env.WEBTERM_QA_CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const check = (name, evidence) => report.checks.push({ name, status: 'PASS', evidence });
try {
  const context = await browser.newContext({ ...devices['Pixel 7'], ignoreHTTPSErrors: true });
  const health = await context.request.get(new URL('/api/health', target).href);
  assert.equal(health.status(), 200);
  report.health = await health.json();
  assert.equal(report.health.environment, 'release-test', 'Refusing a production backend');
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', () => pageErrors.push('pageerror')); // No token-bearing error text.
  await page.goto(target.origin);
  const digits = page.locator('.mobile-panel-switcher button');
  await digits.first().waitFor();
  const fonts = [];
  for (let n = 1; n <= 8; n++) {
    await digits.filter({ hasText: new RegExp(`^${n}$`) }).click();
    const reader = page.locator('.mobile-reader-text:visible');
    await reader.waitFor();
    const metrics = await reader.evaluate(e => ({ font: getComputedStyle(e).fontSize,
      width: e.clientWidth, scrollWidth: e.scrollWidth }));
    assert.equal(metrics.width, metrics.scrollWidth, `panel ${n}: horizontal overflow`);
    fonts.push({ panel: n, ...metrics });
  }
  assert.equal(new Set(fonts.map(f => f.font)).size, 1);
  check('MOB-02/06: eight panes share panel-1 font and fit reader width', fonts);
  assert.equal(await page.getByRole('button', { name: /更早输出|更新输出/ }).count(), 0);
  check('MOB-03: no history paging buttons', true);
  await digits.filter({ hasText: /^5$/ }).click();
  const bar = page.locator('.terminal-tabbar:visible').first();
  const start = await bar.evaluate(e => { e.scrollLeft = 0; return { width: e.clientWidth, total: e.scrollWidth }; });
  assert(start.total > start.width, 'Fixture pane 5 must contain overflowing session tabs');
  const rect = await bar.boundingBox();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rect.x + rect.width - 20, y: rect.y + 18 }] });
  for (let i = 1; i <= 12; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: rect.x + rect.width - 20 - i * (rect.width - 40) / 12, y: rect.y + 18 }] });
    await page.waitForTimeout(25);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(250);
  assert(await bar.evaluate(e => e.scrollLeft > 0));
  const terminalTabs = bar.locator('[data-terminal-tab]');
  const finalTab = terminalTabs.last();
  const finalLabel = await finalTab.innerText();
  await finalTab.tap();
  assert.equal(await bar.locator('[data-active="true"]').innerText(), finalLabel);
  check('MOB-01: native touch swipe and offscreen tab selection', true);
  await page.screenshot({ path: resolve(output, 'mobile-tabs.png') });
  await page.getByRole('button', { name: '终端输入', exact: true }).click();
  assert.equal(await page.locator('.xterm-decoration-overview-ruler:visible').count(), 0);
  const inputBounds = await page.locator('.terminal-surface:visible').evaluate(surface => {
    const panel = surface.getBoundingClientRect();
    const screen = surface.querySelector('.xterm-screen')?.getBoundingClientRect();
    return { panel: { width: panel.width, height: panel.height },
      screen: screen && { width: screen.width, height: screen.height },
      cols: Number(surface.dataset.sharedCols), rows: Number(surface.dataset.sharedRows) };
  });
  assert(inputBounds.screen, 'mobile terminal input canvas is missing');
  assert(inputBounds.screen.width <= inputBounds.panel.width + 1, 'mobile terminal input is clipped horizontally');
  assert(inputBounds.screen.height <= inputBounds.panel.height + 1, 'mobile terminal input is clipped vertically');
  assert.equal(inputBounds.cols, 69);
  assert.equal(inputBounds.rows, 29);
  await page.getByRole('button', { name: '换行阅读', exact: true }).click();
  assert.equal(await page.locator('.xterm-helper-textarea:focus').count(), 0);
  check('MOB-04/07: reading blurs terminal; native input fits and has no white ruler', inputBounds);

  // Synthetic visualViewport transitions: these do NOT claim a real IME test.
  // Reload mounts listeners against the fixture viewport via an init script.
  await page.addInitScript(() => {
    const v = Object.assign(new EventTarget(), { height: innerHeight, offsetTop: 0, scale: 1 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: v });
  });
  await page.reload();
  await digits.first().waitFor();
  const geometry = async (height, top) => {
    await page.evaluate(({ height, top }) => {
      Object.assign(window.visualViewport, { height: height || innerHeight, offsetTop: top });
      window.visualViewport.dispatchEvent(new Event('resize'));
    }, { height, top });
    await page.waitForTimeout(800);
  };
  await geometry(0, 0);
  const bounds = () => page.locator('.app-shell').evaluate(e => ({ top: e.getBoundingClientRect().top,
    height: e.getBoundingClientRect().height, scrollY }));
  const baseline = await bounds();
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: '终端输入', exact: true }).click();
    await geometry(410, 120);
    assert.equal((await bounds()).height, 410);
    await page.getByRole('button', { name: '换行阅读', exact: true }).click();
    await geometry(0, 0);
    assert.deepEqual(await bounds(), baseline);
  }
  check('MOB-05: three simulated keyboard open/close cycles restore viewport', baseline);
  await page.screenshot({ path: resolve(output, 'mobile-restored.png') });
  assert.equal(pageErrors.length, 0);
  check('No browser page errors', true);
  report.status = 'PASS (listed smoke checks only; not full acceptance)';
} catch (error) {
  report.status = 'FAIL';
  report.failure = String(error.message).replace(/(token|ticket)=[^\s&]+/g, '$1=[redacted]');
  process.exitCode = 1;
} finally {
  await browser.close();
  await writeFile(resolve(output, 'result.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
  console.log(`Artifacts: ${output}`);
}
