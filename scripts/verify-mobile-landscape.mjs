import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const { chromium, devices } = createRequire(import.meta.url)('../ui/node_modules/playwright');

const origin = 'https://192.168.11.87:9444';
const output = resolve(process.env.WEBTERM_QA_OUTPUT || 'runtime/mobile-landscape-qa');
await mkdir(output, { recursive: true, mode: 0o700 });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: false, args: ['--no-sandbox'] });
const report = { cases: [], status: 'RUNNING' };

try {
  for (const fixture of [
    { name: 'Pixel 7 portrait', device: { ...devices['Pixel 7'] } },
    { name: 'Pixel 7 landscape', device: { ...devices['Pixel 7'], viewport: { width: 915, height: 412 }, screen: { width: 915, height: 412 } } },
    { name: 'iPhone 13 portrait', device: { ...devices['iPhone 13'] } },
  ]) {
    const context = await browser.newContext({ ...fixture.device, ignoreHTTPSErrors: true });
    const health = await (await context.request.get(`${origin}/api/health`)).json();
    assert.equal(health.environment, 'release-test');
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(origin, { waitUntil: 'networkidle' });
    const switcher = page.locator('.mobile-panel-switcher');
    await switcher.waitFor();
    assert((await switcher.boundingBox()).height > 0, `${fixture.name}: Panel switcher hidden`);
    const digits = switcher.locator('button');
    assert(await digits.count() >= 8, `${fixture.name}: missing Panel selectors`);
    for (const panel of [1, 5, 6, 8]) {
      await digits.filter({ hasText: new RegExp(`^${panel}$`) }).tap();
      assert.equal(await page.locator('.terminal-grid-cell:visible').count(), 1);
      await page.locator('.mobile-terminal-reader:visible').waitFor();
      const reader = page.locator('.mobile-reader-text:visible');
      const dimensions = await reader.evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }));
      assert.equal(dimensions.scrollWidth, dimensions.width, `${fixture.name} Panel ${panel}: horizontal clipping`);
    }

    await digits.filter({ hasText: /^5$/ }).tap();
    const bar = page.locator('.terminal-tabbar:visible');
    const start = await bar.evaluate(element => { element.scrollLeft = 0; return { width: element.clientWidth, total: element.scrollWidth }; });
    assert(start.total > start.width, `${fixture.name}: Panel 5 tabs do not overflow fixture`);
    const box = await bar.boundingBox();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width - 20, y: box.y + box.height / 2 }] });
    for (let step = 1; step <= 10; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + box.width - 20 - step * (box.width - 40) / 10, y: box.y + box.height / 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(300);
    assert(await bar.evaluate(element => element.scrollLeft > 0), `${fixture.name}: Panel tabs did not touch-scroll`);

    await digits.filter({ hasText: /^6$/ }).tap();
    const reader = page.locator('.mobile-reader-text:visible');
    const scroll = await reader.evaluate(element => ({ top: element.scrollTop, max: element.scrollHeight - element.clientHeight }));
    if (scroll.max > 2) {
      await reader.evaluate(element => { element.scrollTop = element.scrollHeight; });
      const readerBox = await reader.boundingBox();
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: readerBox.x + readerBox.width / 2, y: readerBox.y + 45 }] });
      for (let step = 1; step <= 8; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: readerBox.x + readerBox.width / 2, y: readerBox.y + 45 + step * 18 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(300);
      assert(await reader.evaluate(element => element.scrollTop < element.scrollHeight - element.clientHeight), `${fixture.name}: Claude history did not touch-scroll upward`);
    }

    await page.getByRole('button', { name: '终端输入', exact: true }).tap();
    const canvas = await page.locator('.terminal-surface:visible').evaluate(surface => {
      const panel = surface.getBoundingClientRect();
      const screen = surface.querySelector('.xterm-screen')?.getBoundingClientRect();
      return { panel: [panel.width, panel.height], screen: screen ? [screen.width, screen.height] : null,
        cols: Number(surface.dataset.sharedCols), rows: Number(surface.dataset.sharedRows) };
    });
    assert(canvas.screen && canvas.screen[0] <= canvas.panel[0] + 1 && canvas.screen[1] <= canvas.panel[1] + 1,
      `${fixture.name}: native input canvas clipped`);
    await page.getByRole('button', { name: '换行阅读', exact: true }).tap();
    assert.equal(await page.locator('.xterm-helper-textarea:focus').count(), 0);
    assert.equal(errors.length, 0);
    await page.screenshot({ path: `${output}/${fixture.name.replaceAll(' ', '-').toLowerCase()}.png` });
    report.cases.push({ name: fixture.name, panelSwitch: 'PASS', panelTabTouch: 'PASS', historyTouch: scroll.max > 2 ? 'PASS' : 'NOT APPLICABLE (content fits)', canvas, errors });
    await context.close();
  }
  report.status = 'PASS (emulated mobile browsers; physical IME remains manual)';
} catch (error) {
  report.status = 'FAIL';
  report.failure = String(error);
  process.exitCode = 1;
} finally {
  await browser.close();
  await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
}
