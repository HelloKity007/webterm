import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = createRequire(import.meta.url)('../ui/node_modules/playwright');
const origin = process.env.WEBTERM_QA_URL || 'https://192.168.11.87:9444';
assert.equal(new URL(origin).port, '9444', 'This gate only permits release-test 9444');
const output = process.env.WEBTERM_QA_OUTPUT || `runtime/performance-${Date.now()}`;
const outputSeconds = Number(process.env.WEBTERM_PERF_OUTPUT_SECONDS || 60);
const soakSeconds = Number(process.env.WEBTERM_PERF_SOAK_SECONDS || 1800);
assert(Number.isFinite(outputSeconds) && outputSeconds >= 10 && Number.isFinite(soakSeconds) && soakSeconds >= outputSeconds);
await mkdir(output, { recursive: true, mode: 0o700 });
const browser = await chromium.launch({ executablePath: process.env.WEBTERM_QA_CHROME || '/usr/bin/google-chrome', headless: false,
  args: ['--no-sandbox', '--enable-precise-memory-info'] });
const admin = await browser.newContext({ ignoreHTTPSErrors: true });
const report = { status: 'RUNNING', checks: [], outputSeconds, soakSeconds };
let adminToken, userToken, fixtureUser, connectionID, context;
const terminalIDs = Array.from({ length: 8 }, () => `qa-perf-${randomUUID()}`);

