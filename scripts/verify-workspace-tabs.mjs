import playwright from '../ui/node_modules/@playwright/test/index.js';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const { chromium } = playwright;
const baseURL = (process.env.WEBTERM_BASE_URL || '').replace(/\/$/, '');
const username = process.env.WEBTERM_LOADTEST_USERNAME || '';
const password = process.env.WEBTERM_LOADTEST_PASSWORD || '';
const chromePath = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const restartReleaseTest = process.env.WEBTERM_RESTART_RELEASE_TEST === 'true';
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const timeout = 60_000;

if (!baseURL || !username || !password) {
  throw new Error('set WEBTERM_BASE_URL, WEBTERM_LOADTEST_USERNAME and WEBTERM_LOADTEST_PASSWORD');
}

function terminalSessionName(userID, connectionID, terminalID) {
  return `wt-${userID}-${connectionID}-${createHash('sha256').update(terminalID).digest('hex').slice(0, 16)}`;
}

function tmuxHasSession(sessionName) {
  try {
    execFileSync('tmux', ['has-session', '-t', sessionName], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function killTmuxSession(sessionName) {
  if (!sessionName || !tmuxHasSession(sessionName)) return;
  execFileSync('tmux', ['kill-session', '-t', sessionName], { stdio: 'ignore' });
}

function temporaryUserSessions(userID) {
  if (!userID) return [];
  try {
    const prefix = `wt-${userID}-`;
    return execFileSync('tmux', ['list-sessions', '-F', '#{session_name}'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .trim().split('\n').filter((session) => session.startsWith(prefix));
  } catch {
    return [];
  }
}

async function killTemporaryUserSessions(userID) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const sessions = temporaryUserSessions(userID);
    for (const session of sessions) killTmuxSession(session);
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (temporaryUserSessions(userID).length === 0) return;
  }
  throw new Error(`temporary tmux sessions survived cleanup for user ${userID}`);
}

async function waitForTmuxSession(sessionName) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (tmuxHasSession(sessionName)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`tmux session was not attached: ${sessionName}`);
}

async function login(page, loginUsername, loginPassword) {
  const result = await page.evaluate(async ({ username, password }) => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    return { status: response.status, body: await response.text() };
  }, { username: loginUsername, password: loginPassword });
  if (result.status !== 200) throw new Error(`login returned ${result.status}`);
  return JSON.parse(result.body);
}

async function api(page, token, path, options = {}) {
  const result = await page.evaluate(async ({ token, path, options }) => {
    const response = await fetch(path, {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    return { status: response.status, body: await response.text() };
  }, { token, path, options });
  if (result.status < 200 || result.status >= 300) throw new Error(`${path} returned ${result.status}: ${result.body}`);
  return result.body ? JSON.parse(result.body) : null;
}

async function waitForLayout(page, token, predicate, description) {
  const deadline = Date.now() + timeout;
  let latest;
  while (Date.now() < deadline) {
    latest = await api(page, token, '/api/layout');
    if (predicate(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`layout never reached ${description}: ${JSON.stringify(latest)}`);
}

async function deleteTemporaryUser(page, token, userID) {
  let lastError;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await api(page, token, `/api/users/${userID}`, { method: 'DELETE' });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError;
}

function schemaV1Layout(connectionID, terminalIDs) {
  const paneIDs = ['root', ...Array.from({ length: 7 }, (_, index) => `legacy-pane-${index + 2}`)];
  return {
    tree: {
      type: 'split', direction: 'vertical', ratios: [0.5, 0.5], children: [
        { type: 'split', direction: 'horizontal', ratios: [0.25, 0.25, 0.25, 0.25], children: paneIDs.slice(0, 4).map((id) => ({ type: 'leaf', id })) },
        { type: 'split', direction: 'horizontal', ratios: [0.25, 0.25, 0.25, 0.25], children: paneIDs.slice(4).map((id) => ({ type: 'leaf', id })) },
      ],
    },
    panes: Object.fromEntries(paneIDs.map((paneID, index) => [paneID, {
      tabs: [{ id: terminalIDs[index], type: 'ssh', title: `workspace E2E shell ${index + 1}`, connId: connectionID, labelNumber: index + 1 }],
      activeTabId: terminalIDs[index],
    }])),
    focusedPaneId: 'root',
  };
}

async function openClient(browser, token, user, viewport, deleteRequests) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  const failedResponses = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('request', (request) => {
    if (request.method() === 'DELETE' && request.url().includes('/api/terminal-sessions/')) deleteRequests.push(request.url());
  });
  page.on('response', (response) => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${new URL(response.url()).pathname}`);
  });
  await page.addInitScript(({ authToken, authUser }) => {
    localStorage.setItem('token', authToken);
    localStorage.setItem('webterm-user', JSON.stringify(authUser));
  }, { authToken: token, authUser: user });
  await page.goto(`${baseURL}/`, { waitUntil: 'domcontentloaded', timeout });
  await page.getByRole('tab', { name: '1: workspace', exact: true }).waitFor({ timeout });
  return { context, page, pageErrors, consoleErrors, failedResponses };
}

async function restartReleaseEnvironment() {
  execFileSync('bash', ['-lc', 'source ./scripts/lan-lib.sh; lan_stop_pid webterm-release; lan_start_release'], {
    cwd: repoRoot,
    env: process.env,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const health = execFileSync('curl', ['--silent', '--show-error', '--insecure', `${baseURL}/api/health`], { encoding: 'utf8' });
      if (health.includes('"environment":"release-test"') && health.includes('"status":"ok"')) return;
    } catch { /* release listener may still be starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('release-test did not recover after restart');
}

async function openCreateDialog(page) {
  await page.getByRole('button', { name: /新建工作区|New workspace/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  return dialog;
}

async function renameWorkspace(page, accessibleName, newName, key = 'Enter') {
  await page.getByRole('tab', { name: accessibleName, exact: true }).dblclick();
  const input = page.locator('[role="tab"] input[maxlength="256"]');
  await input.fill(newName);
  await input.press(key);
}

function collectSharedIDs(layout) {
  const workspaceIDs = [];
  const paneIDs = [];
  const terminalIDs = [];
  for (const workspace of layout.workspaceTabs) {
    workspaceIDs.push(workspace.id);
    for (const pane of Object.values(workspace.layout.panes)) {
      for (const tab of pane.tabs) terminalIDs.push(tab.id);
    }
    paneIDs.push(...Object.keys(workspace.layout.panes));
  }
  return { workspaceIDs, paneIDs, terminalIDs };
}

let browser;
let controlContext;
let controlPage;
let controllerToken;
let temporaryUserID;
let originalSessionNames = [];
let copiedSessionNames = [];
const clients = [];
const deleteRequests = [];

try {
  browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox'] });
  controlContext = await browser.newContext({ ignoreHTTPSErrors: true });
  controlPage = await controlContext.newPage();
  await controlPage.goto(`${baseURL}/`, { waitUntil: 'domcontentloaded', timeout });
  controllerToken = (await login(controlPage, username, password)).token;

  const temporaryUsername = `workspace-e2e-${Date.now()}-${randomBytes(4).toString('hex')}`;
  const temporaryPassword = randomBytes(24).toString('base64url');
  temporaryUserID = (await api(controlPage, controllerToken, '/api/users', {
    method: 'POST',
    body: JSON.stringify({ username: temporaryUsername, password: temporaryPassword, role: 'admin' }),
  })).id;
  const testLogin = await login(controlPage, temporaryUsername, temporaryPassword);
  const token = testLogin.token;
  const connection = await api(controlPage, token, '/api/quick-connect/local', { method: 'POST', body: '{}' });
  const connectionID = connection.connection.id;
  const originalTerminalIDs = Array.from({ length: 8 }, () => `workspace-original-${randomBytes(8).toString('hex')}`);
  originalSessionNames = originalTerminalIDs.map((terminalID) => terminalSessionName(temporaryUserID, connectionID, terminalID));
  const current = await api(controlPage, token, '/api/layout');
  await api(controlPage, token, '/api/layout', {
    method: 'PUT',
    body: JSON.stringify({ schema_version: 1, revision: current.revision, layout: schemaV1Layout(connectionID, originalTerminalIDs) }),
  });

  const first = await openClient(browser, token, testLogin.user, { width: 1440, height: 900 }, deleteRequests);
  clients.push(first);
  const second = await openClient(browser, token, testLogin.user, { width: 1280, height: 800 }, deleteRequests);
  clients.push(second);
  await first.page.waitForFunction((terminalID) => typeof window[`webterm-ws-${terminalID}`] === 'function', originalTerminalIDs[0], { timeout });
  for (const sessionName of originalSessionNames) await waitForTmuxSession(sessionName);

  let dialog = await openCreateDialog(first.page);
  const radios = dialog.getByRole('radio');
  if (!await radios.first().isChecked()) throw new Error('new workspace did not default to blank mode');
  await dialog.getByRole('button').last().click();
  await first.page.getByRole('tab', { name: '2: workspace', exact: true }).waitFor();
  if (await first.page.getByText('workspace E2E shell', { exact: false }).count() !== 0) throw new Error('blank workspace copied an existing terminal');

  await renameWorkspace(first.page, '2: workspace', 'cancelled name', 'Escape');
  await first.page.getByRole('tab', { name: '2: workspace', exact: true }).waitFor();
  await first.page.getByRole('tab', { name: '2: workspace', exact: true }).dblclick();
  const blankRename = first.page.locator('[role="tab"] input[maxlength="256"]');
  await blankRename.fill('   ');
  await first.page.locator('body').click({ position: { x: 600, y: 200 } });
  await first.page.getByRole('tab', { name: '2: workspace', exact: true }).waitFor();
  await renameWorkspace(first.page, '2: workspace', 'blank & qa');
  await first.page.getByRole('tab', { name: '2: blank & qa', exact: true }).waitFor();

  await first.page.getByRole('tab', { name: '1: workspace', exact: true }).click();
  dialog = await openCreateDialog(first.page);
  await dialog.getByRole('radio').last().check();
  await dialog.getByRole('button').last().click();
  await first.page.getByRole('tab', { name: '3: workspace', exact: true }).waitFor();
  await renameWorkspace(first.page, '3: workspace', '<b>production & qa</b>');
  await first.page.getByRole('tab', { name: '3: <b>production & qa</b>', exact: true }).waitFor();
  if (await first.page.locator('b').count() !== 0) throw new Error('workspace name was interpreted as HTML');

  const persisted = await waitForLayout(controlPage, token, (response) =>
    response.schema_version === 2 && response.layout?.workspaceTabs?.length === 3 &&
    response.layout.workspaceTabs[1].name === 'blank & qa' && response.layout.workspaceTabs[2].name === '<b>production & qa</b>',
  'three persisted schema v2 workspaces');
  const indexes = persisted.layout.workspaceTabs.map((workspace) => workspace.index);
  if (JSON.stringify(indexes) !== JSON.stringify([1, 2, 3])) throw new Error(`workspace indexes changed: ${indexes.join(',')}`);
  const ids = collectSharedIDs(persisted.layout);
  for (const values of Object.values(ids)) {
    if (new Set(values).size !== values.length) throw new Error(`schema v2 contains duplicate identities: ${JSON.stringify(ids)}`);
  }
  const migratedTerminalIDs = Object.values(persisted.layout.workspaceTabs[0].layout.panes).flatMap((pane) => pane.tabs.map((tab) => tab.id));
  if (migratedTerminalIDs.length !== 8 || originalTerminalIDs.some((terminalID) => !migratedTerminalIDs.includes(terminalID))) {
    throw new Error('v1 to v2 migration changed one or more existing 8-pane terminal IDs');
  }
  const copiedTerminalIDs = Object.values(persisted.layout.workspaceTabs[2].layout.panes).flatMap((pane) => pane.tabs.map((tab) => tab.id));
  if (copiedTerminalIDs.length !== 8 || copiedTerminalIDs.some((terminalID) => originalTerminalIDs.includes(terminalID))) {
    throw new Error('copied 8-pane workspace reused an original terminalID');
  }
  copiedSessionNames = copiedTerminalIDs.map((terminalID) => terminalSessionName(temporaryUserID, connectionID, terminalID));
  await first.page.waitForFunction((terminalID) => typeof window[`webterm-ws-${terminalID}`] === 'function', copiedTerminalIDs[0], { timeout });
  for (const sessionName of copiedSessionNames) await waitForTmuxSession(sessionName);

  await second.page.getByRole('tab', { name: '3: <b>production & qa</b>', exact: true }).waitFor({ timeout });
  if (!await second.page.getByRole('tab', { name: '1: workspace', exact: true }).getAttribute('aria-selected').then((value) => value === 'true')) {
    throw new Error('a remote workspace update stole the second browser active workspace');
  }
  await first.page.getByRole('tab', { name: '2: blank & qa', exact: true }).click();
  await second.page.getByRole('tab', { name: '3: <b>production & qa</b>', exact: true }).click();
  if (await first.page.getByRole('tab', { name: '2: blank & qa', exact: true }).getAttribute('aria-selected') !== 'true') {
    throw new Error('workspace switching in one browser changed another browser active workspace');
  }
  if (![...originalSessionNames, ...copiedSessionNames].every(tmuxHasSession)) throw new Error('workspace switching killed a hidden tmux session');
  if (deleteRequests.length > 0) throw new Error(`workspace switching called terminal session DELETE: ${deleteRequests.join(',')}`);

  await first.page.reload({ waitUntil: 'domcontentloaded', timeout });
  await first.page.getByRole('tab', { name: '1: workspace', exact: true }).waitFor({ timeout });
  await first.page.getByRole('tab', { name: '2: blank & qa', exact: true }).waitFor();
  await first.page.getByRole('tab', { name: '3: <b>production & qa</b>', exact: true }).waitFor();
  await first.page.waitForFunction((terminalID) => typeof window[`webterm-ws-${terminalID}`] === 'function', originalTerminalIDs[0], { timeout });
  await first.page.locator('.terminal-surface').first().waitFor({ timeout });
  await first.page.screenshot({ path: '/tmp/webterm-workspace-tabs-desktop.png', fullPage: true });

  const mobile = await openClient(browser, token, testLogin.user, { width: 390, height: 844 }, deleteRequests);
  clients.push(mobile);
  await mobile.page.getByRole('tab', { name: '3: <b>production & qa</b>', exact: true }).waitFor({ timeout });
  await mobile.page.waitForFunction((terminalID) => typeof window[`webterm-ws-${terminalID}`] === 'function', originalTerminalIDs[0], { timeout });
  await mobile.page.locator('.terminal-surface').first().waitFor({ timeout });
  const overflow = await mobile.page.evaluate(() => ({ body: document.body.scrollWidth - document.body.clientWidth, document: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
  if (overflow.body > 1 || overflow.document > 1) throw new Error(`workspace bar overflowed the mobile viewport: ${JSON.stringify(overflow)}`);
  await mobile.page.screenshot({ path: '/tmp/webterm-workspace-tabs-mobile.png', fullPage: true });

  const diagnostics = clients.flatMap((client) => [
    ...client.pageErrors.map((error) => `pageerror: ${error}`),
    ...client.consoleErrors.map((error) => `console: ${error}`),
    ...client.failedResponses.map((error) => `http: ${error}`),
  ]);
  if (diagnostics.length > 0) throw new Error(`browser diagnostics were not clean: ${diagnostics.join(' | ')}`);
  if (deleteRequests.length > 0) throw new Error(`unexpected terminal session DELETE: ${deleteRequests.join(',')}`);

  let persistedAfterRestart = false;
  if (restartReleaseTest) {
    for (const client of clients) await client.context.close();
    await restartReleaseEnvironment();
    controllerToken = (await login(controlPage, username, password)).token;
    const restartedLogin = await login(controlPage, temporaryUsername, temporaryPassword);
    const afterRestart = await openClient(browser, restartedLogin.token, restartedLogin.user, { width: 1365, height: 768 }, deleteRequests);
    clients.push(afterRestart);
    await afterRestart.page.getByRole('tab', { name: '2: blank & qa', exact: true }).waitFor({ timeout });
    await afterRestart.page.getByRole('tab', { name: '3: <b>production & qa</b>', exact: true }).waitFor({ timeout });
    const restartedLayout = await api(afterRestart.page, restartedLogin.token, '/api/layout');
    if (restartedLayout.schema_version !== 2 || restartedLayout.layout.workspaceTabs.length !== 3) {
      throw new Error(`workspace schema did not survive release-test restart: ${JSON.stringify(restartedLayout)}`);
    }
    if (![...originalSessionNames, ...copiedSessionNames].every(tmuxHasSession)) {
      throw new Error('release-test restart killed a workspace terminal session');
    }
    if (afterRestart.pageErrors.length || afterRestart.consoleErrors.length || afterRestart.failedResponses.length) {
      throw new Error(`post-restart browser diagnostics were not clean: ${JSON.stringify({ pageErrors: afterRestart.pageErrors, consoleErrors: afterRestart.consoleErrors, failedResponses: afterRestart.failedResponses })}`);
    }
    persistedAfterRestart = true;
  }

  process.stdout.write(`${JSON.stringify({
    schemaVersion: persisted.schema_version,
    workspaceIndexes: indexes,
    workspaceNames: persisted.layout.workspaceTabs.map((workspace) => workspace.name),
    v1TerminalsRetained: 8,
    copyUsesIndependentTerminalIDs: 8,
    hiddenTmuxSessionsRetained: true,
    independentBrowserSelection: true,
    persistedAfterReleaseTestRestart: persistedAfterRestart,
    reauthenticatedAfterReleaseTestRestart: persistedAfterRestart,
    terminalSessionDeletes: 0,
    desktopScreenshot: '/tmp/webterm-workspace-tabs-desktop.png',
    mobileScreenshot: '/tmp/webterm-workspace-tabs-mobile.png',
    pageErrors: [],
    consoleErrors: [],
    failedResponses: [],
  })}\n`);
} finally {
  let cleanupError;
  for (const client of clients) await client.context.close().catch(() => {});
  for (const sessionName of [...originalSessionNames, ...copiedSessionNames]) killTmuxSession(sessionName);
  await killTemporaryUserSessions(temporaryUserID).catch((error) => { cleanupError = error; });
  if (temporaryUserID && controlPage && controllerToken) await deleteTemporaryUser(controlPage, controllerToken, temporaryUserID).catch(() => {});
  if (controlContext) await controlContext.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  if (cleanupError) throw cleanupError;
}
