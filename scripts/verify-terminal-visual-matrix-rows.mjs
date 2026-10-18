// The three matrix rows that need disposable state: continuous input, drag
// reorder/restore, and workspace close. Everything destructive happens against
// a disposable layout this script creates and removes; the operator's tab order
// is snapshotted first and restored through the layout API afterwards.
//
//   WEBTERM_BASE_URL=https://192.168.11.87:9444 \
//   WEBTERM_QA_OUTPUT=runtime/terminal-visual-matrix/<stamp> \
//   node scripts/verify-terminal-visual-matrix-rows.mjs
import playwright from '../ui/node_modules/@playwright/test/index.js';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = playwright;
const origin = (process.env.WEBTERM_BASE_URL || 'https://192.168.11.87:9444').replace(/\/$/, '');
const outDir = process.env.WEBTERM_QA_OUTPUT || 'runtime/terminal-visual-matrix/latest';
await mkdir(outDir, { recursive: true });
const rows = [];
const record = (row, status, detail) => {
  rows.push({ row, status, ...detail });
  console.log(`${status.padEnd(8)} ${row}${detail?.note ? ` :: ${detail.note}` : ''}`);
};

const browser = await chromium.launch({ executablePath: process.env.WEBTERM_QA_CHROME || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1600, height: 900 } });
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

const api = (path, method = 'GET', body) => page.evaluate(async ({ path, method, body }) => {
  const token = localStorage.getItem('token') || '';
  const response = await fetch(path, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, text: await response.text() };
}, { path, method, body });

const snapshotOrder = async () => {
  const result = await api('/api/layout');
  const layout = JSON.parse(result.text).layout;
  const order = {};
  for (const workspace of layout.workspaceTabs) {
    for (const [paneId, pane] of Object.entries(workspace.layout?.panes || {})) {
      const tabs = pane.tabs || [];
      if (tabs.length > 1) order[paneId] = tabs.map((t) => t.id);
    }
  }
  return order;
};

const restoreOrder = async (order) => {
  const current = await api('/api/layout');
  const payload = JSON.parse(current.text);
  const layout = payload.layout;
  let changed = false;
  for (const workspace of layout.workspaceTabs) {
    for (const [paneId, pane] of Object.entries(workspace.layout?.panes || {})) {
      const wanted = order[paneId];
      if (!wanted) continue;
      const tabs = pane.tabs || [];
      const byId = new Map(tabs.map((t) => [t.id, t]));
      if (wanted.every((id) => byId.has(id)) && tabs.map((t) => t.id).join() !== wanted.join()) {
        pane.tabs = wanted.map((id) => byId.get(id));
        changed = true;
      }
    }
  }
  if (changed) {
    let saved = await api('/api/layout', 'PUT', {
      schema_version: payload.schema_version, revision: payload.revision, layout,
    });
    if (saved.status >= 300) {
      // A concurrent save invalidated the revision; re-read and retry once.
      const fresh = JSON.parse((await api('/api/layout')).text);
      const freshLayout = fresh.layout;
      for (const workspace of freshLayout.workspaceTabs) {
        for (const [paneId, pane] of Object.entries(workspace.layout?.panes || {})) {
          const wanted = order[paneId];
          if (!wanted) continue;
          const byId = new Map((pane.tabs || []).map((t) => [t.id, t]));
          if (wanted.every((id) => byId.has(id))) pane.tabs = wanted.map((id) => byId.get(id));
        }
      }
      saved = await api('/api/layout', 'PUT', {
        schema_version: fresh.schema_version, revision: fresh.revision, layout: freshLayout,
      });
    }
    if (saved.status >= 300) throw new Error(`layout restore rejected: ${saved.status} ${saved.text}`);
  }
  const after = await snapshotOrder();
  const restored = Object.keys(order).every((paneId) => (after[paneId] || []).join() === order[paneId].join());
  return { changed, restored, after };
};

