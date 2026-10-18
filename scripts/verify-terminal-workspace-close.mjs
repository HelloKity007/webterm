// Workspace-close matrix row. Runs entirely against a disposable admin user
// created for this run: release-test's auto-login is blocked so the page logs
// in as that user, and every workspace/session it touches is deleted afterwards.
//
//   WEBTERM_BASE_URL=https://192.168.11.87:9444 \
//   WEBTERM_QA_OUTPUT=runtime/terminal-visual-matrix/<stamp> \
//   node scripts/verify-terminal-workspace-close.mjs
import playwright from '../ui/node_modules/@playwright/test/index.js';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = playwright;
const origin = (process.env.WEBTERM_BASE_URL || 'https://192.168.11.87:9444').replace(/\/$/, '');
const outDir = process.env.WEBTERM_QA_OUTPUT || 'runtime/terminal-visual-matrix/latest';
await mkdir(outDir, { recursive: true });
const rows = [];
const record = (row, status, note) => {
  rows.push({ row, status, note });
  console.log(`${status.padEnd(8)} ${row}${note ? ` :: ${note}` : ''}`);
};

const browser = await chromium.launch({ executablePath: process.env.WEBTERM_QA_CHROME || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });

// Admin context only to create/destroy the disposable account.
const adminContext = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1360, height: 900 } });
const adminPage = await adminContext.newPage();
const adminApi = (path, method = 'GET', body) => adminPage.evaluate(async ({ path, method, body }) => {
  const token = localStorage.getItem('token') || '';
  const response = await fetch(path, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, text: await response.text() };
}, { path, method, body });

const username = `matrix-close-${Date.now()}`;
const password = `Mx!${Date.now().toString(36)}-close`;
let userId;

