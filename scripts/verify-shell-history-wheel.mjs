import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { visualReloadPhase } from './visual-reload-phase.mjs';

const { chromium } = createRequire(import.meta.url)('../ui/node_modules/playwright');
const output = process.env.WEBTERM_QA_OUTPUT || 'runtime/shell-history-wheel';
const tmux = process.env.WEBTERM_QA_TMUX_BINARY || 'tmux';
const socket = process.env.WEBTERM_QA_TMUX_SOCKET || 'webterm-release-test-fixed';
const target = 'wt01-01-02-2ceeceecf3172937';
const marker = `WEBTERM_WHEEL_HISTORY_${Date.now()}`;
const runTmux = (args) => execFileSync(tmux, ['-L', socket, ...args], { encoding: 'utf8' });

await mkdir(output, { recursive: true });
assert.equal(runTmux(['display-message', '-p', '-t', target, '#{pane_current_command}']).trim(), 'bash',
  'Panel 2 must be an idle Bash fixture before history-wheel verification');
// This is the isolated release-test tmux socket. Seed more than one screen of
// output before opening the browser so the first wheel must fetch tmux history
// rather than merely scroll output received over the same websocket.
runTmux(['send-keys', '-t', target, '-l', `for i in {1..320}; do printf '${marker}_%04d\\n' "$i"; done`]);
runTmux(['send-keys', '-t', target, 'Enter']);
const deadline = Date.now() + 6000;
while (Date.now() < deadline && !runTmux(['capture-pane', '-p', '-S', '-400', '-t', target]).includes(`${marker}_0320`)) {
  await new Promise(resolve => setTimeout(resolve, 100));
}
assert(runTmux(['capture-pane', '-p', '-S', '-400', '-t', target]).includes(`${marker}_0001`), 'history fixture did not reach tmux');

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: false, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
  await page.goto('https://192.168.11.87:9444/', { waitUntil: 'networkidle' });
  await visualReloadPhase(page);
  const tab = page.locator('[data-tab-id]').filter({ hasText: /^2:/ }).first();
  await tab.click();
  const panel = tab.locator('xpath=ancestor::*[contains(@class,"terminal-grid-cell")]');
  const terminal = panel.locator('.terminal-surface:visible');
  await terminal.waitFor();
  await page.waitForTimeout(800);
  await terminal.hover();
  // One physical wheel-up is the public contract: it lazy-loads the existing
  // tmux scrollback and moves off the current bottom viewport.
  await page.mouse.wheel(0, -120);
  await page.waitForFunction(element => {
    const viewport = element.querySelector('.xterm-viewport');
    return Boolean(viewport && viewport.scrollHeight > viewport.clientHeight && viewport.scrollTop > 0);
  }, await terminal.elementHandle(), { timeout: 10000 });
  const state = await terminal.evaluate(element => {
    const viewport = element.querySelector('.xterm-viewport');
    return viewport ? {
      top: viewport.scrollTop,
      max: viewport.scrollHeight - viewport.clientHeight,
      scrollbar: getComputedStyle(element.querySelector('.scrollbar.vertical')).display,
    } : null;
  });
  assert(state && state.max > 0 && state.top > 0, `wheel did not expose remote history: ${JSON.stringify(state)}`);
  assert.equal(state.scrollbar, 'block', `Bash history scrollbar is hidden: ${JSON.stringify(state)}`);
  await terminal.screenshot({ path: `${output}/after-wheel-up.png` });
  await writeFile(`${output}/results.json`, JSON.stringify({ marker, state }, null, 2));
  console.log(JSON.stringify({ marker, state }));
} finally {
  await browser.close();
}