const api = async (method, path, data, token = userToken) => {
  const response = await admin.request.fetch(origin + path, { method, data, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const text = await response.text();
  assert(response.ok(), `${method} ${path.split('?')[0]} returned ${response.status()}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
};
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)];
const rows = (ids) => ({ type: 'split', direction: 'horizontal', ratios: ids.map(() => 0.25), children: ids.map(id => ({ type: 'leaf', id })) });

try {
  const health = await api('GET', '/api/health', undefined, undefined);
  assert.equal(health.environment, 'release-test');
  report.candidate = health.version;
  const adminPage = await admin.newPage();
  await adminPage.goto(origin, { waitUntil: 'networkidle' });
  await adminPage.waitForFunction(() => !!localStorage.getItem('token'));
  adminToken = await adminPage.evaluate(() => localStorage.getItem('token'));
  const username = `qa-perf-${randomUUID()}`;
  const password = randomUUID();
  fixtureUser = (await api('POST', '/api/users', { username, password, role: 'admin' }, adminToken)).id;
  const login = await api('POST', '/api/auth/login', { username, password }, undefined);
  userToken = login.token;
  connectionID = (await api('POST', '/api/quick-connect/local', {}, userToken)).connection.id;
  const saved = await api('GET', '/api/layout', undefined, userToken);
  const paneIDs = terminalIDs.map((_, index) => `qa-perf-pane-${index + 1}`);
  const panes = Object.fromEntries(paneIDs.map((paneID, index) => [paneID, {
    tabs: [{ id: terminalIDs[index], type: 'ssh', title: `Perf ${index + 1}`, connId: connectionID, labelNumber: index + 1 }], activeTabId: terminalIDs[index],
  }]));
  const layout = { workspaceTabs: [{ id: 'qa-perf-workspace', index: 1, name: 'Performance QA', layout: {
    tree: { type: 'split', direction: 'vertical', ratios: [0.5, 0.5], children: [rows(paneIDs.slice(0, 4)), rows(paneIDs.slice(4))] },
    panes, focusedPaneId: paneIDs[0],
  } }] };
  await api('PUT', '/api/layout', { schema_version: 2, revision: saved.revision, layout }, userToken);

  context = await browser.newContext({ viewport: { width: 3440, height: 1440 }, ignoreHTTPSErrors: true });
  await context.route('**/api/auth/test-session', route => route.fulfill({ status: 404, body: '' }));
  await context.addInitScript(({ token, user }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('webterm-user', JSON.stringify(user));
  }, { token: userToken, user: { id: fixtureUser, username, role: 'admin' } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelectorAll('.xterm').length === 8);
  await page.waitForTimeout(3000);
  const surfaces = page.locator('.terminal-grid-cell:visible .terminal-surface');
  assert.equal(await surfaces.count(), 8);

  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const memorySamples = [];
  const sampleMemory = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    const values = await cdp.send('Performance.getMetrics');
    const metric = Object.fromEntries(values.metrics.map(item => [item.name, item.value]));
    memorySamples.push({ elapsedSeconds: Math.round((Date.now() - soakStart) / 1000), jsHeapUsedBytes: metric.JSHeapUsedSize, nodes: metric.Nodes, documents: metric.Documents });
  };
  await page.evaluate(() => {
    window.__webtermFrameIntervals = [];
    window.__webtermFrameRunning = true;
    let previous;
    const tick = (now) => {
      if (!window.__webtermFrameRunning) return;
      if (previous !== undefined) window.__webtermFrameIntervals.push(now - previous);
      previous = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const soakStart = Date.now();
  await sampleMemory();
  const lineCount = Math.ceil(outputSeconds * 64);
  const command = `python3 -c 'import sys,time;[(sys.stdout.write(f"{i:06d} "+"X"*1016+"\\n"),sys.stdout.flush(),time.sleep(0.015625)) for i in range(${lineCount})]'`;
  for (let index = 0; index < 8; index++) {
    await surfaces.nth(index).click({ position: { x: 80, y: 60 } });
    await page.keyboard.insertText(command);
    await page.keyboard.press('Enter');
  }
  await page.waitForTimeout(outputSeconds * 1000 + 3000);
  const intervals = await page.evaluate(() => { window.__webtermFrameRunning = false; return window.__webtermFrameIntervals; });
  report.renderer = await page.evaluate(() => window.__webtermRendererMetrics);
  report.environment = await page.evaluate(() => ({ userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency,
    viewport: [innerWidth, innerHeight], devicePixelRatio, renderer: document.querySelector('.terminal-surface')?.dataset.renderer }));
  const frameP95 = percentile(intervals, 0.95);
  report.frames = { samples: intervals.length, p50Ms: percentile(intervals, 0.5), p95Ms: frameP95, maxMs: Math.max(...intervals) };
  assert(frameP95 <= 22.2, `p95 frame interval ${frameP95.toFixed(2)}ms exceeds 22.2ms`);
  assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join(' | ')}`);
  report.checks.push('8 panes sustained 64 KiB/s each for 60 seconds with p95 frame interval <= 22.2ms');

  const echoLatencies = [];
  const firstSurface = surfaces.first();
  for (let index = 0; index < 100; index++) {
    const marker = `ECHO_${String(index).padStart(3, '0')}_${randomUUID().slice(0, 8)}`;
    await firstSurface.click({ position: { x: 80, y: 60 } });
    const previousBatch = Number(await firstSurface.getAttribute('data-output-batches') || 0);
    const started = performance.now();
    await page.keyboard.insertText(`printf '${marker}\\n'`);
    await page.keyboard.press('Enter');
    await page.waitForFunction(previous => Number(document.querySelector('.terminal-grid-cell:first-child .terminal-surface')?.dataset.outputBatches || 0) > previous, previousBatch, { timeout: 3000 });
    echoLatencies.push(performance.now() - started);
  }
  report.echo = { samples: echoLatencies.length, p50Ms: percentile(echoLatencies, 0.5), p95Ms: percentile(echoLatencies, 0.95), maxMs: Math.max(...echoLatencies) };
  assert(report.echo.p95Ms <= 100, `input echo p95 ${report.echo.p95Ms.toFixed(2)}ms exceeds 100ms`);
  report.checks.push('100 numbered input echoes complete with p95 <= 100ms');

  while ((Date.now() - soakStart) / 1000 < soakSeconds) {
    const remaining = soakSeconds - (Date.now() - soakStart) / 1000;
    await page.waitForTimeout(Math.min(60000, Math.max(1000, remaining * 1000)));
    await sampleMemory();
    if (memorySamples.length % 5 === 0) console.log(`performance soak ${memorySamples.at(-1).elapsedSeconds}s/${soakSeconds}s`);
  }
  report.memorySamples = memorySamples;
  if (soakSeconds >= 1800) {
    const first = memorySamples.filter(sample => sample.elapsedSeconds <= 600).map(sample => sample.jsHeapUsedBytes);
    const last = memorySamples.filter(sample => sample.elapsedSeconds >= soakSeconds - 600).map(sample => sample.jsHeapUsedBytes);
    const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;
    report.memory = { first10MinuteAverage: average(first), last10MinuteAverage: average(last) };
    report.memory.growthRatio = report.memory.last10MinuteAverage / report.memory.first10MinuteAverage - 1;
    assert(report.memory.growthRatio <= 0.1, `browser heap grew ${(report.memory.growthRatio * 100).toFixed(1)}%`);
    report.checks.push('30-minute steady state has <= 10% last/first ten-minute heap growth');
  } else {
    report.checks.push('short performance rehearsal completed; 30-minute memory assertion not claimed');
  }
  assert(report.renderer && report.renderer.webglActive + report.renderer.domActive === 8);
  await page.screenshot({ path: `${output}/performance-final.png` });
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL';
  report.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  if (context) await context.close().catch(() => {});
  if (connectionID && userToken) {
    for (let index = 0; index < terminalIDs.length; index++) {
      await api('DELETE', `/api/terminal-sessions/${connectionID}?terminal_id=${terminalIDs[index]}&workspace_index=1&panel_number=${index + 1}&terminate=1`, undefined, userToken).catch(() => {});
    }
  }
  if (fixtureUser && adminToken) await api('DELETE', `/api/users/${fixtureUser}`, undefined, adminToken).catch(() => {});
  await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2), { mode: 0o600 });
  await browser.close();
  console.log(JSON.stringify(report));
}
