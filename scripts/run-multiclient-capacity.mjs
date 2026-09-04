import playwright from '../ui/node_modules/@playwright/test/index.js';
import { randomBytes } from 'node:crypto';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const { chromium } = playwright;

const baseURL = (process.env.WEBTERM_BASE_URL || '').replace(/\/$/, '');
const username = process.env.WEBTERM_LOADTEST_USERNAME || '';
const password = process.env.WEBTERM_LOADTEST_PASSWORD || '';
const clients = Number.parseInt(process.env.WEBTERM_LOADTEST_CLIENTS || '10', 10);
const rows = Number.parseInt(process.env.WEBTERM_LOADTEST_ROWS || '10', 10);
const cols = Number.parseInt(process.env.WEBTERM_LOADTEST_COLS || '10', 10);
const timeout = Number.parseInt(process.env.WEBTERM_LOADTEST_TIMEOUT_MS || '180000', 10);
const chromePath = process.env.CHROME_PATH || '/usr/bin/google-chrome';

if (!baseURL || !username || !password || !Number.isInteger(clients) || clients < 1 || !Number.isInteger(rows) || rows < 1 || !Number.isInteger(cols) || cols < 1) {
  throw new Error('set WEBTERM_BASE_URL, WEBTERM_LOADTEST_USERNAME and WEBTERM_LOADTEST_PASSWORD; client, row and column counts must be positive integers');
}

function percentile(values, percentileValue) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1)];
}

function tmuxSessionName(userID, connectionID, terminalID) {
  return `wt-${userID}-${connectionID}-${createHash('sha256').update(terminalID).digest('hex').slice(0, 16)}`;
}

function removeTemporaryTmuxSessions(sessionNames) {
  for (const sessionName of sessionNames) {
    try {
      execFileSync('tmux', ['kill-session', '-t', sessionName], { stdio: 'ignore' });
    } catch { /* the session may not have started or may already be gone */ }
  }
}

function startWebtermSampler() {
  const pidFile = process.env.WEBTERM_PID_FILE || fileURLToPath(new URL('../runtime/webterm.pid', import.meta.url));
  const pid = Number.parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
  if (!Number.isInteger(pid) || pid < 1) throw new Error(`invalid webterm PID in ${pidFile}`);
  const ticksPerSecond = Number.parseInt(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim(), 10);
  if (!Number.isInteger(ticksPerSecond) || ticksPerSecond < 1) throw new Error('could not determine Linux clock ticks per second');
  let previous;
  let maxRSSKiB = 0;
  let maxThreads = 0;
  let maxCPUPercent = 0;
  const sample = () => {
    const status = readFileSync(`/proc/${pid}/status`, 'utf8');
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const rssMatch = /^VmRSS:\s+(\d+) kB$/m.exec(status);
    const threadMatch = /^Threads:\s+(\d+)$/m.exec(status);
    const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
    const cpuTicks = Number(fields[11]) + Number(fields[12]);
    const now = performance.now();
    maxRSSKiB = Math.max(maxRSSKiB, rssMatch ? Number(rssMatch[1]) : 0);
    maxThreads = Math.max(maxThreads, threadMatch ? Number(threadMatch[1]) : 0);
    if (previous) {
      const elapsedSeconds = (now - previous.now) / 1000;
      if (elapsedSeconds > 0) maxCPUPercent = Math.max(maxCPUPercent, ((cpuTicks - previous.cpuTicks) / ticksPerSecond / elapsedSeconds) * 100);
    }
    previous = { now, cpuTicks };
  };
  sample();
  const timer = setInterval(sample, 200);
  return {
    stop() {
      clearInterval(timer);
      sample();
      return { pid, maxRSSKiB, maxThreads, maxCPUPercent: Number(maxCPUPercent.toFixed(1)) };
    },
  };
}

function makeLayout(connectionID, activePaneCount) {
  const panes = {};
  const children = [];
  let paneIndex = 0;
  for (let row = 0; row < rows; row += 1) {
    const rowChildren = [];
    for (let col = 0; col < cols; col += 1) {
      const paneID = `load-pane-${row}-${col}`;
      rowChildren.push({ type: 'leaf', id: paneID });
      const active = paneIndex < activePaneCount;
      const tabID = `load-ssh-${row}-${col}`;
      panes[paneID] = {
        tabs: active ? [{ id: tabID, type: 'ssh', title: `容量会话 ${row}-${col}`, connId: connectionID }] : [],
        activeTabId: active ? tabID : null,
      };
      paneIndex += 1;
    }
    children.push({ type: 'split', direction: 'horizontal', children: rowChildren, ratios: Array(cols).fill(1 / cols) });
  }
  return {
    tree: { type: 'split', direction: 'vertical', children, ratios: Array(rows).fill(1 / rows) },
    panes,
    focusedPaneId: 'load-pane-0-0',
  };
}

async function api(page, token, path, options = {}) {
  const result = await page.evaluate(async ({ path, token, options }) => {
    const response = await fetch(path, {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) },
    });
    const text = await response.text();
    return { status: response.status, text };
  }, { path, token, options });
  if (result.status < 200 || result.status >= 300) throw new Error(`${path} returned ${result.status}: ${result.text}`);
  return result.text ? JSON.parse(result.text) : null;
}

