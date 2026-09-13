import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { visualReloadPhase } from './visual-reload-phase.mjs';
const { chromium } = createRequire(import.meta.url)('../ui/node_modules/playwright');
const output = process.env.WEBTERM_QA_OUTPUT || 'runtime/terminal-two-display';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: false, args: ['--no-sandbox'] });
const pages = [];
const results = [];
const requireClaude = () => {
  const command = execFileSync(process.env.WEBTERM_QA_TMUX_BINARY || 'tmux', ['-L', process.env.WEBTERM_QA_TMUX_SOCKET || 'webterm-release-test-fixed', 'display-message', '-pt', 'wt01-01-06-ee8f330da4330735', '#{pane_current_command}'], { encoding: 'utf8' }).trim();
  assert.equal(command, 'claude', 'Panel 6 is not running Claude; stop rather than inject CLI mouse sequences into Bash');
};
try {
  requireClaude();
  for (const width of [1920, 3440]) {
    const context = await browser.newContext({ viewport: { width, height: width === 1920 ? 1080 : 1440 }, ignoreHTTPSErrors: true, recordVideo: { dir: `${output}/video`, size: { width: 1280, height: 720 } } });
    const page = await context.newPage(); pages.push(page);
    await page.goto('https://192.168.11.87:9444/', { waitUntil: 'networkidle' });
    await visualReloadPhase(page);
    await page.locator('[data-tab-id]').first().waitFor();
  }
  await pages[0].waitForTimeout(2500);
  for (const page of pages) {
    await page.evaluate(() => {
      window.__qaFrames = []; window.__qaRecording = true;
      const tick = () => {
        if (!window.__qaRecording) return;
        for (const e of document.querySelectorAll('.terminal-surface')) {
          if (!e.offsetWidth) continue;
          const r = e.getBoundingClientRect();
          if (r.bottom <= 0 || r.top >= innerHeight) continue;
          const screen = e.querySelector('.xterm-screen')?.getBoundingClientRect();
          const id = e.closest('.terminal-pane')?.querySelector('[data-active="true"]')?.dataset.tabId;
          if (screen && id) window.__qaFrames.push({ id, font: e.dataset.fittedFontSize, cols: e.dataset.sharedCols, rows: e.dataset.sharedRows, width: r.width, height: r.height, screenWidth: screen.width, screenHeight: screen.height });
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }
  // Both browsers stay connected: same session, then different selections,
  // remote order sync, and repeated revisits without replacing the canvas.
  for (const [index, page] of pages.entries()) {
    const other = pages[1 - index];
    for (const pane of await page.locator('.terminal-grid-cell:visible').all()) {
      const tabs = pane.locator('[data-tab-id]');
      if (await tabs.count() < 2) continue;
      const original = await pane.locator('[data-active="true"]').getAttribute('data-tab-id');
      const ids = await tabs.evaluateAll(nodes => nodes.map(n => n.dataset.tabId));
      const first = pane.locator(`[data-tab-id="${ids[0]}"]`);
      const second = pane.locator(`[data-tab-id="${ids[1]}"]`);
      const remoteFirst = other.locator(`[data-tab-id="${ids[0]}"]`);
      const remotePane = remoteFirst.locator('xpath=ancestor::*[contains(@class,"terminal-grid-cell")]');
      const remoteOriginal = await remotePane.locator('[data-active="true"]').getAttribute('data-tab-id');
      try {
        await first.click(); await remoteFirst.click(); await page.waitForTimeout(1000);
        await pane.evaluate(e => { e.__qaKept = [...e.querySelectorAll('.terminal-surface')].find(n => n.offsetWidth > 0); });
        for (let round = 0; round < 5; round++) {
          await second.click(); await page.waitForTimeout(100);
          await first.click(); await first.click();
          const box = await second.boundingBox();
          await first.dragTo(second, { targetPosition: { x: box.width - 3, y: box.height / 2 } });
          await page.waitForTimeout(650);
          await first.dragTo(second, { targetPosition: { x: 2, y: box.height / 2 } });
          await page.waitForTimeout(650);
          assert(await pane.evaluate(e => e.__qaKept?.isConnected), 'Reorder or tab switch replaced the terminal');
        }
        assert.deepEqual(await tabs.evaluateAll(nodes => nodes.map(n => n.dataset.tabId)), ids);
        results.push({ display: index, ids, switchAndDragCycles: 5, canvasRetained: true });
      } finally {
        await pane.locator(`[data-tab-id="${original}"]`).click();
        await remotePane.locator(`[data-tab-id="${remoteOriginal}"]`).click();
      }
    }
    // Repeat history and whole-page viewport entry for Bash and Claude.
    for (const number of [2, 6]) {
      if (number === 6) requireClaude();
      const tab = page.locator('[data-tab-id]').filter({ hasText: new RegExp(`^${number}:`) });
      await tab.click();
      const pane = tab.locator('xpath=ancestor::*[contains(@class,"terminal-grid-cell")]');
      const terminal = pane.locator('.terminal-surface:visible');
      for (let i = 0; i < 5; i++) {
        await page.locator('.terminal-grid').evaluate(e => { e.scrollTop = 0; });
        await terminal.scrollIntoViewIfNeeded(); await terminal.hover();
        for (let j = 0; j < 6; j++) await page.mouse.wheel(0, -100);
        for (let j = 0; j < 9; j++) await page.mouse.wheel(0, 100);
        await page.waitForTimeout(150);
      }
      await terminal.screenshot({ path: `${output}/display-${index}-panel-${number}.png` });
      const fill = await terminal.evaluate(e => {
        const screen = e.querySelector('.xterm-screen').getBoundingClientRect();
        const bar = e.querySelector('.scrollbar.vertical').getBoundingClientRect();
        const surface = e.getBoundingClientRect();
        const edge = e.classList.contains('desktop-local-viewport') ? surface.left + e.clientWidth : bar.left;
        return { font: e.dataset.fittedFontSize, cols: Number(e.dataset.sharedCols), rows: Number(e.dataset.sharedRows), rightGap: edge - screen.right, bottomGap: surface.top + e.clientHeight - screen.bottom, cellWidth: screen.width / Number(e.dataset.sharedCols), cellHeight: screen.height / Number(e.dataset.sharedRows) };
      });
      results.push({ display: index, panel: number, fill });
      assert(fill.rightGap >= 0 && fill.bottomGap >= 0, 'Terminal overlaps a panel edge');
      if (index === 1) {
        assert(fill.rightGap <= fill.cellWidth + 3, `Large screen is not filled horizontally: ${JSON.stringify(fill)}`);
        assert(fill.bottomGap <= fill.cellHeight + 3, `Large screen is not filled vertically: ${JSON.stringify(fill)}`);
      }
    }
  }
} finally {
  for (const [index, page] of pages.entries()) {
    const frames = await page.evaluate(() => { window.__qaRecording = false; return window.__qaFrames || []; }).catch(() => []);
    await writeFile(`${output}/display-${index}-frames.json`, JSON.stringify(frames));
    const metrics = new Map();
    const fontChanges = [];
    for (const frame of frames) {
      if (!frame.font) continue; // first attachment is not a retained-view revisit
      // Peer-driven grid changes must not exempt local font changes.
      const key = [frame.id, frame.width, frame.height].join(':');
      const previous = metrics.get(key);
      if (previous && previous !== frame.font) fontChanges.push({ key, previous, next: frame.font });
      metrics.set(key, frame.font);
    }
    results.push({ display: index, sampledFrames: frames.length, sameGeometryFontChanges: fontChanges });
  }
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  await browser.close();
}
for (const result of results.filter(item => 'sampledFrames' in item)) {
  assert(result.sampledFrames > 0, 'Dynamic recording captured no frames');
  assert.equal(result.sameGeometryFontChanges.length, 0, 'Font changed with unchanged local geometry');
}