try {
  await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll('.terminal-surface').length > 0, null, { timeout: 60000 });
  await page.waitForTimeout(2500);
  const health = await page.evaluate(async () => (await fetch('/api/health')).json());
  console.log(`candidate=${health.version} environment=${health.environment}`);
  const originalOrder = await snapshotOrder();

  // ---------- Continuous input ----------
  let inputStatus = 'FAIL';
  let inputNote = '';
  try {
    const connection = await api('/api/quick-connect/local', 'POST', {});
    const connId = JSON.parse(connection.text).connection.id;
    const created = await api(`/api/terminal-sessions/${connId}`, 'POST', {});
    const terminalId = JSON.parse(created.text).terminal_id;
    const current = await api('/api/layout');
    const payload = JSON.parse(current.text);
    const layout = payload.layout;
    // Put the disposable terminal into the first pane of the active workspace.
    const workspace = layout.workspaceTabs.find((w) => w.index === 2) || layout.workspaceTabs[0];
    const paneEntry = Object.entries(workspace.layout.panes).find(([, pane]) => (pane.tabs || []).length > 0);
    const paneId = paneEntry?.[0] || Object.keys(workspace.layout.panes)[0];
    const beforeCount = (workspace.layout.panes[paneId].tabs || []).length;
    workspace.layout.panes[paneId].tabs.push({
      id: terminalId, type: 'ssh', title: 'matrix-input', connId, labelNumber: 99,
    });
    workspace.layout.panes[paneId].activeTabId = terminalId;
    await api('/api/layout', 'PUT', {
      schema_version: payload.schema_version, revision: payload.revision, layout,
    });
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => document.querySelectorAll('.terminal-surface').length > 0, null, { timeout: 60000 });
    await page.waitForTimeout(2500);
    // The active workspace after a reload may not be the one we wrote to.
    for (const name of ['2: 730', '1: 3572']) {
      const tab = page.getByRole('tab', { name }).first();
      if (!await tab.count()) {
        await page.locator('.workspace-tabs-toggle').first().click().catch(() => {});
        await page.waitForTimeout(300);
      }
      await tab.click().catch(() => {});
      await page.waitForTimeout(900);
      const found = await page.evaluate(() => Array.from(document.querySelectorAll('.terminal-tabbar [data-terminal-tab]'))
        .some((node) => (node.textContent || '').includes('matrix-input')));
      if (found) break;
    }
    await page.waitForTimeout(800);

    const paneIndex = await page.evaluate(() => {
      const panes = Array.from(document.querySelectorAll('.terminal-pane'));
      return panes.findIndex((pane) => Array.from(pane.querySelectorAll('.terminal-tabbar [data-terminal-tab]'))
        .some((tab) => (tab.textContent || '').includes('matrix-input')));
    });
    if (paneIndex < 0) throw new Error('disposable tab not visible after workspace switch');
    const pane = page.locator('.terminal-pane').nth(paneIndex);
    await pane.locator('.terminal-tabbar [data-terminal-tab]').filter({ hasText: /matrix-input/ }).first().click();
    await page.waitForTimeout(800);
    await pane.evaluate((node) => Array.from(node.querySelectorAll('.terminal-surface'))
      .find((n) => n.offsetParent !== null)?.querySelector('.xterm-helper-textarea')?.focus());

    // Hold a key across wrap boundaries and sample intermediate frames.
    const frames = [];
    await page.keyboard.down('a');
    for (let i = 0; i < 6; i += 1) {
      await page.waitForTimeout(250);
      frames.push(await page.evaluate(() => {
        const surfaces = Array.from(document.querySelectorAll('.terminal-surface')).filter((n) => n.offsetParent !== null);
        const surface = surfaces[0];
        return {
          cursorRow: surface?.dataset.cursorRow,
          sharedCols: surface?.dataset.sharedCols,
          scrollTop: surface ? Math.round(surface.scrollTop) : null,
          outputQueueBytes: surface?.dataset.outputQueueBytes,
        };
      }));
    }
    await page.keyboard.up('a');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${outDir}/continuous-input.png` });
    const moved = new Set(frames.map((f) => f.cursorRow)).size;
    const outputGrew = new Set(frames.map((f) => f.outputQueueBytes)).size > 1
      || new Set(frames.map((f) => f.scrollTop)).size > 1;
    const text = await pane.evaluate((node) => {
      const surface = Array.from(node.querySelectorAll('.terminal-surface')).find((n) => n.offsetParent !== null);
      return surface?.dataset.lastOutputBytes || '0';
    });
    inputStatus = moved >= 2 || outputGrew ? 'PASS' : 'FAIL';
    inputNote = `held 'a' 1.5s, ${frames.length} intermediate frames, ${moved} distinct cursor rows, outputBytes=${text}, states=${JSON.stringify(frames.map((f) => f.cursorRow))}`;
    // Remove the disposable tab again.
    const cleanup = await api('/api/layout');
    const cleanupPayload = JSON.parse(cleanup.text);
    for (const ws of cleanupPayload.layout.workspaceTabs) {
      for (const pane of Object.values(ws.layout?.panes || {})) {
        pane.tabs = (pane.tabs || []).filter((t) => t.id !== terminalId);
        if (pane.activeTabId === terminalId) pane.activeTabId = pane.tabs[0]?.id || null;
      }
    }
    await api('/api/layout', 'PUT', {
      schema_version: cleanupPayload.schema_version, revision: cleanupPayload.revision, layout: cleanupPayload.layout,
    });
    void beforeCount;
  } catch (error) {
    inputStatus = 'FAIL';
    inputNote = error.message;
  }
  record('continuous input', inputStatus, { note: inputNote });

  // ---------- Drag reorder + restore ----------
  let dragStatus = 'PASS';
  let dragNote = '';
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => document.querySelectorAll('.terminal-surface').length > 0, null, { timeout: 60000 });
    await page.waitForTimeout(2500);
    await page.locator('.workspace-tabs-toggle').first().click().catch(() => {});
    await page.waitForTimeout(300);
    const tab2 = page.getByRole('tab', { name: '2: 730' }).first();
    if (await tab2.count()) { await tab2.click(); await page.waitForTimeout(1200); }
    const paneIndex = await page.evaluate(() => {
      const panes = Array.from(document.querySelectorAll('.terminal-pane'));
      return panes.findIndex((pane) => pane.querySelectorAll('.terminal-tabbar [data-terminal-tab]').length >= 3);
    });
    if (paneIndex < 0) throw new Error('no pane with three or more tabs to reorder');
    const pane = page.locator('.terminal-pane').nth(paneIndex);
    const orderOf = () => pane.evaluate((node) => Array.from(node.querySelectorAll('.terminal-tabbar [data-terminal-tab]'))
      .map((n) => (n.getAttribute('data-tab-id') || '')));
    const before = await orderOf();
    const cycles = [];
    for (let i = 0; i < 5; i += 1) {
      const from = i % 2;
      const to = from + 1;
      const sourceId = before[from];
      const targetId = before[to];
      const targetBox = await pane.locator(`[data-tab-id="${targetId}"]`).boundingBox();
      // Tabs are HTML5-draggable: only a real drag-and-drop fires dragstart.
      // onDrop inserts AFTER the target when the pointer lands past its middle,
      // so the drop must land on the right half to actually reorder.
      await page.dragAndDrop(`[data-tab-id="${sourceId}"]`, `[data-tab-id="${targetId}"]`, {
        targetPosition: { x: Math.round(targetBox.width - 6), y: Math.round(targetBox.height / 2) },
      });
      await page.waitForTimeout(500);
      const after = await orderOf();
      cycles.push({ moved: after.join() !== before.join(), after });
    }
    await page.screenshot({ path: `${outDir}/drag-reorder.png` });
    const movedAtLeastOnce = cycles.some((c) => c.moved);
    const restore = await restoreOrder(originalOrder);
    dragNote = `5 cycles, reordered in ${cycles.filter((c) => c.moved).length}/5; order restored=${restore.restored}`;
    if (!movedAtLeastOnce) dragStatus = 'FAIL';
    else if (!restore.restored) dragStatus = 'FAIL';
  } catch (error) {
    dragStatus = 'FAIL';
    dragNote = error.message;
    await restoreOrder(originalOrder);
  }
  record('drag reorder + restore', dragStatus, { note: dragNote });

  // ---------- Workspace close ----------
  record('workspace close', 'NOT RUN', {
    note: 'needs a disposable account: release-test auto-login binds the page to admin; run with a blocked /api/auth/test-session and a fresh user to exercise close/cancel/confirm',
  });
} finally {
  await writeFile(`${outDir}/rows-summary.json`, JSON.stringify({ rows, errors }, null, 2));
  await browser.close();
}
const failed = rows.filter((r) => r.status === 'FAIL');
console.log(`\n=== rows: ${rows.filter((r) => r.status === 'PASS').length} PASS, ${failed.length} FAIL, ${rows.filter((r) => r.status === 'NOT RUN').length} NOT RUN ===`);
for (const r of rows) if (r.status !== 'PASS') console.log(`${r.status} ${r.row}: ${r.note || ''}`);
process.exitCode = failed.length ? 1 : 0;