async function login(page, loginUsername = username, loginPassword = password) {
  const result = await page.evaluate(async ({ username, password }) => {
    const response = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }),
    });
    return { status: response.status, text: await response.text() };
  }, { username: loginUsername, password: loginPassword });
  if (result.status !== 200) throw new Error(`login returned ${result.status}`);
  return JSON.parse(result.text);
}

async function openClient(token, user, expectedPanes) {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  const pageErrors = [];
  let layoutSocketSeen = false;
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('websocket', (socket) => { if (socket.url().includes('/ws/layout')) layoutSocketSeen = true; });
  await page.addInitScript(({ token, user }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('webterm-user', JSON.stringify(user));
  }, { token, user });
  const startedAt = performance.now();
  await page.goto(`${baseURL}/`, { waitUntil: 'domcontentloaded', timeout });
  await page.waitForFunction((minimum) => document.querySelectorAll('.xterm').length >= minimum, expectedPanes, { timeout });
  await page.waitForFunction(() => document.readyState === 'complete', undefined, { timeout });
  if (!layoutSocketSeen) throw new Error('layout WebSocket was not established');
  return { browser, context, page, pageErrors, initialLoadMs: performance.now() - startedAt };
}

const totalPanes = rows * cols;
if (totalPanes < 2) throw new Error('the capacity scenario needs at least two panes to measure a synchronization update');

let controlBrowser;
let controlContext;
let controlPage;
let token;
let controllerToken;
let loadTestUserID;
let currentRevision;
let clientInstances = [];
let restoreAttempted = false;
let sampler;
let temporaryTmuxSessions = [];
const startedAt = performance.now();

try {
  controlBrowser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  controlContext = await controlBrowser.newContext({ ignoreHTTPSErrors: true });
  controlPage = await controlContext.newPage();
  await controlPage.goto(`${baseURL}/`, { waitUntil: 'domcontentloaded', timeout });
  const controllerLogin = await login(controlPage);
  controllerToken = controllerLogin.token;
  const temporaryUsername = `loadtest-${Date.now()}-${randomBytes(4).toString('hex')}`;
  const temporaryPassword = randomBytes(24).toString('base64url');
  const createdUser = await api(controlPage, controllerToken, '/api/users', {
    method: 'POST', body: JSON.stringify({ username: temporaryUsername, password: temporaryPassword, role: 'admin' }),
  });
  loadTestUserID = createdUser.id;
  const loginResult = await login(controlPage, temporaryUsername, temporaryPassword);
  token = loginResult.token;
  const originalLayout = await api(controlPage, token, '/api/layout');
  const quickConnection = await api(controlPage, token, '/api/quick-connect/local', { method: 'POST', body: '{}' });
  const initialLayout = makeLayout(quickConnection.connection.id, totalPanes - 1);
  temporaryTmuxSessions = Object.values(makeLayout(quickConnection.connection.id, totalPanes).panes)
    .flatMap((pane) => pane.tabs.map((tab) => tmuxSessionName(loadTestUserID, quickConnection.connection.id, tab.id)));
  const initialSave = await api(controlPage, token, '/api/layout', {
    method: 'PUT', body: JSON.stringify({ schema_version: 1, revision: originalLayout.revision, layout: initialLayout }),
  });
  currentRevision = initialSave.revision;
  sampler = startWebtermSampler();

  clientInstances = await Promise.all(Array.from({ length: clients }, () => openClient(token, loginResult.user, totalPanes - 1)));
  const syncStartedAt = performance.now();
  const finalLayout = makeLayout(quickConnection.connection.id, totalPanes);
  const finalSave = await api(controlPage, token, '/api/layout', {
    method: 'PUT', body: JSON.stringify({ schema_version: 1, revision: currentRevision, layout: finalLayout }),
  });
  currentRevision = finalSave.revision;

  const syncTimes = await Promise.all(clientInstances.map(async (client) => {
    await client.page.waitForFunction((target) => document.querySelectorAll('.xterm').length >= target, totalPanes, { timeout });
    return performance.now() - syncStartedAt;
  }));

  const result = {
    clients,
    grid: `${rows}x${cols}`,
    targetTerminalPanes: clients * totalPanes,
    initialTerminalPanes: clients * (totalPanes - 1),
    layoutRevision: currentRevision,
    initialLoadMs: { p50: percentile(clientInstances.map((client) => client.initialLoadMs), 0.5), p95: percentile(clientInstances.map((client) => client.initialLoadMs), 0.95) },
    layoutSyncMs: { p50: percentile(syncTimes, 0.5), p95: percentile(syncTimes, 0.95), max: Math.max(...syncTimes) },
    pageErrors: clientInstances.flatMap((client) => client.pageErrors),
    webtermResources: sampler.stop(),
    wallClockMs: performance.now() - startedAt,
  };
  if (result.pageErrors.length > 0) throw new Error(`page errors: ${result.pageErrors.join(' | ')}`);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  if (sampler) sampler.stop();
  await Promise.all(clientInstances.map(async ({ context, browser }) => { await context.close(); await browser.close(); }));
  removeTemporaryTmuxSessions(temporaryTmuxSessions);
  if (controllerToken && loadTestUserID && controlPage) {
    restoreAttempted = true;
    try {
      await api(controlPage, controllerToken, `/api/users/${loadTestUserID}`, { method: 'DELETE' });
    } catch (error) {
      console.error(`temporary load-test user cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (controlContext) await controlContext.close();
  if (controlBrowser) await controlBrowser.close();
  if (!restoreAttempted && loadTestUserID) console.error('temporary load-test user cleanup was not attempted');
}
