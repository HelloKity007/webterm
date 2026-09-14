import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { visualReloadPhase } from './visual-reload-phase.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('../ui/node_modules/playwright');
const output = process.env.WEBTERM_QA_OUTPUT || 'runtime/claude-composer-qa';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: false, args: ['--no-sandbox'] });
const results = [];
try {
  for (const [width, height] of [[1920,1080],[2860,988],[3440,1440]]) {
    const context = await browser.newContext({ viewport: { width, height }, ignoreHTTPSErrors: true });
    const health = await (await context.request.get('https://192.168.11.87:9444/api/health')).json();
    assert.equal(health.environment, 'release-test');
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto('https://192.168.11.87:9444/', { waitUntil: 'networkidle' });
    await visualReloadPhase(page);
    const panel = page.locator('.terminal-surface:visible').nth(5);
    await panel.waitFor();
    assert.equal(await page.locator('.app-statusbar').count(), 0);
    assert.equal(await page.locator('.workspace-tabs').count(), 0);
    const toggle = page.locator('.workspace-tabs-toggle');
    const gridHeight = await page.locator('.terminal-grid').evaluate(e => e.clientHeight);
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('.workspace-tabs').evaluate(e => e.getBoundingClientRect().height), 30);
    assert.equal(await page.locator('.terminal-grid').evaluate(e => e.clientHeight), gridHeight - 30);
    await toggle.click();
    assert.equal(await page.locator('.workspace-tabs').count(), 0);
    assert.equal(await page.locator('.terminal-grid').evaluate(e => e.clientHeight), gridHeight);
    assert.equal(await toggle.evaluate(e => Array.from(e.parentElement.children).filter(n => n.classList.contains('activity-btn')).indexOf(e)), 1);
    const filesToggle = page.locator('.activity-files');
    assert.equal(await filesToggle.count(), 1);
    assert.equal(await page.locator('.ssh-files-toggle').count(), 0);
    await filesToggle.click();
    const files = page.locator('[data-testid="file-workspace"]');
    await files.waitFor();
    assert.equal(await files.locator('.sftp-endpoint').count(), 2);
    assert.equal(await files.locator('.sftp-divider[role="separator"]').count(), 1);
    await page.screenshot({ path: `${output}/${width}-files-open.png` });
    await page.locator('.activity-ssh').click();
    await page.locator('.terminal-grid').waitFor();
    assert.equal(await page.locator('.terminal-grid').evaluate(e => getComputedStyle(e).scrollbarColor), 'rgb(53, 95, 61) rgb(217, 237, 217)');
    const titlebars = await page.locator('.terminal-tabbar:visible').evaluateAll(bars => bars.map(bar => {
      const bounds = bar.getBoundingClientRect();
      const tabs = Array.from(bar.querySelectorAll('[data-terminal-tab]')).map(tab => {
        const text = Array.from(tab.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
        const range = document.createRange();
        if (text) range.selectNodeContents(text);
        const rect = text ? range.getBoundingClientRect() : tab.getBoundingClientRect();
        return { title: text?.textContent, font: getComputedStyle(tab).fontSize,
          topGap: rect.top - bounds.top, bottomGap: bounds.bottom - rect.bottom };
      });
      return { height: bounds.height, tabs };
    }));
    for (const bar of titlebars) {
      assert.equal(bar.height, 28);
      for (const tab of bar.tabs) assert(tab.topGap >= 0 && tab.bottomGap >= 0, `clipped title: ${tab.title}`);
    }
    const layout = await page.locator('.terminal-grid').evaluate(e => {
      const bounds = e.getBoundingClientRect();
      return { columns: Number(e.dataset.panelColumns), rows: Number(e.dataset.panelRows),
        scrollHeight: e.scrollHeight, clientHeight: e.clientHeight,
        firstScreenPanels: Array.from(e.querySelectorAll('.terminal-surface')).filter(p => {
          const r = p.getBoundingClientRect();
          return r.width > 0 && r.top >= bounds.top && r.bottom <= bounds.bottom + 1;
        }).length };
    });
    assert.equal(layout.columns, width < 3000 ? 2 : 4);
    assert.equal(layout.firstScreenPanels, width < 3000 ? 4 : 8);
    if (width < 3000) assert(layout.scrollHeight > layout.clientHeight);
    await page.screenshot({ path: `${output}/${width}-layout.png` });
    await panel.scrollIntoViewIfNeeded();
    await page.waitForTimeout(5000);
    const measure = () => panel.evaluate(e => {
      const screen = e.querySelector('.xterm-screen').getBoundingClientRect();
      const bar = e.querySelector('.scrollbar.vertical').getBoundingClientRect();
      const surface = e.getBoundingClientRect();
      const edge = e.classList.contains('desktop-local-viewport') ? surface.left + e.clientWidth : bar.left;
      return { authority: e.dataset.gridAuthority, font: e.dataset.fittedFontSize, lineHeight: Number(e.dataset.fittedLineHeight || 1), cols: Number(e.dataset.sharedCols), rows: Number(e.dataset.sharedRows), width: e.clientWidth, height: e.clientHeight, rightGap: edge - screen.right, bottomGap: surface.top + e.clientHeight - screen.bottom };
    });
    const before = await measure();
    await panel.screenshot({ path: `${output}/${width}-before.png` });
    await panel.hover();
    for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, -100); await page.waitForTimeout(80); }
    await page.waitForTimeout(200);
    await panel.screenshot({ path: `${output}/${width}-history.png` });
    for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 100); await page.waitForTimeout(80); }
    await page.waitForTimeout(5000);
    const after = await measure();
    await panel.screenshot({ path: `${output}/${width}-returned.png` });
    results.push({ width, height, health, layout, titlebars, before, after, errors });
    assert.equal(before.authority, 'server');
    assert(before.bottomGap >= 0 && before.rightGap >= 0);
    assert(before.lineHeight >= 1 && before.lineHeight <= 1.15);
    assert(after.lineHeight >= 1 && after.lineHeight <= 1.15);
    // Another attached display may legitimately renegotiate the shared PTY
    // rows/columns. History navigation must not change this browser's geometry
    // or local font, and the returned composer must still fit without clipping.
    assert.equal(after.width, before.width);
    assert.equal(after.height, before.height);
    assert.equal(after.font, before.font);
    assert(after.rows > 0 && after.cols > 1);
    assert(after.bottomGap >= 0 && after.rightGap >= 0);
    assert.equal(errors.length, 0);
    await context.close();
  }
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  await browser.close();
}