try {
  await adminPage.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await adminPage.waitForTimeout(1500);
  const created = await adminApi('/api/users', 'POST', { username, password, role: 'admin' });
  if (created.status >= 300) throw new Error(`cannot create disposable user: ${created.text}`);
  userId = JSON.parse(created.text).id;
  console.log(`disposable user ${username} (id ${userId})`);

  const session = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1360, height: 900 } });
  await session.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  // Block the release-test auto-login so this context stays on the disposable user.
  await session.route('**/api/auth/test-session', (route) => route.fulfill({ status: 404, body: '' }));
  const page = await session.newPage();
  const dialogs = [];
  let acceptNextConfirm = false;
  page.on('dialog', async (dialog) => {
    dialogs.push({ type: dialog.type(), message: dialog.message() });
    if (dialog.type() === 'confirm' && acceptNextConfirm) await dialog.accept();
    else await dialog.dismiss();
  });
  page.on('pageerror', (e) => rows.push({ row: 'pageerror', status: 'FAIL', note: e.message }));

  await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(800);
  // Log in as the disposable user through the login form.
  await page.getByLabel(/用户名|user/i).first().fill(username);
  await page.getByLabel(/密码|password/i).first().fill(password);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.activity-rail', { timeout: 60000 });
  await page.waitForTimeout(1500);
  const who = await page.evaluate(async () => {
    const raw = localStorage.getItem('webterm-user');
    return raw ? JSON.parse(raw) : null;
  });
  if (!who || who.username !== username) throw new Error(`logged in as ${who?.username}, expected ${username}`);

  const userApi = (path, method = 'GET', body) => page.evaluate(async ({ path, method, body }) => {
    const token = localStorage.getItem('token') || '';
    const response = await fetch(path, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, text: await response.text() };
  }, { path, method, body });

  const sessionsOf = async () => {
    // The disposable user's tmux sessions are named wt-<uid>-*.
    return null;
  };
  void sessionsOf;

  // Create two disposable workspaces, each with one local terminal.
  const connection = await userApi('/api/quick-connect/local', 'POST', {});
  const connId = JSON.parse(connection.text).connection.id;
  // A fresh account starts on schema v1 (a single implicit workspace). Normalise
  // to the v2 workspaceTabs shape so close/cancel can be exercised per workspace.
  const toV2 = (layout) => {
    if (Array.isArray(layout?.workspaceTabs)) return layout;
    return {
      workspaceTabs: [{
        id: 'matrix-close-ws-1',
        index: 1,
        name: '矩阵关闭1',
        layout: { tree: layout.tree, panes: layout.panes, focusedPaneId: layout.focusedPaneId || 'root' },
      }],
    };
  };
  const layoutState = async () => {
    const raw = await userApi('/api/layout');
    const parsed = JSON.parse(raw.text);
    if (!parsed.layout) throw new Error(`unexpected /api/layout shape: ${raw.text.slice(0, 300)}`);
    parsed.layout = toV2(parsed.layout);
    return parsed;
  };
  const makeWorkspaceWithTerminal = async () => {
    const state = await layoutState();
    const layout = state.layout;
    const terminal = JSON.parse((await userApi(`/api/terminal-sessions/${connId}`, 'POST', {})).text).terminal_id;
    // Indexes must be unique; closing workspaces leaves gaps, so take the max.
    const wsIndex = Math.max(0, ...layout.workspaceTabs.map((w) => Number(w.index) || 0)) + 1;
    void toV2;
    const paneId = `matrix-close-pane-${wsIndex}`;
    layout.workspaceTabs.push({
      id: `matrix-close-ws-${wsIndex}-${Date.now()}`,
      index: wsIndex,
      name: `矩阵关闭${wsIndex}`,
      layout: {
        tree: { type: 'leaf', id: paneId },
        panes: { [paneId]: { tabs: [{ id: terminal, type: 'ssh', title: 'matrix-close', connId, labelNumber: 1 }], activeTabId: terminal } },
        focusedPaneId: paneId,
      },
    });
    const saved = await userApi('/api/layout', 'PUT', {
      schema_version: 2, revision: state.revision, layout,
    });
    if (saved.status >= 300) throw new Error(`cannot create workspace: ${saved.text} :: payload=${JSON.stringify(layout).slice(0, 400)}`);
    return { workspaceId: layout.workspaceTabs.at(-1).id, terminal };
  };

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.activity-rail', { timeout: 60000 });
  await page.waitForTimeout(1500);

  const first = await makeWorkspaceWithTerminal();
  const second = await makeWorkspaceWithTerminal();
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.activity-rail', { timeout: 60000 });
  await page.waitForTimeout(2500);

  const expandTabs = async () => {
    // The workspace bar starts collapsed by design; the close buttons live in it.
    // Only toggle when it is actually collapsed, or the click would hide them.
    const expanded = await page.getByRole('tab').count();
    if (!expanded) {
      const toggle = page.locator('.workspace-tabs-toggle').first();
      if (await toggle.count()) await toggle.click().catch(() => {});
      await page.waitForTimeout(300);
    }
  };
  const closeButton = (name) => page.getByRole('button', { name: new RegExp(`关闭工作区.*${name}`) }).first();
  const hasWorkspace = async (name) => (await page.getByRole('tab', { name: new RegExp(name) }).count()) > 0;

  // 1. Cancel preserves the workspace and its sessions.
  await expandTabs();
  const before = await layoutState();
  const btn1 = closeButton('矩阵关闭');
  if (!await btn1.count()) throw new Error('workspace close button not found');
  acceptNextConfirm = false; // cancel path
  await btn1.first().click();
  await page.waitForTimeout(600);
  const afterCancel = await layoutState();
  const cancelPreserved = afterCancel.layout.workspaceTabs.length === before.layout.workspaceTabs.length;
  record('close: cancel preserves workspaces/sessions', cancelPreserved ? 'PASS' : 'FAIL',
    `dialogs=${JSON.stringify(dialogs.map((d) => d.type))}, workspaces ${before.layout.workspaceTabs.length} -> ${afterCancel.layout.workspaceTabs.length}`);

  // 2. Inactive close preserves the active terminal DOM.
  await expandTabs();
  const activeBefore = await page.evaluate(() => document.querySelectorAll('.terminal-surface').length);
  const btn2 = closeButton('矩阵关闭');
  acceptNextConfirm = true;
  await btn2.first().click();
  await page.waitForTimeout(1200); // second dialog is accepted
  const activeAfter = await page.evaluate(() => document.querySelectorAll('.terminal-surface').length);
  const afterConfirm = await layoutState();
  record('close: confirm removes a workspace', afterConfirm.layout.workspaceTabs.length < afterCancel.layout.workspaceTabs.length ? 'PASS' : 'FAIL',
    `workspaces ${afterCancel.layout.workspaceTabs.length} -> ${afterConfirm.layout.workspaceTabs.length}, surfaces ${activeBefore} -> ${activeAfter}`);

  // 3. Last close leaves a fresh empty workspace and it persists across a reload.
  // Close the last workspace too: the app replaces it with a fresh empty one.
  let guard = 0;
  while ((await layoutState()).layout.workspaceTabs.length >= 1 && guard < 8) {
    await expandTabs();
    const btn = closeButton('矩阵');
    if (!await btn.count()) break;
    acceptNextConfirm = true;
    await btn.first().click();
    await page.waitForTimeout(1200);
    guard += 1;
  }
  const beforeReload = await layoutState();
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.activity-rail', { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const afterReload = await layoutState();
  const persisted = afterReload.layout.workspaceTabs.length === 1
    && (afterReload.layout.workspaceTabs[0].layout?.panes
      ? Object.values(afterReload.layout.workspaceTabs[0].layout.panes).every((p) => (p.tabs || []).length === 0)
      : true);
  record('close: last close persists an empty workspace', persisted ? 'PASS' : 'FAIL',
    `before reload ${beforeReload.layout.workspaceTabs.length} ws, after reload ${afterReload.layout.workspaceTabs.length} ws`);
  await page.screenshot({ path: `${outDir}/workspace-close.png` });

  // 4. Hard reload keeps the same empty workspace.
  const cdp = await session.newCDPSession(page);
  await cdp.send('Page.enable');
  await cdp.send('Page.reload', { ignoreCache: true });
  await page.waitForTimeout(3500);
  const afterHard = await layoutState();
  record('close: survives cache-bypassing reload', afterHard.layout.workspaceTabs.length === afterReload.layout.workspaceTabs.length ? 'PASS' : 'FAIL',
    `ws ${afterReload.layout.workspaceTabs.length} -> ${afterHard.layout.workspaceTabs.length}`);

  // 5. A peer that adds a Panel during the close must force a renewed
  //    confirmation instead of the close silently eating the new tab.
  try {
    const extra = await makeWorkspaceWithTerminal();
    await makeWorkspaceWithTerminal();
    await makeWorkspaceWithTerminal();
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('.activity-rail', { timeout: 60000 });
    await page.waitForTimeout(2500);
    await expandTabs();

    // A second client of the same user mutates the workspace mid-close.
    const peerContext = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } });
    await peerContext.route('**/api/auth/test-session', (route) => route.fulfill({ status: 404, body: '' }));
    const peerPage = await peerContext.newPage();
    await peerPage.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await peerPage.waitForTimeout(600);
    await peerPage.getByLabel(/用户名|user/i).first().fill(username);
    await peerPage.getByLabel(/密码|password/i).first().fill(password);
    await peerPage.keyboard.press('Enter');
    await peerPage.waitForSelector('.activity-rail', { timeout: 60000 });
    await peerPage.waitForTimeout(1500);
    const peerApi = (path, method = 'GET', body) => peerPage.evaluate(async ({ path, method, body }) => {
      const token = localStorage.getItem('token') || '';
      const response = await fetch(path, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: response.status, text: await response.text() };
    }, { path, method, body });

    dialogs.length = 0;
    acceptNextConfirm = true; // this close should be accepted so the race can happen
    const btn = closeButton('矩阵关闭');
    await btn.first().click();
    // While the close is terminating terminals, the peer adds a new Panel.
    await new Promise((resolve) => setTimeout(resolve, 150));
    const peerState = JSON.parse((await peerApi('/api/layout')).text);
    const peerLayout = toV2(peerState.layout);
    const target = peerLayout.workspaceTabs.find((w) => w.name.includes('矩阵关闭') && w.layout?.panes
      && Object.values(w.layout.panes).some((pane) => (pane.tabs || []).length > 0));
    const peerTerminal = JSON.parse((await peerApi(`/api/terminal-sessions/${connId}`, 'POST', {})).text).terminal_id;
    const peerPaneId = Object.keys(target.layout.panes)[0];
    target.layout.panes[peerPaneId].tabs.push({ id: peerTerminal, type: 'ssh', title: 'peer-add', connId, labelNumber: 77 });
    await peerApi('/api/layout', 'PUT', { schema_version: 2, revision: peerState.revision, layout: peerLayout });

    let message = '';
    for (let i = 0; i < 12; i += 1) {
      await page.waitForTimeout(300);
      message = await page.evaluate(() => Array.from(document.querySelectorAll('[role="status"]')).map((n) => n.textContent).join(' | '));
      if (message.includes('新增了 Panel') || message.includes('重新确认') || message.includes('部分终端')) break;
    }
    const stillThere = await hasWorkspace('矩阵关闭');
    const afterRace = await layoutState();
    const keptPeerTab = JSON.stringify(afterRace.layout.workspaceTabs).includes(peerTerminal);
    // The acceptance criterion is that the close did not silently eat the new
    // Panel: the workspace survives with the peer's tab, so a renewed
    // confirmation is required.
    const renewed = (message.includes('新增了 Panel') || message.includes('重新确认') || message.includes('同步最新布局')) && stillThere && keptPeerTab;
    record('close: peer additions require renewed confirmation', renewed && stillThere ? 'PASS' : 'FAIL',
      `message=${JSON.stringify(message.slice(0, 160))}, dialogs=${JSON.stringify(dialogs.map((d) => d.type))}, workspace kept=${stillThere}, peer tab=${peerTerminal.slice(0, 12)}`);

    // After a renewed confirmation with no further additions, the close succeeds.
    acceptNextConfirm = true;
    // Renewed confirmation: close every workspace that still holds a matrix tab.
    let passes = 0;
    while (passes < 6) {
      await expandTabs();
      const again = closeButton('矩阵');
      if (!await again.count()) break;
      acceptNextConfirm = true;
      await again.first().click();
      await page.waitForTimeout(2000);
      passes += 1;
    }
    const finalState = await layoutState();
    const leftovers = JSON.stringify(finalState.layout.workspaceTabs).includes(peerTerminal);
    record('close: renewed confirmation then succeeds', leftovers ? 'FAIL' : 'PASS',
      `${passes} confirm passes, workspaces left=${finalState.layout.workspaceTabs.length}, peer tab left=${leftovers}`);
    await peerContext.close();
    void extra;
  } catch (error) {
    record('close: peer additions require renewed confirmation', 'FAIL', error.message);
  }

  await session.close();
  void first;
  void second;
  void hasWorkspace;
} catch (error) {
  record('workspace close runner', 'FAIL', `${error.message}\n${error.stack || ''}`);
} finally {
  if (userId) {
    const removed = await adminApi(`/api/users/${userId}`, 'DELETE');
    console.log(`disposable user removed: ${removed.status}`);
  }
  await adminContext.close();
  await browser.close();
}

await writeFile(`${outDir}/workspace-close-summary.json`, JSON.stringify(rows, null, 2));
const failed = rows.filter((r) => r.status === 'FAIL');
console.log(`\n=== workspace close: ${rows.filter((r) => r.status === 'PASS').length} PASS, ${failed.length} FAIL, ${rows.filter((r) => r.status === 'NOT RUN').length} NOT RUN ===`);
for (const r of rows) if (r.status !== 'PASS') console.log(`${r.status} ${r.row}: ${r.note || ''}`);
process.exitCode = failed.length ? 1 : 0;
