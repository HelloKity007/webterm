// Visual regression scenarios for terminal panels: workspace/tab switching,
// typing, mouse clicks and history reading. Each step records viewport geometry
// and a screenshot, and the run ends with a PASS/FAIL summary.
//
// Read-mostly against release-test: it types only into panels on that test
// deployment to build scrollback. Requires a browser session that can reach the
// deployment (release-test auto-login, or an already authenticated page).
//
//   WEBTERM_BASE_URL=https://192.168.11.87:9444 \
//   WEBTERM_QA_OUTPUT=runtime/terminal-visuals/<stamp> \
//   node scripts/verify-terminal-viewport-visuals.mjs
import playwright from '/media/pgz/DATA-B/code/tools/webterm-xufanchn/webterm-HelloKity007/ui/node_modules/@playwright/test/index.js';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = playwright;
const origin = (process.env.WEBTERM_BASE_URL || 'https://192.168.11.87:9444').replace(/\/$/, '');
const outDir = process.env.WEBTERM_QA_OUTPUT || 'runtime/terminal-visuals/latest';
await mkdir(outDir, { recursive: true });
const results = [];
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1360, height: 900 } });
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

const paneOf = (label) => page.evaluate((label) => {
  const panes = Array.from(document.querySelectorAll('.terminal-pane'));
  return panes.findIndex((pane) => Array.from(pane.querySelectorAll('.terminal-tabbar [data-terminal-tab]'))
    .some((tab) => (tab.textContent || '').trim().startsWith(label)));
}, label);

const geometry = (paneIndex) => page.evaluate((paneIndex) => {
  const pane = document.querySelectorAll('.terminal-pane')[paneIndex];
  const surface = Array.from(pane.querySelectorAll('.terminal-surface')).find((n) => n.offsetParent !== null);
  if (!surface) return null;
  const xterm = surface.querySelector('.xterm');
  const screen = surface.querySelector('.xterm-screen');
  const spacer = surface.querySelector('.terminal-history-spacer');
  const helper = surface.querySelector('.xterm-helper-textarea');
  const cellHeight = Number(surface.dataset.sharedRows) ? screen.getBoundingClientRect().height / Number(surface.dataset.sharedRows) : 0;
  const cursorRow = Number(surface.dataset.cursorRow || -1);
  const baseY = (spacer?.style.height ? parseFloat(spacer.style.height) : 0) / (cellHeight || 1);
  const topPx = xterm?.style.top ? parseFloat(xterm.style.top) : 0;
  const viewportY = baseY + topPx / (cellHeight || 1);
  const rows = Number(surface.dataset.sharedRows || 0);
  const cursorDisplayed = cursorRow >= 0 && rows > 0
    && (baseY + cursorRow) >= viewportY - 0.01 && (baseY + cursorRow) < viewportY + rows - 0.01;
  const surfaceRect = surface.getBoundingClientRect();
  const screenRect = screen.getBoundingClientRect();
  return {
    activeTab: pane.querySelector('.terminal-tabbar [data-terminal-tab][data-active="true"]')?.textContent?.trim() || null,
    focused: document.activeElement === helper,
    scrollTop: Math.round(surface.scrollTop), scrollHeight: Math.round(surface.scrollHeight), clientHeight: surface.clientHeight,
    xtermTop: xterm?.style.top, viewportY: Math.round(viewportY * 10) / 10, baseY: Math.round(baseY),
    cursorRow, sharedRows: rows, cellHeight: Math.round(cellHeight * 10) / 10,
    cursorDisplayed,
    screenFitsSurface: screenRect.bottom <= surfaceRect.bottom + 1 && screenRect.top >= surfaceRect.top - 1,
    surface: { top: Math.round(surfaceRect.top), bottom: Math.round(surfaceRect.bottom) },
  };
}, paneIndex);

const shot = (name, paneIndex) => page.evaluate((paneIndex) => {
  const r = document.querySelectorAll('.terminal-pane')[paneIndex].getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
}, paneIndex).then((clip) => page.screenshot({ path: `${outDir}/${name}.png`, clip }));

const step = async (name, paneIndex, expectation) => {
  const state = await geometry(paneIndex);
  await shot(name, paneIndex);
  const failures = [];
  if (!state) failures.push('no visible terminal surface');
  else {
    if (expectation.cursor && !state.cursorDisplayed) failures.push(`cursor row not displayed (viewportY=${state.viewportY}, baseY=${state.baseY}, cursorRow=${state.cursorRow}, rows=${state.sharedRows})`);
    if (expectation.focus && !state.focused) failures.push('terminal not focused');
    if (expectation.atBottom && state.viewportY < state.baseY - 0.01) failures.push(`viewport not at live bottom (viewportY=${state.viewportY}, baseY=${state.baseY})`);
    if (expectation.screenFits && !state.screenFitsSurface) failures.push('rendered frame is not inside the visible band (blank panel)');
    if (expectation.rail && Math.abs(state.scrollTop - state.viewportY * (state.cellHeight || 21)) > 2) {
      failures.push(`rail/viewport desynced (scrollTop=${state.scrollTop}, viewportY=${state.viewportY}, cellHeight=${state.cellHeight})`);
    }
  }
  const record = { name, ok: failures.length === 0, failures, state };
  results.push(record);
  console.log(`${record.ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(state)}${failures.length ? ` :: ${failures.join(' | ')}` : ''}`);
};

