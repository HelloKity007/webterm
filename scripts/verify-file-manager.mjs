import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('../ui/node_modules/playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const target = new URL(process.env.WEBTERM_QA_URL || 'https://192.168.11.87:9444/');
assert.equal(target.protocol, 'https:', 'File-manager QA requires HTTPS');
assert.equal(target.port, '9444', 'This gate only permits release-test port 9444');
assert(!target.username && !target.password && !target.search && !target.hash,
  'Do not put credentials or query parameters in the QA URL');

const runID = `${Date.now()}-${randomUUID().slice(0, 8)}`;
const localName = `webterm-file-qa-${runID}`;
const renamedName = `${localName}-renamed`;
const secondName = `${localName}-second`;
const localRoot = '/tmp';
const localPaths = [`${localRoot}/${localName}`, `${localRoot}/${renamedName}`, `${localRoot}/${secondName}`];
const remoteConnectionID = process.env.WEBTERM_QA_REMOTE_CONNECTION_ID
  ? Number(process.env.WEBTERM_QA_REMOTE_CONNECTION_ID) : null;
const remoteConnectionName = process.env.WEBTERM_QA_REMOTE_CONNECTION_NAME || '';
const remoteFixturePath = `${localRoot}/${localName}-remote`;
if (remoteConnectionID !== null) assert(Number.isSafeInteger(remoteConnectionID) && remoteConnectionID > 0,
  'WEBTERM_QA_REMOTE_CONNECTION_ID must identify a dedicated positive connection ID');
if (remoteConnectionID !== null) assert(remoteConnectionName,
  'WEBTERM_QA_REMOTE_CONNECTION_NAME is required with the dedicated connection ID');
const output = resolve(root, process.env.WEBTERM_QA_OUTPUT || `runtime/file-manager-qa/${runID}`);
await mkdir(output, { recursive: true, mode: 0o700 });

const report = {
  target: target.origin,
  status: 'RUNNING',
  checks: [],
  skipped: [],
  diagnostics: { consoleErrors: [], pageErrors: [], failedResponses: [] },
  performance: {},
  screenshots: [],
};
const pass = (name, evidence) => report.checks.push({ name, status: 'PASS', evidence });
const skip = (name, reason) => report.skipped.push({ name, status: 'SKIP', reason });
const redact = (value) => String(value)
  .replace(/(token|ticket|authorization)=?[^\s&]*/gi, '$1=[redacted]')
  .slice(0, 800);

let browser;
let context;
let page;
let authenticated = false;
let cleaningUp = false;

async function localSocketAction(action, path, newPath) {
  if (!page || !authenticated) return;
  await page.evaluate(async ({ action, path, newPath }) => {
    const ticketResponse = await fetch('/api/ws-tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
      body: JSON.stringify({ endpoint: 'local-fs', conn_id: 0, terminal_id: '', client_id: '' }),
    });
    if (!ticketResponse.ok) throw new Error(`cleanup ticket failed: ${ticketResponse.status}`);
    const { ticket } = await ticketResponse.json();
    const url = new URL(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/local-fs`);
    url.searchParams.set('ticket', ticket);
    await new Promise((resolvePromise, rejectPromise) => {
      const socket = new WebSocket(url);
      const timer = setTimeout(() => { socket.close(); rejectPromise(new Error('cleanup timed out')); }, 5000);
      socket.onopen = () => socket.send(JSON.stringify({ action, path, ...(newPath ? { new_path: newPath } : {}) }));
      socket.onerror = () => { clearTimeout(timer); rejectPromise(new Error('cleanup socket failed')); };
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'delete_done' || (message.type === 'error' && /no such file|not exist|not found/i.test(message.error || ''))) {
          clearTimeout(timer); socket.close(); resolvePromise();
        } else if (message.type === 'error') {
          clearTimeout(timer); socket.close(); rejectPromise(new Error(message.error));
        }
      };
    });
  }, { action, path, newPath });
}

async function cleanupLocalFixtures() {
  for (const path of localPaths) {
    assert(path.startsWith('/tmp/webterm-file-qa-'), `unsafe cleanup path: ${path}`);
    await localSocketAction('delete', path).catch((error) => {
      report.diagnostics.cleanup ||= [];
      report.diagnostics.cleanup.push({ path, error: redact(error.message) });
    });
  }
}

async function remoteSocketAction(action, path) {
  if (!page || !authenticated || !remoteConnectionID) return;
  assert(path.startsWith('/tmp/webterm-file-qa-'), `unsafe remote cleanup path: ${path}`);
  await page.evaluate(async ({ action, path, connectionID }) => {
    const ticketResponse = await fetch('/api/ws-tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
      body: JSON.stringify({ endpoint: 'sftp', conn_id: connectionID, terminal_id: '', client_id: '' }),
    });
    if (!ticketResponse.ok) throw new Error(`remote cleanup ticket failed: ${ticketResponse.status}`);
    const { ticket } = await ticketResponse.json();
    const url = new URL(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/sftp/${connectionID}`);
    url.searchParams.set('ticket', ticket);
    await new Promise((resolvePromise, rejectPromise) => {
      const socket = new WebSocket(url);
      const timer = setTimeout(() => { socket.close(); rejectPromise(new Error('remote cleanup timed out')); }, 10000);
      socket.onopen = () => socket.send(JSON.stringify({ action, path }));
      socket.onerror = () => { clearTimeout(timer); rejectPromise(new Error('remote cleanup socket failed')); };
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'delete_done' || (message.type === 'error' && /no such file|not exist/i.test(message.error || ''))) {
          clearTimeout(timer); socket.close(); resolvePromise();
        } else if (message.type === 'error') {
          clearTimeout(timer); socket.close(); rejectPromise(new Error(message.error));
        }
      };
    });
  }, { action, path, connectionID: remoteConnectionID });
}

