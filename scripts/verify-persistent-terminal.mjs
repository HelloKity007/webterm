import playwright from '../ui/node_modules/@playwright/test/index.js';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const { chromium } = playwright;
const baseURL = (process.env.WEBTERM_BASE_URL || '').replace(/\/$/, '');
const username = process.env.WEBTERM_LOADTEST_USERNAME || '';
const password = process.env.WEBTERM_LOADTEST_PASSWORD || '';
const chromePath = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const expectPreservedTerminal = process.env.WEBTERM_EXPECT_PRESERVE_TERMINALS === 'true';
const timeout = 60000;

if (!baseURL || !username || !password) throw new Error('set WEBTERM_BASE_URL, WEBTERM_LOADTEST_USERNAME and WEBTERM_LOADTEST_PASSWORD');

function tmuxSessionName(userID, workspaceIndex, panelNumber, terminalID) {
  return `wt${String(userID).padStart(2, '0')}-${String(workspaceIndex).padStart(2, '0')}-${String(panelNumber).padStart(2, '0')}-${createHash('sha256').update(terminalID).digest('hex').slice(0, 16)}`;
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

function twoTerminalLayout(connectionID, terminalID, distractorID) {
  return { tree: { type: 'leaf', id: 'root' }, panes: { root: { tabs: [
    { id: terminalID, type: 'ssh', title: 'persistent verification', connId: connectionID, labelNumber: 1 },
    { id: distractorID, type: 'ssh', title: 'other terminal', connId: connectionID, labelNumber: 2 },
  ], activeTabId: distractorID } }, focusedPaneId: 'root' };
}

async function openTerminal(token, user, terminalID, viewport, deviceScaleFactor = 1) {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport, deviceScaleFactor });
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

async function selectTerminal(page, terminalID, title) {
  await page.getByText(title, { exact: false }).first().click();
  await page.waitForFunction((id) => typeof window[`webterm-ws-${id}`] === 'function', terminalID, { timeout });
}

async function terminalViewportBounds(page) {
  return page.evaluate(() => {
    const bounds = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height, background: getComputedStyle(element).backgroundColor };
    };
    return {
      surface: bounds(document.querySelector('.terminal-surface')),
      xterm: bounds(document.querySelector('.terminal-surface > .xterm')),
      viewport: bounds(document.querySelector('.terminal-surface .xterm-viewport')),
      screen: bounds(document.querySelector('.terminal-surface .xterm-screen')),
      canvases: [...document.querySelectorAll('.terminal-surface .xterm-screen canvas')].map((canvas) => ({
        ...bounds(canvas),
        bitmapWidth: canvas.width,
        bitmapHeight: canvas.height,
      })),
    };
  });
}

async function terminalScalingState(page) {
  return page.evaluate(() => {
    const surface = document.querySelector('.terminal-surface');
    const screen = surface?.querySelector('.xterm-screen');
    if (!(surface instanceof HTMLElement) || !(screen instanceof HTMLElement)) return null;
    const surfaceRect = surface.getBoundingClientRect();
    const screenRect = screen.getBoundingClientRect();
    const style = getComputedStyle(surface);
    return {
      nativeCols: Number(surface.dataset.nativeCols),
      nativeRows: Number(surface.dataset.nativeRows),
      sharedCols: Number(surface.dataset.sharedCols),
      sharedRows: Number(surface.dataset.sharedRows),
      scale: Number(surface.dataset.terminalScale),
      availableWidth: surfaceRect.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      availableHeight: surfaceRect.height,
      screenWidth: screenRect.width,
      screenHeight: screenRect.height,
    };
  });
}

async function sendCommand(page, terminalID, command) {
  await page.evaluate(({ terminalID, command }) => {
    const send = window[`webterm-ws-${terminalID}`];
    if (typeof send !== 'function') throw new Error('terminal WebSocket sender is unavailable');
    send(JSON.stringify({ data: command }));
  }, { terminalID, command });
}

async function sendAction(page, terminalID, action) {
  await page.evaluate(({ terminalID, action }) => {
    const send = window[`webterm-ws-${terminalID}`];
    if (typeof send !== 'function') throw new Error('terminal WebSocket sender is unavailable');
    send(JSON.stringify({ action }));
  }, { terminalID, action });
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

async function waitForSessionGone(sessionName) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      tmux(['has-session', '-t', sessionName]);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`tmux session ${sessionName} still exists after its tab was closed`);
}