const focusTerminal = (pane) => pane.evaluate((node) => Array.from(node.querySelectorAll('.terminal-surface'))
  .find((n) => n.offsetParent !== null)?.querySelector('.xterm-helper-textarea')?.focus());

const clickInputArea = async (paneIndex) => {
  const box = await page.evaluate((paneIndex) => {
    const pane = document.querySelectorAll('.terminal-pane')[paneIndex];
    const surface = Array.from(pane.querySelectorAll('.terminal-surface')).find((n) => n.offsetParent !== null);
    const r = surface.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, paneIndex);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 16);
  await page.waitForTimeout(600);
};

const scrollUp = async (paneIndex, notches = 12) => {
  const box = await page.evaluate((paneIndex) => {
    const pane = document.querySelectorAll('.terminal-pane')[paneIndex];
    const surface = Array.from(pane.querySelectorAll('.terminal-surface')).find((n) => n.offsetParent !== null);
    const r = surface.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, paneIndex);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < notches; i += 1) {
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(50);
  }
  await page.waitForTimeout(400);
};

try {
  await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll('.terminal-surface').length > 0, null, { timeout: 60000 });
  await page.waitForTimeout(2500);
  const health = await page.evaluate(async () => (await fetch('/api/health')).json());
  console.log(`environment=${health.environment} version=${health.version}`);

  // --- Scenario 1: switch to workspace 2, walk every tab of the multi-tab pane ---
  await page.locator('.workspace-tabs-toggle').first().click();
  await page.waitForTimeout(300);
  await page.getByRole('tab', { name: '2: 730' }).first().click();
  await page.waitForTimeout(1500);

  const paneIndex = await paneOf('47');
  const pane = page.locator('.terminal-pane').nth(paneIndex);
  const tabLabels = await pane.evaluate((node) => Array.from(node.querySelectorAll('.terminal-tabbar [data-terminal-tab]'))
    .map((n) => (n.textContent || '').trim().split(/\s/)[0].replace(/:$/, '')));
  console.log('multi-tab pane', paneIndex, JSON.stringify(tabLabels));

  for (const label of tabLabels) {
    const tab = pane.locator('.terminal-tabbar [data-terminal-tab]').filter({ hasText: new RegExp(`^${label}:`) });
    await tab.first().click();
    await page.waitForTimeout(700);
    await step(`01-switch-to-${label}`, paneIndex, { cursor: true, atBottom: true });
  }

  // --- Scenario 2: type into a panel and see the cursor follow ---
  const typingTab = pane.locator('.terminal-tabbar [data-terminal-tab]').filter({ hasText: /^54:/ });
  await typingTab.first().click();
  await page.waitForTimeout(600);
  await focusTerminal(pane);
  await page.keyboard.type('echo VISUAL_SUITE_TYPING');
  await page.waitForTimeout(400);
  await step('02-after-typing', paneIndex, { cursor: true, focus: true });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);
  await step('03-after-enter', paneIndex, { cursor: true, atBottom: true, focus: true });

  // --- Scenario 3: long history, then read it and click back to type ---
  await typingTab.first().click();
  await page.waitForTimeout(500);
  await focusTerminal(pane);
  await page.keyboard.type('seq 1 400');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1800);
  await step('04-after-history-built', paneIndex, { cursor: true, atBottom: true, focus: true });

  await scrollUp(paneIndex, 14);
  await step('05-scrolled-into-history', paneIndex, { cursor: false });

  await clickInputArea(paneIndex);
  await step('06-click-input-area-reveals-cursor', paneIndex, { cursor: true, atBottom: true, focus: true });

  // --- Scenario 4: read history again, reveal with Enter ---
  await scrollUp(paneIndex, 10);
  await step('07-scrolled-again', paneIndex, { cursor: false });
  await focusTerminal(pane);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  await step('08-enter-reveals-cursor', paneIndex, { cursor: true, atBottom: true, focus: true });

  // --- Scenario 5: switch away and back with long history ---
  const other = pane.locator('.terminal-tabbar [data-terminal-tab]').filter({ hasText: /^53:/ });
  await other.first().click();
  await page.waitForTimeout(800);
  await step('09-other-tab', paneIndex, { cursor: true, atBottom: true });
  await typingTab.first().click();
  await page.waitForTimeout(800);
  await step('10-back-on-history-tab', paneIndex, { cursor: false, screenFits: true, rail: true });

  // --- Scenario 6: click a panel that has never been typed into ---
  const untouched = pane.locator('.terminal-tabbar [data-terminal-tab]').filter({ hasText: /^56:/ });
  await untouched.first().click();
  await page.waitForTimeout(700);
  await clickInputArea(paneIndex);
  await step('11-click-untouched-panel', paneIndex, { cursor: true, focus: true });
} finally {
  await writeFile(`${outDir}/summary.json`, JSON.stringify({ results, pageErrors }, null, 2));
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} steps passed ===`);
if (pageErrors.length) console.log('pageErrors:', JSON.stringify(pageErrors));
for (const record of failed) console.log(`FAIL ${record.name}: ${record.failures.join(' | ')}`);
process.exitCode = failed.length ? 1 : 0;