function endpoint(index) {
  return page.locator('.sftp-endpoint').nth(index);
}

async function navigatePane(pane, path) {
  const input = pane.locator('.sftp-path');
  await input.waitFor({ state: 'visible' });
  await input.fill(path);
  const started = performance.now();
  await input.press('Enter');
  await pane.locator('.sftp-file-list[aria-busy="false"]').waitFor({ timeout: 15000 });
  await page.waitForFunction(({ index, wanted }) => {
    const panes = document.querySelectorAll('.sftp-endpoint');
    return panes[index]?.querySelector('.sftp-path')?.value === wanted;
  }, { index: await pane.evaluate((node) => [...node.parentElement.children].filter((child) => child.classList.contains('sftp-endpoint')).indexOf(node)), wanted: path });
  return Math.round((performance.now() - started) * 10) / 10;
}

async function createDirectory(pane, name) {
  await pane.getByRole('button', { name: /新文件夹|New Folder/ }).click();
  const editor = pane.getByRole('textbox', { name: /文件夹名|Folder Name/ });
  await editor.fill(name);
  await editor.press('Enter');
  await pane.locator('[data-file-row]', { hasText: name }).waitFor({ timeout: 10000 });
}

async function namedRow(pane, name) {
  // `has` locators are evaluated relative to every candidate row. Reusing a
  // locator rooted at `pane` makes the inner selector look for the pane inside
  // each row, so an existing virtualized row can never match.
  const row = pane.locator('[data-file-row]').filter({
    has: page.locator('.sftp-file-name', { hasText: name }),
  }).first();
  try {
    await row.waitFor({ timeout: 10000 });
  } catch (error) {
    const visibleRows = await pane.locator('[data-file-row]').evaluateAll((rows) =>
      rows.map((entry) => entry.textContent?.trim()).filter(Boolean).slice(0, 20));
    throw new Error(`${error.message}\nVisible rows while looking for ${name}: ${JSON.stringify(visibleRows)}`);
  }
  return row;
}