async function waitForClientSizes(sessionName, expectedSizes) {
  const deadline = Date.now() + timeout;
  let actualSizes = [];
  while (Date.now() < deadline) {
    try {
      actualSizes = tmux(['list-clients', '-t', sessionName, '-F', '#{client_width}x#{client_height}']).trim().split('\n').filter(Boolean).sort();
      if (JSON.stringify(actualSizes) === JSON.stringify(expectedSizes)) return actualSizes;
    } catch { /* clients may be between detach and reconnect */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`tmux clients did not recover their dimensions: expected=${expectedSizes.join(',')} actual=${actualSizes.join(',')}`);
}

let controlBrowser;
let controlContext;
let controlPage;
let controllerToken;
let loadTestUserID;
let sessionName;
let distractorSessionName;
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
  const distractorID = `persistent-other-${randomBytes(8).toString('hex')}`;
  sessionName = tmuxSessionName(loadTestUserID, 1, 1, terminalID);
  distractorSessionName = tmuxSessionName(loadTestUserID, 1, 2, distractorID);
  const current = await api(controlPage, token, '/api/layout');
  await api(controlPage, token, '/api/layout', { method: 'PUT', body: JSON.stringify({ schema_version: 1, revision: current.revision, layout: twoTerminalLayout(connection.connection.id, terminalID, distractorID) }) });

  const markerOne = `WEBTERM_PERSIST_ONE_${randomBytes(6).toString('hex')}`;
  first = await openTerminal(token, testLogin.user, distractorID, { width: 1920, height: 1080 });
  await selectTerminal(first.page, terminalID, '1: persistent verification');
  const unfinishedInput = `WEBTERM_UNFINISHED_${randomBytes(6).toString('hex')}`;
  await sendCommand(first.page, terminalID, `printf '${unfinishedInput}'`);
  await waitForCapture(sessionName, unfinishedInput);

  // Opening the same shared terminal from another browser must only attach to
  // tmux. It must never type setup text (or an implicit Enter) into the shell
  // that the first browser is currently using.
  second = await openTerminal(token, testLogin.user, distractorID, { width: 3440, height: 1440 }, 1.25);
  await selectTerminal(second.page, terminalID, '1: persistent verification');
  await first.page.waitForFunction(() => {
    const surface = document.querySelector('.terminal-surface');
    return surface instanceof HTMLElement && Number(surface.dataset.sharedCols) > Number(surface.dataset.nativeCols);
  }, null, { timeout });
  await second.page.waitForFunction(() => {
    const surface = document.querySelector('.terminal-surface');
    return surface instanceof HTMLElement && Number(surface.dataset.sharedCols) > 0;
  }, null, { timeout });
  await new Promise((resolve) => setTimeout(resolve, 500));
  const duringSecondAttach = tmux(['capture-pane', '-p', '-t', sessionName]);
  if (duringSecondAttach.includes('PROMPT_COMMAND=') || !duringSecondAttach.includes(unfinishedInput)) {
    throw new Error('attaching a second browser modified unfinished shared shell input');
  }
  const secondBounds = await terminalViewportBounds(second.page);
  if (!secondBounds.surface || !secondBounds.xterm || !secondBounds.viewport ||
    Math.abs(secondBounds.surface.width - secondBounds.xterm.width) > 16 ||
    Math.abs(secondBounds.surface.height - secondBounds.xterm.height) > 1 ||
    Math.abs(secondBounds.xterm.width - secondBounds.viewport.width) > 1 ||
    Math.abs(secondBounds.xterm.height - secondBounds.viewport.height) > 1) {
    throw new Error(`second browser terminal did not fill its 3440x1440 pane: ${JSON.stringify(secondBounds)}`);
  }
  const smallScaling = await terminalScalingState(first.page);
  const largeScaling = await terminalScalingState(second.page);
  if (!smallScaling || !largeScaling || smallScaling.scale >= 1 || largeScaling.scale < 0.98 ||
    smallScaling.sharedCols !== largeScaling.sharedCols || smallScaling.sharedRows !== largeScaling.sharedRows ||
    smallScaling.sharedCols < largeScaling.nativeCols || smallScaling.sharedRows < largeScaling.nativeRows ||
    smallScaling.screenWidth > smallScaling.availableWidth + 2 || smallScaling.screenHeight > smallScaling.availableHeight + 2 ||
    smallScaling.screenWidth < smallScaling.availableWidth * 0.94 || smallScaling.screenHeight < smallScaling.availableHeight * 0.94) {
    throw new Error(`small browser did not scale the complete shared terminal grid into its pane: small=${JSON.stringify(smallScaling)} large=${JSON.stringify(largeScaling)}`);
  }
  const tmuxClientsBeforeRename = tmux(['list-clients', '-t', sessionName, '-F', '#{client_width}x#{client_height}']).trim().split('\n').sort();
  await first.page.getByText('1: persistent verification', { exact: true }).dblclick();
  const renameInput = first.page.getByLabel('标签名称');
  await renameInput.fill('persistent verification renamed');
  await renameInput.press('Enter');
  await second.page.waitForFunction(() => document.body.textContent?.includes('persistent verification renamed'), null, { timeout });
  await waitForClientSizes(sessionName, tmuxClientsBeforeRename);
  const tmuxClients = tmux(['list-clients', '-t', sessionName, '-F', '#{client_width}x#{client_height}']);
  const tmuxClientsAfterRename = tmuxClients.trim().split('\n').sort();
  if (JSON.stringify(tmuxClientsAfterRename) !== JSON.stringify(tmuxClientsBeforeRename) || tmuxClientsAfterRename.includes('40x120')) {
    throw new Error(`renaming a tab changed PTY dimensions: before=${tmuxClientsBeforeRename.join(',')} after=${tmuxClientsAfterRename.join(',')}`);
  }
  const parsedClientSizes = tmuxClients.trim().split('\n').filter(Boolean).map((size) => size.split('x').map(Number));
  const tmuxWindow = tmux(['display-message', '-p', '-t', sessionName, '#{window_width}x#{window_height}']).trim();
  const [tmuxWindowWidth, tmuxWindowHeight] = tmuxWindow.split('x').map(Number);
  if (tmuxWindowWidth !== smallScaling.sharedCols || tmuxWindowHeight + 1 !== smallScaling.sharedRows ||
    parsedClientSizes.some(([width, height]) => width !== smallScaling.sharedCols || height !== smallScaling.sharedRows)) {
    throw new Error(`shared tmux window ${tmuxWindow} and attached PTYs do not use the broadcast grid: ${tmuxClients.trim()}`);
  }
  await first.page.screenshot({ path: '/tmp/webterm-shared-1920.png' });
  await second.page.screenshot({ path: '/tmp/webterm-shared-3440.png' });
  await sendCommand(first.page, terminalID, '\u0003');

  const composerMarker = `WEBTERM_COMPOSER_${randomBytes(6).toString('hex')}`;
  await sendAction(first.page, terminalID, 'follow_terminal_input');
  await sendCommand(first.page, terminalID, `trap 'printf "\\033[?25h\\033[?1049l"' EXIT INT TERM; printf '\\033[?1049h\\033[2J\\033[999;1H${composerMarker}\\033[H\\033[?25l'; sleep 30\r`);
  await first.page.waitForFunction((marker) => document.querySelector('.terminal-surface .xterm-rows')?.textContent?.includes(marker), composerMarker, { timeout: 10000 });
  await sendCommand(first.page, terminalID, '\u0003');
  await new Promise((resolve) => setTimeout(resolve, 500));

  await sendCommand(first.page, terminalID, `printf '${markerOne}\\n'\r`);
  await waitForCapture(sessionName, markerOne);
  if (tmux(['show-options', '-t', sessionName, 'window-size']).trim() !== 'window-size largest') {
    throw new Error('persistent tmux session did not fill the largest attached client');
  }
  if (tmux(['show-options', '-t', sessionName, 'mouse']).trim() !== 'mouse on') {
    throw new Error('persistent tmux session did not enable mouse forwarding for full-screen applications');
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
  const activeTab = second.page.getByText('1: persistent verification renamed', { exact: true });
  await activeTab.locator('span').last().click();
  if (expectPreservedTerminal) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    tmux(['has-session', '-t', sessionName]);
  } else {
    await waitForSessionGone(sessionName);
  }
  tmux(['has-session', '-t', distractorSessionName]);
  process.stdout.write(`${JSON.stringify({ persistentSession: sessionName, retainedAcrossReconnect: true, explicitTabClose: expectPreservedTerminal ? 'preserved-in-release-test' : 'terminates-session', unrelatedSessionRetained: true, windowSize: 'largest', smallClientComposerVisible: true, smallClientScaledGrid: smallScaling, largeClientGrid: largeScaling, tmuxClients: tmuxClients.trim().split('\n'), tmuxWindow, secondBounds, pageErrors: [] })}\n`);
} finally {
  if (first) { await first.context.close(); await first.browser.close(); }
  if (second) { await second.context.close(); await second.browser.close(); }
  if (sessionName) { try { tmux(['kill-session', '-t', sessionName]); } catch { /* session may not have started */ } }
  if (distractorSessionName) { try { tmux(['kill-session', '-t', distractorSessionName]); } catch { /* session may not have started */ } }
  if (controllerToken && loadTestUserID && controlPage) { try { await deleteTemporaryUser(controlPage, controllerToken, loadTestUserID); } catch (error) { console.error(`temporary user cleanup failed: ${error instanceof Error ? error.message : String(error)}`); } }
  if (controlContext) await controlContext.close();
  if (controlBrowser) await controlBrowser.close();
}
