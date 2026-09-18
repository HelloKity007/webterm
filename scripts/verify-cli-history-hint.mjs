import { chromium } from '../ui/node_modules/playwright/index.mjs';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { visualReloadPhase } from './visual-reload-phase.mjs';
import { terminalViewportProbe } from './terminal-viewport-probe.mjs';

const output = process.env.WEBTERM_QA_OUTPUT || 'runtime/cli-history-hint';
const rounds = Number(process.env.WEBTERM_QA_ROUNDS || 1);
assert(Number.isInteger(rounds) && rounds > 0, 'WEBTERM_QA_ROUNDS must be a positive integer');
await mkdir(output, { recursive: true });
const capture = () => execFileSync('runtime/tmux-fixed/bin/tmux', ['-L', 'webterm-release-test-fixed', 'capture-pane', '-p', '-t', 'wt01-01-06-ee8f330da4330735'], { encoding: 'utf8' });
const browser = await chromium.launch();
const results = [];
const traces = [];
let candidate;
try {
  for (const width of [1920, 3440]) {
    const viewport = { width, height: width === 1920 ? 1080 : 1440 };
    const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport,
      recordVideo: { dir: `${output}/video`, size: viewport } });
    const mouseReports = [];
    if (process.env.WEBTERM_QA_TRACE === '1') {
      const trace = { width, sockets: [], events: [], bytes: 0, overflow: false };
      traces.push(trace);
      page.on('framenavigated', frame => {
        if (frame === page.mainFrame()) trace.events.push({ at: Date.now(), kind: 'navigation' });
      });
      page.on('websocket', socket => {
        const url = new URL(socket.url());
        if (url.searchParams.get('panel_number') !== '6') return;
        const id = trace.sockets.length;
        // Never persist the URL/query: it can contain authentication tokens.
        trace.sockets.push({ id, at: Date.now(), path: url.pathname,
          panel: url.searchParams.get('panel_number'), workspace: url.searchParams.get('workspace_index') });
        socket.on('framereceived', ({ payload }) => {
          trace.bytes += Buffer.byteLength(payload);
          if (trace.bytes > 4 * 1024 * 1024) { trace.overflow = true; return; }
          try {
            const value = JSON.parse(payload);
            const data = typeof value.data === 'string'
              ? (value.b64 ? Buffer.from(value.data, 'base64').toString('utf8') : value.data) : undefined;
            trace.events.push({ at: Date.now(), kind: 'received', id, type: value.type, data });
          } catch { trace.events.push({ at: Date.now(), kind: 'unparsed-frame', id }); }
        });
        socket.on('close', () => trace.events.push({ at: Date.now(), kind: 'closed', id }));
      });
    }
    page.on('websocket', socket => socket.on('framesent', ({ payload }) => {
      try { const value = JSON.parse(payload); if (typeof value.data === 'string' && (/^\u001b\[<\d+;/.test(value.data) || value.data.startsWith('\u001b[M'))) mouseReports.push(value.data); } catch {}
    }));
    await page.goto('https://192.168.11.87:9444', { waitUntil: 'networkidle' });
    const health = await page.evaluate(async () => (await fetch('/api/health')).json());
    assert.equal(health.environment, 'release-test');
    if (candidate) assert.deepEqual(health, candidate, 'Candidate changed during hint verification');
    else candidate = health;
    await writeFile(`${output}/candidate.json`, JSON.stringify(candidate, null, 2));
    for (let round = 0; round < rounds; round++) {
      const name = `${width}-${round}`;
      const tab = page.locator('[data-tab-id]').filter({ hasText: /^6:/ }).first();
      await tab.click();
      const root = tab.locator('xpath=ancestor::*[contains(@class,"terminal-grid-cell")]').locator('.terminal-root:visible');
      const surface = root.locator('.terminal-surface');
      await surface.hover();
      await page.waitForTimeout(1000);
      for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(150); }
      const hint = root.locator('.terminal-history-resume');
      await page.waitForTimeout(1000);
      // Deliberately reload while reading history, not before scrolling. A fresh
      // page test cannot catch a resume control lost during state restoration.
      if (process.env.WEBTERM_QA_RELOAD && process.env.WEBTERM_QA_RELOAD !== 'fresh') {
        await root.screenshot({ path: `${output}/${name}-before-reload.png` });
        await visualReloadPhase(page);
        await page.waitForTimeout(1500);
      }
      const history = capture();
      if (process.env.WEBTERM_QA_TRACE === '1') await writeFile(`${output}/${name}-server-before-click.txt`, history);
      const serverNativeRow = history.split('\n').findIndex(line => /Jump to bottom.*ctrl.End/i.test(line));
      // The OSC grid title can lag an alternate-screen redraw after a reload.
      // Use the actual rendered xterm rows to locate the Claude statusline /
      // composer rather than an advisory dataset cursor coordinate.
      let terminalState;
      let renderedNativeRow = -1;
      let composerRow = -1;
      for (let attempt = 0; attempt < 60; attempt++) {
        terminalState = await surface.evaluate(terminalViewportProbe);
        renderedNativeRow = terminalState.lines.findIndex(line => /Jump to bottom.*ctrl.End/i.test(line));
        composerRow = terminalState.lines.findIndex((line, index) => index > renderedNativeRow &&
          (/WebTerm-visual-QA/.test(line) || /^❯\s*/.test(line)));
        if (renderedNativeRow >= 0 && composerRow >= 0) break;
        await page.waitForTimeout(100);
      }
      await writeFile(`${output}/${name}-render-wait.json`, JSON.stringify({ serverNativeRow, renderedNativeRow, composerRow, terminalState }, null, 2));
      assert(serverNativeRow >= 0, 'Native Claude return-to-bottom hint was not present in tmux');
      assert(renderedNativeRow >= 0, 'Native Claude return-to-bottom hint was not rendered');
      assert(composerRow >= 0, 'Cannot locate the rendered Claude composer after history hint');
      // Locator screenshots may scroll the page. Measure click coordinates only
      // after that scroll, not before it.
      await root.screenshot({ path: `${output}/${name}-hint.png` });
      const position = await root.evaluate((e, { serverNativeRow, renderedNativeRow, composerRow, rows }) => {
        const screen = e.querySelector('.xterm-screen').getBoundingClientRect();
        const rowHeight = screen.height / rows;
        const hint = e.querySelector('.terminal-history-resume')?.getBoundingClientRect();
        return { hintBottom: renderedNativeRow >= 0 ? screen.top + (renderedNativeRow + 1) * rowHeight : hint?.bottom,
          composerTop: screen.top + composerRow * rowHeight,
          // tmux receives the server grid coordinate. It intentionally differs
          // from the clipped local visual row in a shared Panel grid.
          nativeClick: { x: screen.left + screen.width / 2, y: screen.top + (serverNativeRow + 0.5) * rowHeight } };
      }, { serverNativeRow, renderedNativeRow, composerRow, rows: terminalState.rows });
      await writeFile(`${output}/${name}-before-click.json`, JSON.stringify({ position, serverNativeRow, renderedNativeRow, composerRow, terminalState }, null, 2));
      assert(position.hintBottom <= position.composerTop, 'Hint must be above the composer');
      if (serverNativeRow >= 0) assert.equal(await hint.count(), 0, 'Do not duplicate the native hint');
      else await hint.waitFor({ state: 'visible' });
      if (serverNativeRow >= 0) await page.mouse.click(position.nativeClick.x, position.nativeClick.y);
      else await hint.click();
      await page.waitForTimeout(1000);
      assert.equal(await hint.count(), 0, 'Hint should dismiss on return');
      const resumed = capture();
      await writeFile(`${output}/${name}-click.json`, JSON.stringify({ position, serverNativeRow, renderedNativeRow, mouseReports }, null, 2));
      await root.screenshot({ path: `${output}/${name}-returned.png` });
      assert.notEqual(resumed, history, 'Return must actually change the CLI history viewport');
      results.push({ width, round, position, native: serverNativeRow >= 0, returned: true, video: await page.video().path() });
    }
    await page.close();
  }
} catch (error) {
  await writeFile(`${output}/failure.json`, JSON.stringify({ error: error.message, reload: process.env.WEBTERM_QA_RELOAD || 'fresh' }, null, 2));
  throw error;
} finally {
  await browser.close();
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  if (process.env.WEBTERM_QA_TRACE === '1') await writeFile(`${output}/receive-trace.json`, JSON.stringify(traces, null, 2));
}
console.log(results);
