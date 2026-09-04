import playwright from '../ui/node_modules/@playwright/test/index.js';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const { chromium } = playwright;
const baseURL = (process.env.WEBTERM_BASE_URL || '').replace(/\/$/, '');
const username = process.env.WEBTERM_LOADTEST_USERNAME || '';
const password = process.env.WEBTERM_LOADTEST_PASSWORD || '';
const chromePath = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const timeout = 60000;

if (!baseURL || !username || !password) throw new Error('set WEBTERM_BASE_URL, WEBTERM_LOADTEST_USERNAME and WEBTERM_LOADTEST_PASSWORD');

function tmuxSessionName(userID, connectionID, terminalID) {
  return `wt-${userID}-${connectionID}-${createHash('sha256').update(terminalID).digest('hex').slice(0, 16)}`;
}

function tmux(args) {
  return execFileSync('tmux', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
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

async function login(page, loginUsername, loginPassword) {
  const result = await page.evaluate(async ({ username, password }) => {
    const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    return { status: response.status, text: await response.text() };
  }, { username: loginUsername, password: loginPassword });
  if (result.status !== 200) throw new Error(`login returned ${result.status}`);
  return JSON.parse(result.text);
}

async function api(page, token, path, options = {}) {
  const result = await page.evaluate(async ({ token, path, options }) => {
    const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } });
    return { status: response.status, text: await response.text() };
  }, { token, path, options });
  if (result.status < 200 || result.status >= 300) throw new Error(`${path} returned ${result.status}: ${result.text}`);
  return result.text ? JSON.parse(result.text) : null;
}

function oneTerminalLayout(connectionID, terminalID) {
  return { tree: { type: 'leaf', id: 'root' }, panes: { root: { tabs: [{ id: terminalID, type: 'ssh', title: 'persistent verification', connId: connectionID }], activeTabId: terminalID } }, focusedPaneId: 'root' };
}

async function openTerminal(token, user, terminalID) {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(({ token, user }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('webterm-user', JSON.stringify(user));
  }, { token, user });
  await page.goto(`${baseURL}/`, { waitUntil: 'domcontentloaded', timeout });
  await page.waitForFunction((id) => typeof window[`webterm-ws-${id}`] === 'function', terminalID, { timeout });
  return { browser, context, page, errors };
}

async function sendCommand(page, terminalID, command) {
  await page.evaluate(({ terminalID, command }) => {
    const send = window[`webterm-ws-${terminalID}`];
    if (typeof send !== 'function') throw new Error('terminal WebSocket sender is unavailable');
    send(JSON.stringify({ data: command }));
  }, { terminalID, command });
}

async function waitForCapture(sessionName, marker) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (tmux(['capture-pane', '-p', '-t', sessionName]).includes(marker)) return;
    } catch { /* tmux may not have completed startup yet */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`tmux session ${sessionName} never contained ${marker}`);
}

let controlBrowser;
let controlContext;
let controlPage;
let controllerToken;
let loadTestUserID;
let sessionName;
let first;
let second;

try {
  controlBrowser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  controlContext = await controlBrowser.newContext({ ignoreHTTPSErrors: true });
  controlPage = await controlContext.newPage();
  await controlPage.goto(`${baseURL}/`, { waitUntil: 'domcontentloaded', timeout });
  controllerToken = (await login(controlPage, username, password)).token;
  const temporaryUsername = `persistent-test-${Date.now()}-${randomBytes(4).toString('hex')}`;
  const temporaryPassword = randomBytes(24).toString('base64url');
  loadTestUserID = (await api(controlPage, controllerToken, '/api/users', { method: 'POST', body: JSON.stringify({ username: temporaryUsername, password: temporaryPassword, role: 'admin' }) })).id;
  const testLogin = await login(controlPage, temporaryUsername, temporaryPassword);
  const token = testLogin.token;
  const connection = await api(controlPage, token, '/api/quick-connect/local', { method: 'POST', body: '{}' });
  const terminalID = `persistent-tab-${randomBytes(8).toString('hex')}`;
  sessionName = tmuxSessionName(loadTestUserID, connection.connection.id, terminalID);
  const current = await api(controlPage, token, '/api/layout');
  await api(controlPage, token, '/api/layout', { method: 'PUT', body: JSON.stringify({ schema_version: 1, revision: current.revision, layout: oneTerminalLayout(connection.connection.id, terminalID) }) });

  const markerOne = `WEBTERM_PERSIST_ONE_${randomBytes(6).toString('hex')}`;
  first = await openTerminal(token, testLogin.user, terminalID);
  const unfinishedInput = `WEBTERM_UNFINISHED_${randomBytes(6).toString('hex')}`;
  await sendCommand(first.page, terminalID, `printf '${unfinishedInput}'`);
  await waitForCapture(sessionName, unfinishedInput);

  // Opening the same shared terminal from another browser must only attach to
  // tmux. It must never type setup text (or an implicit Enter) into the shell
  // that the first browser is currently using.
  second = await openTerminal(token, testLogin.user, terminalID);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const duringSecondAttach = tmux(['capture-pane', '-p', '-t', sessionName]);
  if (duringSecondAttach.includes('PROMPT_COMMAND=') || !duringSecondAttach.includes(unfinishedInput)) {
    throw new Error('attaching a second browser modified unfinished shared shell input');
  }
  await sendCommand(first.page, terminalID, '\u0003');

  await sendCommand(first.page, terminalID, `printf '${markerOne}\\n'\r`);
  await waitForCapture(sessionName, markerOne);
  if (tmux(['show-options', '-t', sessionName, 'window-size']).trim() !== 'window-size smallest') {
    throw new Error('persistent tmux session did not use the smallest attached client size');
  }
  await first.context.close();
  await first.browser.close();
  first = undefined;
  tmux(['has-session', '-t', sessionName]);

  const markerTwo = `WEBTERM_PERSIST_TWO_${randomBytes(6).toString('hex')}`;
  await sendCommand(second.page, terminalID, `printf '${markerTwo}\\n'\r`);
  await waitForCapture(sessionName, markerTwo);
  const captured = tmux(['capture-pane', '-p', '-t', sessionName]);
  if (!captured.includes(markerOne) || !captured.includes(markerTwo)) throw new Error('reattached terminal did not retain both markers');
  if (second.errors.length > 0) throw new Error(`browser errors: ${second.errors.join(' | ')}`);
  process.stdout.write(`${JSON.stringify({ persistentSession: sessionName, retainedAcrossReconnect: true, windowSize: 'smallest', pageErrors: [] })}\n`);
} finally {
  if (first) { await first.context.close(); await first.browser.close(); }
  if (second) { await second.context.close(); await second.browser.close(); }
  if (sessionName) { try { tmux(['kill-session', '-t', sessionName]); } catch { /* session may not have started */ } }
  if (controllerToken && loadTestUserID && controlPage) { try { await deleteTemporaryUser(controlPage, controllerToken, loadTestUserID); } catch (error) { console.error(`temporary user cleanup failed: ${error instanceof Error ? error.message : String(error)}`); } }
  if (controlContext) await controlContext.close();
  if (controlBrowser) await controlBrowser.close();
}
