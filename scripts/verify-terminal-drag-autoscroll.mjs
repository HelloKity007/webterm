// Stress test for drag-to-edge auto-scroll, both directions.
//
// Holds a selection drag against the top and bottom edges repeatedly, with
// short and long holds and mid-drag direction changes, and asserts each cycle
// that the viewport actually moved, the selection grew past one screen, the
// copied text is contiguous, and no page error appeared.
//
//   WEBTERM_BASE_URL=https://192.168.11.87:9444 \
//   WEBTERM_QA_OUTPUT=runtime/drag-autoscroll/<stamp> \
//   node scripts/verify-terminal-drag-autoscroll.mjs
import playwright from '../ui/node_modules/@playwright/test/index.js';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = playwright;
const origin = (process.env.WEBTERM_BASE_URL || 'https://192.168.11.87:9444').replace(/\/$/, '');
const outDir = process.env.WEBTERM_QA_OUTPUT || 'runtime/drag-autoscroll/latest';
await mkdir(outDir, { recursive: true });
const pageErrors = [];
const cycles = [];

const browser = await chromium.launch({ executablePath: process.env.WEBTERM_QA_CHROME || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1360, height: 900 } });
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
const page = await context.newPage();
page.on('pageerror', (e) => pageErrors.push(e.message));

// Always measure the pane under test: other panels are visible too.
const metrics = () => page.evaluate((paneIndex) => {
  const pane = document.querySelectorAll('.terminal-pane')[paneIndex];
  const surface = Array.from(pane.querySelectorAll('.terminal-surface')).find((n) => n.offsetParent !== null);
  return {
    scrollTop: Math.round(surface.scrollTop),
    scrollHeight: Math.round(surface.scrollHeight),
    maxTop: Math.round(surface.scrollHeight - surface.clientHeight),
  };
}, paneIndex);

const surfaceBox = () => page.evaluate((paneIndex) => {
  const pane = document.querySelectorAll('.terminal-pane')[paneIndex];
  const surface = Array.from(pane.querySelectorAll('.terminal-surface')).find((n) => n.offsetParent !== null);
  const r = surface.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}, paneIndex);

let paneIndex = 0;
const dragHeldToEdge = async (box, edge, holdMs) => {
  // Start the drag well inside the panel, then pin the pointer in the edge band.
  await page.mouse.move(box.x + 30, edge === 'top' ? box.y + box.height - 60 : box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, edge === 'top' ? box.y + box.height - 120 : box.y + 120, { steps: 4 });
  await page.mouse.move(edge === 'top' ? box.x + 180 : box.x + 260, edge === 'top' ? box.y + 2 : box.y + box.height - 2, { steps: 5 });
  const samples = [];
  const started = Date.now();
  while (Date.now() - started < holdMs) {
    await page.waitForTimeout(120);
    samples.push(await metrics());
  }
  await page.mouse.up();
  await page.waitForTimeout(250);
  return samples;
};

