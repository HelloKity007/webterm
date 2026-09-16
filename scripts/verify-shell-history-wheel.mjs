import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { visualReloadPhase } from './visual-reload-phase.mjs';

const { chromium } = createRequire(import.meta.url)('../ui/node_modules/playwright');
const output = process.env.WEBTERM_QA_OUTPUT || 'runtime/shell-history-wheel';
const tmux = process.env.WEBTERM_QA_TMUX_BINARY || 'tmux';
const socket = process.env.WEBTERM_QA_TMUX_SOCKET || 'webterm-release-test-fixed';
const panelNumber = Number(process.env.WEBTERM_QA_PANEL_NUMBER || '2');
assert(Number.isInteger(panelNumber) && panelNumber > 0, 'WEBTERM_QA_PANEL_NUMBER must be a positive integer');
const marker = `WEBTERM_WHEEL_HISTORY_${Date.now()}`;
const runTmux = (args) => execFileSync(tmux, ['-L', socket, ...args], { encoding: 'utf8' });

await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: false, args: ['--no-sandbox'] });
try {
  // Layout restores may generate new terminal IDs. Discover the actual Panel
  // 2 ID first, then derive the same server-side safe tmux name used by the
  // endpoint. Close this probe before creating history so the tested browser
  // itself receives only the bounded initial screen snapshot.
  const probe = await browser.newPage({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
  await probe.goto('https://192.168.11.87:9444/', { waitUntil: 'networkidle' });
  await visualReloadPhase(probe);
  const panelLabel = new RegExp(`^${panelNumber}:`);
  const probeTab = probe.locator('[data-tab-id]').filter({ hasText: panelLabel }).first();
  await probeTab.click();
  const terminalID = await probeTab.getAttribute('data-tab-id');
  assert(terminalID, 'Panel 2 has no terminal ID');
  await probe.close();
  const target = `wt01-01-${String(panelNumber).padStart(2, '0')}-${createHash('sha256').update(terminalID).digest('hex').slice(0, 16)}`;
  const command = runTmux(['display-message', '-p', '-t', target, '#{pane_current_command}']).trim();
  if (command === 'bash') {
    // This is the isolated release-test tmux socket. Seed more than one screen
    // before opening the tested browser so its first wheel must fetch tmux
    // history rather than merely scroll output received over its websocket.
    runTmux(['send-keys', '-t', target, '-l', `for i in {1..320}; do printf '${marker}_%04d\\n' "$i"; done`]);
    runTmux(['send-keys', '-t', target, 'Enter']);
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline && !runTmux(['capture-pane', '-p', '-S', '-400', '-t', target]).includes(`${marker}_0320`)) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(runTmux(['capture-pane', '-p', '-S', '-400', '-t', target]).includes(`${marker}_0001`), 'history fixture did not reach tmux');
  } else {
    assert(Number(runTmux(['display-message', '-p', '-t', target, '#{history_size}']).trim()) > 100,
      `Panel ${panelNumber} (${target}) needs existing long history for a non-Bash verification`);
  }

  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
  const historyResponses = [];
  page.on('response', async response => {
    if (response.url().includes('/api/terminal-history/')) {
      const payload = await response.json().catch(() => null);
      historyResponses.push({ status: response.status(), url: response.url(), bytes: payload?.bytes });
    }
  });
  await page.goto('https://192.168.11.87:9444/', { waitUntil: 'networkidle' });
  await visualReloadPhase(page);
  const tab = page.locator('[data-tab-id]').filter({ hasText: panelLabel }).first();
  await tab.click();
  const panel = tab.locator('xpath=ancestor::*[contains(@class,"terminal-grid-cell")]');
  const terminal = panel.locator('.terminal-surface:visible');
  await terminal.waitFor();
  await page.waitForTimeout(800);
  await terminal.hover();
  // One physical wheel-up is the public contract: it lazy-loads the existing
  // tmux scrollback and moves off the current bottom viewport.
  await page.mouse.wheel(0, -120);
  const historyScrollDeadline = Date.now() + 15000;
  let historyScrolled = false;
  while (Date.now() < historyScrollDeadline) {
    historyScrolled = await terminal.evaluate(element => {
      const scrollbar = element.querySelector('.scrollbar.vertical');
      const slider = scrollbar?.firstElementChild;
      const scrollbarBox = scrollbar?.getBoundingClientRect();
      const sliderBox = slider?.getBoundingClientRect();
      return Boolean(sliderBox && scrollbarBox && scrollbarBox.height > sliderBox.height &&
        sliderBox.top - scrollbarBox.top < scrollbarBox.height - sliderBox.height);
    });
    if (historyScrolled) break;
    await page.waitForTimeout(150);
  }
  const state = await terminal.evaluate(element => {
    const viewport = element.querySelector('.xterm-viewport');
    const scrollbar = element.querySelector('.scrollbar.vertical');
    const slider = scrollbar?.firstElementChild;
    const scrollbarBox = scrollbar?.getBoundingClientRect();
    const sliderBox = slider?.getBoundingClientRect();
    return viewport ? {
      top: viewport.scrollTop,
      max: viewport.scrollHeight - viewport.clientHeight,
      scrollbar: getComputedStyle(scrollbar).display,
      sliderTop: sliderBox && scrollbarBox ? sliderBox.top - scrollbarBox.top : null,
      sliderTravel: sliderBox && scrollbarBox ? scrollbarBox.height - sliderBox.height : null,
      rows: [...element.querySelectorAll('.xterm-accessibility-tree [role="listitem"]')].map(row => row.textContent).filter(Boolean).slice(-3),
    } : null;
  });
  await terminal.screenshot({ path: `${output}/after-wheel-up.png` });
  assert(historyScrolled && state && state.sliderTravel > 0 && state.sliderTop < state.sliderTravel,
    `wheel did not move away from the current history bottom: ${JSON.stringify({ state, historyResponses })}`);
  assert.equal(state.scrollbar, 'block', `Bash history scrollbar is hidden: ${JSON.stringify(state)}`);

  // Ctrl+Shift+R is a cache-bypassing page reload. The page must use the
  // viewport anchor recorded above to refill shell history and return to the
  // same non-bottom reader position, not merely preserve a browser cache.
  const reloadSession = await page.context().newCDPSession(page);
  await reloadSession.send('Network.enable');
  await reloadSession.send('Network.setCacheDisabled', { cacheDisabled: true });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await reloadSession.detach();
  let reloadState = null;
  const reloadDeadline = Date.now() + 15000;
  while (Date.now() < reloadDeadline) {
    reloadState = await terminal.evaluate(element => {
      const viewport = element.querySelector('.xterm-viewport');
      const scrollbar = element.querySelector('.scrollbar.vertical');
      const slider = scrollbar?.firstElementChild;
      const scrollbarBox = scrollbar?.getBoundingClientRect();
      const sliderBox = slider?.getBoundingClientRect();
      return viewport ? {
        top: viewport.scrollTop,
        max: viewport.scrollHeight - viewport.clientHeight,
        sliderTop: sliderBox && scrollbarBox ? sliderBox.top - scrollbarBox.top : null,
        sliderTravel: sliderBox && scrollbarBox ? scrollbarBox.height - sliderBox.height : null,
      } : null;
    });
    if (reloadState && reloadState.sliderTravel > 0 && reloadState.sliderTop < reloadState.sliderTravel) break;
    await page.waitForTimeout(150);
  }
  assert(reloadState && reloadState.sliderTravel > 0 && reloadState.sliderTop < reloadState.sliderTravel,
    `hard reload returned shell history to bottom: ${JSON.stringify({ state, reloadState, historyResponses })}`);
  assert(historyResponses.length >= 2,
    `hard reload did not request the saved shell history: ${JSON.stringify(historyResponses)}`);
  await writeFile(`${output}/results.json`, JSON.stringify({ marker, panelNumber, command, state, reloadState, historyResponses }, null, 2));
  console.log(JSON.stringify({ marker, panelNumber, command, state, reloadState, historyResponses }));
} finally {
  await browser.close();
}
