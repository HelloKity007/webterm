import { chromium } from '../ui/node_modules/playwright/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { sendWindowsNativeReload } from './windows-native-key.mjs';

const output = process.env.WEBTERM_QA_OUTPUT || 'runtime/windows-native-reload-smoke';
await mkdir(output, { recursive: true });
const browser = await chromium.connectOverCDP('http://127.0.0.1:19335');
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: null });
const report = { status: 'RUNNING', keys: [] };
try {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
  await page.addInitScript(() => {
    window.qaKeys = [];
    addEventListener('keydown', e => window.qaKeys.push({ key: e.key, ctrl: e.ctrlKey, shift: e.shiftKey }), true);
  });
  await page.goto('https://192.168.11.87:9444/api/health');
  report.health = JSON.parse(await page.locator('body').innerText());
  if (report.health.environment !== 'release-test') throw new Error('Wrong environment');
  report.metrics = await page.evaluate(() => ({ ua: navigator.userAgent, dpr: devicePixelRatio,
    inner: [innerWidth, innerHeight], outer: [outerWidth, outerHeight],
    screen: [screen.width, screen.height], visualScale: visualViewport.scale }));
  for (const key of ['F5', 'Control+R', 'Control+Shift+R']) {
    await page.evaluate(() => { document.title = 'WebTerm-native-reload-QA'; });
    await page.bringToFront();
    await page.locator('body').click({ position: { x: 20, y: 20 } });
    const attempt = { key };
    report.keys.push(attempt);
    const navigation = page.waitForEvent('framenavigated', { predicate: f => f === page.mainFrame(), timeout: 15000 });
    navigation.catch(() => {});
    attempt.delivery = await sendWindowsNativeReload(key);
    try { await navigation; attempt.navigated = true; }
    catch { attempt.navigated = false; }
    attempt.keys = await page.evaluate(() => window.qaKeys || []);
    await page.screenshot({ path: `${output}/${key.replaceAll('+', '-')}.png` });
    if (!attempt.navigated) throw new Error(`${key}: native navigation was not observed`);
  }
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.error = error.message; process.exitCode = 1;
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await context.close();
  await browser.close();
}
console.log(JSON.stringify(report));