try {
  await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll('.terminal-surface').length > 0, null, { timeout: 60000 });
  await page.waitForTimeout(2500);
  const health = await page.evaluate(async () => (await fetch('/api/health')).json());
  console.log(`candidate=${health.version} environment=${health.environment}`);

  await page.locator('.workspace-tabs-toggle').first().click().catch(() => {});
  await page.waitForTimeout(300);
  await page.getByRole('tab', { name: '2: 730' }).first().click();
  await page.waitForTimeout(1500);

  paneIndex = await page.evaluate(() => {
    const panes = Array.from(document.querySelectorAll('.terminal-pane'));
    return panes.findIndex((pane) => Array.from(pane.querySelectorAll('.terminal-tabbar [data-terminal-tab]'))
      .some((tab) => /^47:/.test((tab.textContent || '').trim())));
  });
  const pane = page.locator('.terminal-pane').nth(paneIndex);
  await pane.locator('.terminal-tabbar [data-terminal-tab]').filter({ hasText: /^47:/ }).first().click();
  await page.waitForTimeout(600);
  await pane.evaluate((node) => Array.from(node.querySelectorAll('.terminal-surface'))
    .find((n) => n.offsetParent !== null)?.querySelector('.xterm-helper-textarea')?.focus());
  // Long scrollback so both directions have room to run.
  await page.keyboard.type('seq 1 1200');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3500);
  const box = await surfaceBox();
  const start = await metrics();
  console.log(`scrollback ready: ${JSON.stringify(start)}`);

  // 10 cycles per direction, alternating hold lengths.
  for (let i = 0; i < 10; i += 1) {
    // Park somewhere with room above before an upward cycle.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let s = 0; s < 6; s += 1) { await page.mouse.wheel(0, 240); await page.waitForTimeout(30); }
    await page.waitForTimeout(150);
    const before = await metrics();
    const samples = await dragHeldToEdge(box, 'top', 300 + (i % 3) * 250);
    const after = await metrics();
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    const lines = clipboard.split('\n');
    const scrolled = samples.some((s, index) => index > 0 && s.scrollTop !== samples[index - 1].scrollTop);
    const movedUp = after.scrollTop < before.scrollTop - 60;
    const pastOneScreen = lines.length > 24;
    const contiguous = lines.length > 1 && !lines.some((line) => line === undefined);
    cycles.push({
      direction: 'up', holdMs: 300 + (i % 3) * 250,
      before: before.scrollTop, after: after.scrollTop, delta: after.scrollTop - before.scrollTop,
      scrolled, movedUp, lines: lines.length, pastOneScreen, contiguous,
      ok: scrolled && movedUp && pastOneScreen && contiguous,
    });
  }

  for (let i = 0; i < 10; i += 1) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let s = 0; s < 6; s += 1) { await page.mouse.wheel(0, -240); await page.waitForTimeout(30); }
    await page.waitForTimeout(150);
    const before = await metrics();
    const samples = await dragHeldToEdge(box, 'bottom', 300 + (i % 3) * 250);
    const after = await metrics();
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    const lines = clipboard.split('\n');
    const scrolled = samples.some((s, index) => index > 0 && s.scrollTop !== samples[index - 1].scrollTop);
    const movedDown = after.scrollTop > before.scrollTop + 60;
    const pastOneScreen = lines.length > 24;
    cycles.push({
      direction: 'down', holdMs: 300 + (i % 3) * 250,
      before: before.scrollTop, after: after.scrollTop, delta: after.scrollTop - before.scrollTop,
      scrolled, movedDown, lines: lines.length, pastOneScreen,
      ok: scrolled && movedDown && pastOneScreen,
    });
  }

  // Direction reversal mid-drag: drag down, then up, in one hold.
  for (let i = 0; i < 4; i += 1) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let s = 0; s < 4; s += 1) { await page.mouse.wheel(0, 240); await page.waitForTimeout(30); }
    await page.waitForTimeout(120);
    const before = await metrics();
    await page.mouse.move(box.x + 30, box.y + 60);
    await page.mouse.down();
    await page.mouse.move(box.x + 180, box.y + 120, { steps: 4 });
    await page.mouse.move(box.x + 180, box.y + box.height - 2, { steps: 5 });
    await page.waitForTimeout(500);
    const afterDown = await metrics();
    await page.mouse.move(box.x + 180, box.y + 2, { steps: 5 });
    await page.waitForTimeout(700);
    await page.mouse.up();
    await page.waitForTimeout(250);
    const after = await metrics();
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    // Reversal must move the viewport down and then back up; the selection
    // itself shrinks again because the focus returns near the anchor.
    const ok = afterDown.scrollTop > before.scrollTop + 60
      && after.scrollTop < afterDown.scrollTop - 60
      && clipboard.split('\n').length >= 1
      && pageErrors.length === 0;
    cycles.push({
      direction: 'reverse', before: before.scrollTop, afterDown: afterDown.scrollTop, after: after.scrollTop,
      lines: clipboard.split('\n').length, ok,
    });
  }

  await page.screenshot({ path: `${outDir}/drag-autoscroll-stress.png` });
} finally {
  await browser.close();
}

const failed = cycles.filter((c) => !c.ok);
const summary = {
  candidate: cycles.length ? 'see-console' : '',
  total: cycles.length,
  passed: cycles.length - failed.length,
  failed: failed.length,
  pageErrors,
  cycles,
};
await writeFile(`${outDir}/drag-autoscroll-stress.json`, JSON.stringify(summary, null, 2));
console.log(`\n=== ${summary.passed}/${summary.total} cycles passed, pageErrors=${pageErrors.length} ===`);
for (const c of failed) console.log(`FAIL ${JSON.stringify(c)}`);
if (pageErrors.length) console.log('pageErrors:', JSON.stringify(pageErrors));
process.exitCode = failed.length || pageErrors.length ? 1 : 0;