try {
  browser = await chromium.launch({
    headless: process.env.WEBTERM_QA_HEADED !== '1',
    executablePath: process.env.WEBTERM_QA_CHROME || '/usr/bin/google-chrome',
    args: ['--no-sandbox'],
  });
  context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true, acceptDownloads: true });
  page = await context.newPage();
  page.on('pageerror', (error) => report.diagnostics.pageErrors.push(redact(error.message)));
  page.on('console', (message) => {
    if (message.type() === 'error') report.diagnostics.consoleErrors.push(redact(message.text()));
  });
  page.on('response', (response) => {
    if (cleaningUp) return;
    const url = new URL(response.url());
    if (url.origin === target.origin && response.status() >= 400 && !url.pathname.endsWith('/api/auth/test-session')) {
      report.diagnostics.failedResponses.push({ status: response.status(), method: response.request().method(), path: url.pathname });
    }
  });

  const health = await context.request.get(new URL('/api/health', target).href);
  assert.equal(health.status(), 200, 'release-test health endpoint is unavailable');
  report.health = await health.json();
  assert.equal(report.health.environment, 'release-test', 'Refusing a non-release-test backend');

  const explicitToken = process.env.WEBTERM_QA_TOKEN;
  if (explicitToken) {
    await page.addInitScript((token) => localStorage.setItem('token', token), explicitToken);
  }
  await page.goto(target.origin, { waitUntil: 'networkidle' });
  authenticated = await page.evaluate(() => !!localStorage.getItem('token'));
  if (!authenticated || await page.locator('.activity-rail').count() === 0) {
    report.status = 'SKIP';
    report.reason = 'No release-test session. Configure the test-session login or WEBTERM_QA_TOKEN; credentials are never accepted in the URL.';
  } else {
    const firstPaint = await page.evaluate(() => {
      const navigation = performance.getEntriesByType('navigation')[0];
      const paints = performance.getEntriesByType('paint');
      return {
        domContentLoadedMs: navigation ? Math.round(navigation.domContentLoadedEventEnd) : null,
        firstContentfulPaintMs: Math.round(paints.find((entry) => entry.name === 'first-contentful-paint')?.startTime || 0),
      };
    });
    report.performance.pageLoad = firstPaint;

    assert.equal(await page.locator('.activity-files').count(), 1, 'expected exactly one Files activity entry');
    assert.equal(await page.locator('.ssh-files-toggle').count(), 0, 'legacy SSH files toggle is still present');
    pass('Activity rail has one Files entry and no legacy SSH files toggle', { filesEntries: 1, legacyToggles: 0 });

    await page.locator('.activity-files').click();
    const workspace = page.locator('[data-testid="file-workspace"]');
    await workspace.waitFor({ state: 'visible' });
    assert.equal(await workspace.locator('.sftp-endpoint').count(), 2, 'unified workspace is not dual-pane');
    assert.equal(await workspace.locator('.sftp-divider[role="separator"]').count(), 1);
    pass('Files entry opens the unified dual-pane workspace', { panes: 2, dividers: 1 });

    const localPane = endpoint(1);
    const listMs = await navigatePane(localPane, localRoot);
    report.performance.localTmpListMs = listMs;
    assert(listMs < Number(process.env.WEBTERM_QA_LIST_BUDGET_MS || 5000), `local /tmp listing took ${listMs}ms`);
    pass('Local directory loads within the basic interaction budget', { path: localRoot, durationMs: listMs });

    await createDirectory(localPane, localName);
    let firstRow = await namedRow(localPane, localName);
    await firstRow.click();
    assert.equal(await firstRow.getAttribute('aria-selected'), 'true');
    await firstRow.press('F2');
    const renameInput = localPane.getByRole('textbox', { name: /文件夹名|Folder Name/ });
    await renameInput.fill(renamedName);
    await renameInput.press('Enter');
    firstRow = await namedRow(localPane, renamedName);
    pass('Create, select and keyboard F2 rename work in the isolated fixture path', { from: localName, to: renamedName });

    await createDirectory(localPane, secondName);
    const secondRow = await namedRow(localPane, secondName);
    await firstRow.click();
    await secondRow.click({ modifiers: ['Control'] });
    assert.equal(await localPane.locator('[data-file-row][aria-selected="true"]').count(), 2, 'Ctrl multi-select did not select two rows');
    await secondRow.press('ArrowUp');
    assert.equal(await localPane.locator('[data-file-row][aria-selected="true"]').count(), 1, 'Arrow key did not move to one focused selection');
    pass('Ctrl multi-select and keyboard navigation update selection predictably', { multiSelected: 2, afterArrow: 1 });

    const filter = localPane.getByRole('textbox', { name: /筛选文件|Filter files/ });
    await filter.fill(renamedName);
    assert.equal(await localPane.locator('[data-file-row]').filter({ hasText: renamedName }).count(), 1);
    assert.equal(await localPane.locator('[data-file-row]').filter({ hasText: secondName }).count(), 0);
    await localPane.getByRole('button', { name: /清除筛选|Clear filter/ }).click();
    pass('File-name filter narrows rows and its explicit clear action restores the list', { query: renamedName });

    page.once('dialog', (dialog) => dialog.accept());
    firstRow = await namedRow(localPane, renamedName);
    await firstRow.click();
    await firstRow.press('Delete');
    await firstRow.waitFor({ state: 'detached', timeout: 10000 });
    page.once('dialog', (dialog) => dialog.accept());
    const cleanupRow = await namedRow(localPane, secondName);
    await cleanupRow.click();
    await cleanupRow.press('Delete');
    await cleanupRow.waitFor({ state: 'detached', timeout: 10000 });
    pass('Keyboard Delete removes only named QA fixtures after confirmation', { root: localRoot });

    const remotePane = endpoint(0);
    if (remoteConnectionID) {
      const connectionSelect = remotePane.locator('.sftp-endpoint-head > div').last();
      await connectionSelect.click();
      const connectionOption = page.getByText(remoteConnectionName, { exact: true }).last();
      assert(await connectionOption.count() > 0,
        `dedicated remote connection ${remoteConnectionName} (${remoteConnectionID}) is not available to the QA account`);
      await connectionOption.click();
      await navigatePane(remotePane, localRoot);
      await createDirectory(remotePane, `${localName}-remote`);
      await namedRow(remotePane, `${localName}-remote`).then((row) => row.dblclick());
      await remotePane.locator('.sftp-path').waitFor();
      await page.waitForFunction((wanted) => document.querySelector('.sftp-endpoint .sftp-path')?.value === wanted,
        remoteFixturePath);
      const uploadInput = remotePane.locator('input[type="file"]');
      const payload = `webterm file manager QA ${runID}\n`;
      await uploadInput.setInputFiles({ name: 'roundtrip.txt', mimeType: 'text/plain', buffer: Buffer.from(payload) });
      await remotePane.getByRole('button', { name: /刷新|Refresh/ }).click();
      const uploaded = await namedRow(remotePane, 'roundtrip.txt');
      const downloadPromise = page.waitForEvent('download');
      await uploaded.click({ button: 'right' });
      await page.getByText(/^(下载|Download)$/).click();
      const download = await downloadPromise;
      const downloadPath = await download.path();
      assert(downloadPath, 'browser did not persist the remote download');
      const downloaded = await import('node:fs/promises').then(({ readFile }) => readFile(downloadPath, 'utf8'));
      assert.equal(downloaded, payload, 'uploaded/downloaded bytes differ');
      await navigatePane(remotePane, localRoot);
      page.once('dialog', (dialog) => dialog.accept());
      const remoteFixtureRow = await namedRow(remotePane, `${localName}-remote`);
      await remoteFixtureRow.click();
      await remoteFixtureRow.press('Delete');
      await remoteFixtureRow.waitFor({ state: 'detached', timeout: 10000 });
      pass('Dedicated remote fixture supports upload/download byte round-trip and cleanup', {
        connectionID: remoteConnectionID, path: remoteFixturePath, bytes: Buffer.byteLength(payload),
      });
    } else if (await remotePane.locator('.sftp-disconnected').count() > 0 || await remotePane.locator('.sftp-path').count() === 0) {
      skip('Remote SFTP and upload/download', 'No connected remote SFTP endpoint is available; local file behavior was exercised without touching user connections.');
    } else {
      skip('Remote upload/download', 'A connection exists, but writes are intentionally skipped without WEBTERM_QA_REMOTE_CONNECTION_ID naming a dedicated disposable connection.');
    }

    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
      await page.waitForTimeout(250);
      const visiblePanes = await workspace.locator('.sftp-endpoint').count();
      assert.equal(visiblePanes, 2);
      const filename = `files-${width}.png`;
      await page.screenshot({ path: resolve(output, filename), fullPage: true });
      report.screenshots.push(filename);
    }
    pass('Responsive evidence captured at 375, 768 and 1440 CSS pixels', report.screenshots);

    const domEvidence = await page.evaluate(() => ({
      endpoints: document.querySelectorAll('.sftp-endpoint').length,
      renderedRows: [...document.querySelectorAll('.sftp-file-list')].map((list) => list.querySelectorAll('[data-file-row]').length),
      totalDomNodes: document.querySelectorAll('*').length,
    }));
    report.dom = domEvidence;
    pass('DOM row counts recorded for virtual-list/performance review', domEvidence);

    assert.deepEqual(report.diagnostics.pageErrors, [], 'browser page errors were emitted');
    assert.deepEqual(report.diagnostics.consoleErrors, [], 'browser console errors were emitted');
    assert.deepEqual(report.diagnostics.failedResponses, [], 'same-origin HTTP failures were observed');
    pass('Browser console, pageerror and same-origin HTTP diagnostics are clean', report.diagnostics);
    report.status = 'PASS';
  }
} catch (error) {
  report.status = 'FAIL';
  report.failure = redact(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  // Teardown requests are tracked separately. A harmless "already absent"
  // response must not retroactively fail the browser/network acceptance gate.
  cleaningUp = true;
  await cleanupLocalFixtures();
  await remoteSocketAction('delete', remoteFixturePath).catch((error) => {
    report.diagnostics.cleanup ||= [];
    report.diagnostics.cleanup.push({ path: remoteFixturePath, error: redact(error.message) });
  });
  if (context) await context.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  await writeFile(resolve(output, 'result.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
  console.log(`Artifacts: ${output}`);
}
