import { chromium } from '../ui/node_modules/playwright/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const output = process.env.WEBTERM_QA_OUTPUT || 'runtime/renderer-font-stability';
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const results = [];
try {
  for (const width of [1920, 3440]) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height: width === 1920 ? 1080 : 1440 } });
    await context.addInitScript(() => {
      // Hold only idle work so we can observe the real DOM -> GPU transition.
      const pending = new Map(); let next = 0;
      const requestIdle = window.requestIdleCallback.bind(window);
      const cancelIdle = window.cancelIdleCallback.bind(window);
      window.requestIdleCallback = (cb, options) => {
        // xterm has its own idle tasks (including rendering). Do not hold those.
        if (options?.timeout !== 1200) return requestIdle(cb, options);
        const id = --next; pending.set(id, cb); return id;
      };
      window.cancelIdleCallback = id => { if (!pending.delete(id)) cancelIdle(id); };
      window.__qaRunIdle = () => { const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(cb => cb({ didTimeout: false, timeRemaining: () => 20 })); };
      window.__qaGL = [];
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (...args) {
        const value = getContext.apply(this, args);
        if (value && /^webgl/.test(args[0])) window.__qaGL.push({ canvas: this, context: value });
        return value;
      };
    });
    const page = await context.newPage();
    const health = await (await page.request.get('https://192.168.11.87:9444/api/health')).json();
    assert.equal(health.environment, 'release-test');
    await page.goto('https://192.168.11.87:9444', { waitUntil: 'networkidle' });
    const tab = page.locator('[data-tab-id]').filter({ hasText: /^6:/ }).first();
    await tab.click();
    const surface = tab.locator('xpath=ancestor::*[contains(@class,"terminal-grid-cell")]').locator('.terminal-surface:visible');
    await surface.scrollIntoViewIfNeeded();
    await page.waitForFunction(e => (e.querySelector('.xterm-rows')?.textContent?.trim().length || 0) > 20,
      await surface.elementHandle(), { timeout: 15000 });
    const read = () => surface.evaluate(e => ({ font: Number(e.dataset.fittedFontSize), renderer: e.dataset.renderer,
      width: e.clientWidth, height: e.clientHeight, losses: Number(e.dataset.contextLosses),
      screenWidth: e.querySelector('.xterm-screen').getBoundingClientRect().width }));
    const dom = await read(); assert.equal(dom.renderer, 'dom');
    assert((await surface.locator('.xterm-rows').textContent()).trim().length > 20, 'DOM baseline must contain terminal content');
    await surface.screenshot({ path: `${output}/${width}-dom.png` });
    await page.evaluate(() => window.__qaRunIdle());
    await surface.locator('.xterm-screen canvas').first().waitFor();
    await page.waitForTimeout(500);
    const gpu = await read(); assert.equal(gpu.renderer, 'webgl');
    await surface.screenshot({ path: `${output}/${width}-webgl.png` });
    await surface.evaluate(e => {
      const owned = window.__qaGL.find(item => e.contains(item.canvas));
      if (!owned) throw new Error('No real WebGL context found');
      const extension = owned.context.getExtension('WEBGL_lose_context');
      if (!extension) throw new Error('Context-loss test unsupported');
      e.dataset.qaLossStarted = String(performance.now());
      const observe = new MutationObserver(() => {
        if (e.dataset.renderer === 'dom') {
          e.dataset.qaRecoveryMs = String(performance.now() - Number(e.dataset.qaLossStarted));
          observe.disconnect();
        }
      });
      observe.observe(e, { attributes: true, attributeFilter: ['data-renderer'] });
      extension.loseContext();
    });
    await page.waitForFunction(() => [...document.querySelectorAll('.terminal-surface')].some(e => Number(e.dataset.contextLosses) > 0), { timeout: 10000 });
    await page.waitForTimeout(200);
    const fallback = await read();
    const recoveryMs = await surface.evaluate(e => Number(e.dataset.qaRecoveryMs));
    results.push({ width, health, dom, gpu, fallback, recoveryMs });
    await surface.screenshot({ path: `${output}/${width}-fallback.png` });
    assert.equal(fallback.renderer, 'dom'); assert.equal(fallback.losses, 1);
    assert(recoveryMs <= 100, `Context loss left GPU unavailable for ${recoveryMs}ms (limit 100ms)`);
    for (const state of [gpu, fallback]) {
      assert.equal(state.width, dom.width); assert.equal(state.height, dom.height);
      assert.equal(state.font, dom.font, 'Renderer transition changed visible font at unchanged geometry');
    }
    await context.close();
  }
} finally {
  await browser.close();
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
}
console.log(results);
