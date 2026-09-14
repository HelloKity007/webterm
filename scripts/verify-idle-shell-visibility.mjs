import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { visualReloadPhase } from './visual-reload-phase.mjs';
const { chromium } = createRequire(import.meta.url)('../ui/node_modules/playwright');
const output = process.env.WEBTERM_QA_OUTPUT || 'runtime/idle-shell-visibility';
await mkdir(output, { recursive: true });
const binary = process.env.WEBTERM_QA_TMUX_BINARY || 'tmux';
const socket = process.env.WEBTERM_QA_TMUX_SOCKET || 'webterm-release-test-fixed';
const target = 'wt01-01-01-1d0366ed028cdf5d';
const targetTabID = 'ssh-2-1788531298390';
const info = () => execFileSync(binary, ['-L', socket, 'display-message', '-pt', target,
  '#{pane_current_command}:#{cursor_y}:#{pane_height}:#{pid}:#{pane_pid}'], { encoding: 'utf8' }).trim().split(':');
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: false, args: ['--no-sandbox'] });
const results = [];
const fonts = new Map();
try {
  const original = info(); assert.equal(original[0], 'bash');
  const pages = [];
  for (const width of [1920, 3440, 2860]) {
    const page = await browser.newPage({ viewport: { width, height: width === 3440 ? 1440 : 1080 }, ignoreHTTPSErrors: true });
    pages.push(page);
    await page.goto('https://192.168.11.87:9444/', { waitUntil: 'networkidle' });
    await visualReloadPhase(page);
    // The fixture pane contains multiple tabs. Select the tab represented by
    // `target` before comparing its browser viewport with that tmux pane.
    // Otherwise the assertion can mix an inactive tab's cursor with the
    // currently visible terminal surface.
    const targetTab = page.locator(`[data-tab-id="${targetTabID}"]`);
    await targetTab.click();
    await page.locator(`[data-tab-id="${targetTabID}"][data-active="true"]`).waitFor();
    await page.waitForTimeout(1800);
    // Do not focus/type: that would conceal the idle-shell blank viewport bug.
    for (let index = 0; index < pages.length; index++) {
      const pane = pages[index].locator(`[data-tab-id="${targetTabID}"]`)
        .locator('xpath=ancestor::*[contains(@class,"terminal-grid-cell")]').locator('.terminal-surface:visible');
      const actual = info(); assert.equal(actual[0], 'bash'); assert.deepEqual(actual.slice(3), original.slice(3));
      const metrics = await pane.evaluate((surface, row) => {
        const screen = surface.querySelector('.xterm-screen').getBoundingClientRect();
        const cell = screen.height / Number(surface.dataset.sharedRows);
        return { scrollTop: surface.scrollTop, height: surface.clientHeight, cursorTop: row * cell,
          cursorBottom: (row + 1) * cell, font: surface.dataset.fittedFontSize };
      }, Number(actual[1]));
      await pane.screenshot({ path: `${output}/${width}-peer-${index}.png` });
      results.push({ width, peer: index, ...metrics });
      if (fonts.has(index)) assert(Math.abs(Number(metrics.font) - fonts.get(index)) < 0.05, 'Peer changed local idle-shell font');
      else fonts.set(index, Number(metrics.font));
      assert(metrics.cursorTop >= metrics.scrollTop - 1, 'Idle prompt hidden above local viewport');
      assert(metrics.cursorBottom <= metrics.scrollTop + metrics.height + 1, 'Idle prompt hidden below local viewport');
    }
  }
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  await browser.close();
}
