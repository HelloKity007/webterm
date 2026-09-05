import playwright from '../ui/node_modules/@playwright/test/index.js';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const { chromium } = playwright;
const baseURL = (process.env.WEBTERM_BASE_URL || '').replace(/\/$/, '');
const username = process.env.WEBTERM_LOADTEST_USERNAME || '';
const password = process.env.WEBTERM_LOADTEST_PASSWORD || '';
const chromePath = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const timeout = 30000;
const selectionFixture = fileURLToPath(new URL('./fixtures/synthetic-selection-tui.mjs', import.meta.url));
if (!baseURL || !username || !password) throw new Error('missing WebTerm verification environment');

async function api(page, token, path, options = {}) {
  const result = await page.evaluate(async ({ token, path, options }) => {
    const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } });
    return { status: response.status, text: await response.text() };
  }, { token, path, options });
  if (result.status < 200 || result.status >= 300) throw new Error(`${path} returned ${result.status}`);
  return result.text ? JSON.parse(result.text) : null;
}

async function login(page, loginUsername, loginPassword) {
  const result = await page.evaluate(async ({ loginUsername, loginPassword }) => {
    const response = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: loginUsername, password: loginPassword }),
    });
    return { status: response.status, text: await response.text() };
  }, { loginUsername, loginPassword });
  if (result.status !== 200) throw new Error(`login returned ${result.status}`);
  return JSON.parse(result.text);
}

function capture(sessionName) {
  return execFileSync('tmux', ['capture-pane', '-p', '-t', sessionName], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function captureHistory(sessionName) {
  return execFileSync('tmux', ['capture-pane', '-p', '-S', '-', '-t', sessionName], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function paneHistory(sessionName, format) {
  return Number(execFileSync('tmux', ['display-message', '-p', '-t', sessionName, format], { encoding: 'utf8' }).trim());
}

function paneCount(sessionName) {
  return execFileSync('tmux', ['list-panes', '-t', sessionName, '-F', '#{pane_id}'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).length;
}

function paneCurrentCommand(sessionName) {
  return execFileSync('tmux', ['display-message', '-p', '-t', sessionName, '#{pane_current_command}'], { encoding: 'utf8' }).trim();
}

async function waitForCapture(sessionName, marker) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (capture(sessionName).includes(marker)) return; } catch { /* session is starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`terminal never received pasted marker ${marker}`);
}

async function waitForCaptureLine(sessionName, marker) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (capture(sessionName).split('\n').some((line) => line.trim() === marker)) return;
    } catch { /* session is starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`terminal never executed keyboard marker ${marker}`);
}

let browser;
let context;
let page;
let controllerToken;
let temporaryUserID;
let sessionName;
const pageErrors = [];

try {
  browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox'] });
  context = await browser.newContext({ ignoreHTTPSErrors: true });
  page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(`${baseURL}/`, { waitUntil: 'domcontentloaded', timeout });
  controllerToken = (await login(page, username, password)).token;

  const temporaryUsername = `context-menu-test-${Date.now()}-${randomBytes(3).toString('hex')}`;
  const temporaryPassword = randomBytes(24).toString('base64url');
  temporaryUserID = (await api(page, controllerToken, '/api/users', {
    method: 'POST', body: JSON.stringify({ username: temporaryUsername, password: temporaryPassword, role: 'admin' }),
  })).id;
  const temporaryLogin = await login(page, temporaryUsername, temporaryPassword);
  const token = temporaryLogin.token;
  const connection = await api(page, token, '/api/quick-connect/local', { method: 'POST', body: '{}' });
  const terminalID = `context-menu-tab-${randomBytes(8).toString('hex')}`;
  sessionName = `wt-${temporaryUserID}-${connection.connection.id}-${createHash('sha256').update(terminalID).digest('hex').slice(0, 16)}`;
  const current = await api(page, token, '/api/layout');
  await api(page, token, '/api/layout', {
    method: 'PUT',
    body: JSON.stringify({
      schema_version: 1, revision: current.revision,
      layout: { tree: { type: 'leaf', id: 'root' }, panes: { root: { tabs: [
        { id: terminalID, type: 'ssh', title: 'context menu verification', connId: connection.connection.id, labelNumber: 1 },
      ], activeTabId: terminalID } }, focusedPaneId: 'root' },
    }),
  });

  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL });
  await page.addInitScript(({ token, user }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('webterm-user', JSON.stringify(user));
    window.__terminalVerificationSends = [];
    const originalSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function verificationSend(data) {
      if (typeof data === 'string') window.__terminalVerificationSends.push(data);
      return originalSend.call(this, data);
    };
  }, { token, user: temporaryLogin.user });
  await page.reload({ waitUntil: 'domcontentloaded', timeout });
  await page.waitForFunction((id) => typeof window[`webterm-ws-${id}`] === 'function', terminalID, { timeout });
  const screen = page.locator('.xterm-screen');
  await screen.waitFor({ state: 'visible', timeout });
  await page.getByTitle('展开侧边栏').waitFor({ state: 'visible', timeout });
  await page.getByTitle('展开 SFTP').waitFor({ state: 'visible', timeout });
  const box = await screen.boundingBox();
  if (!box) throw new Error('terminal screen has no bounds');

  const keyboardMarker = `WEBTERM_KEYBOARD_INPUT_${randomBytes(6).toString('hex')}`;
  await page.evaluate(() => {
    document.querySelector('.xterm-helper-textarea')?.blur();
    document.body.tabIndex = -1;
    document.body.focus();
  });
  await screen.click({ position: { x: Math.min(80, box.width / 4), y: Math.min(80, box.height / 4) } });
  const focusedClass = await page.evaluate(() => document.activeElement?.className || '');
  if (!String(focusedClass).includes('xterm-helper-textarea')) {
    throw new Error(`plain terminal click did not focus keyboard input: ${focusedClass}`);
  }
  await page.keyboard.type(`echo ${keyboardMarker}`);
  await page.keyboard.press('Enter');
  await waitForCaptureLine(sessionName, keyboardMarker);

  await page.keyboard.type('sleep 30');
  await page.keyboard.press('Enter');
  const sleepStartDeadline = Date.now() + 3000;
  while (Date.now() < sleepStartDeadline && paneCurrentCommand(sessionName) !== 'sleep') {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (paneCurrentCommand(sessionName) !== 'sleep') throw new Error('interrupt check never entered sleep');
  await page.evaluate(() => { window.__terminalVerificationSends = []; });
  await page.keyboard.press('Control+C');
  const interruptDeadline = Date.now() + 3000;
  while (Date.now() < interruptDeadline && paneCurrentCommand(sessionName) === 'sleep') {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const interruptMessages = await page.evaluate(() => window.__terminalVerificationSends);
  if (paneCurrentCommand(sessionName) === 'sleep') {
    throw new Error(`Ctrl+C did not interrupt sleep: ${JSON.stringify(interruptMessages)}`);
  }

  if (process.env.WEBTERM_KEYBOARD_ONLY === '1') {
    process.stdout.write(`${JSON.stringify({ keyboardInputAndEnter: 'ok', ctrlCInterrupt: 'ok', interruptMessages, pageErrors })}\n`);
  } else {
  const copyMarker = `WEBTERM_CONTEXT_COPY_${randomBytes(6).toString('hex')}`;
  await page.evaluate(({ id, marker }) => {
    window[`webterm-ws-${id}`](JSON.stringify({ data: `printf '${marker}\\n'\r` }));
  }, { id: terminalID, marker: copyMarker });
  await waitForCapture(sessionName, copyMarker);
  await new Promise((resolve) => setTimeout(resolve, 300));

  await screen.click({ button: 'right', position: { x: box.width / 2, y: box.height / 2 } });
  await page.getByText('复制', { exact: true }).waitFor({ state: 'visible', timeout });
  if (await page.getByText('复制', { exact: true }).count() !== 1 || await page.getByText('粘贴', { exact: true }).count() !== 1) {
    throw new Error('plain right-click did not show exactly one frontend menu');
  }
  await page.screenshot({ path: '/tmp/webterm-plain-right-click.png' });
  await page.mouse.click(box.x + 8, box.y + 8);
  await page.getByText('复制', { exact: true }).waitFor({ state: 'hidden', timeout });

  await page.mouse.move(box.x + 8, box.y + 15);
  await page.mouse.down();
  await page.mouse.move(box.x + Math.min(500, box.width - 8), box.y + 15, { steps: 8 });
  await page.mouse.up();
  if (await page.locator('.xterm-selection div').count() === 0) {
    throw new Error('plain left drag did not create an xterm selection');
  }

  await page.evaluate(() => {
    window.__terminalCopyShortcutDefaultPrevented = null;
    const textarea = document.querySelector('.xterm-helper-textarea');
    const observeCopyShortcut = (event) => {
      if (!event.ctrlKey || !event.shiftKey || event.key.toLowerCase() !== 'c') return;
      textarea.removeEventListener('keydown', observeCopyShortcut, true);
      setTimeout(() => {
        window.__terminalCopyShortcutDefaultPrevented = event.defaultPrevented;
      }, 0);
    };
    textarea?.addEventListener('keydown', observeCopyShortcut, true);
  });
  await page.keyboard.press('Control+Shift+C');
  await page.getByRole('status').filter({ hasText: '已复制' }).waitFor({ state: 'visible', timeout });
  await page.waitForFunction(() => window.__terminalCopyShortcutDefaultPrevented !== null, null, { timeout });
  const copyShortcutDefaultPrevented = await page.evaluate(() => window.__terminalCopyShortcutDefaultPrevented);
  if (copyShortcutDefaultPrevented !== true) {
    throw new Error('Ctrl+Shift+C did not suppress the browser developer-tools shortcut');
  }
  const shortcutCopied = await page.evaluate(() => navigator.clipboard.readText());
  if (!shortcutCopied) throw new Error('Ctrl+Shift+C left the clipboard empty');

  await screen.click({ button: 'right', position: { x: box.width / 2, y: box.height / 2 } });
  await page.getByText('复制', { exact: true }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  if (!copied) throw new Error('frontend Copy left the clipboard empty');

  await screen.click({ position: { x: Math.min(80, box.width / 4), y: Math.min(80, box.height / 4) } });
  await page.keyboard.type(`node ${JSON.stringify(selectionFixture)}`);
  await page.keyboard.press('Enter');
  await waitForCapture(sessionName, 'SYNTHETIC_CLI_SELECT_ROW_03');
  const terminalRows = paneHistory(sessionName, '#{window_height}');
  const rowHeight = box.height / terminalRows;
  await page.evaluate(() => { window.__terminalVerificationSends = []; });
  await page.getByRole('button', { name: '选择并复制' }).click();
  await page.mouse.move(box.x + 4, box.y + rowHeight * 2.5);
  await page.mouse.down();
  await page.mouse.move(box.x + Math.min(410, box.width - 8), box.y + rowHeight * 2.5, { steps: 8 });
  await page.mouse.up();
  await page.getByRole('status').filter({ hasText: '已复制' }).waitFor({ state: 'visible', timeout });
  const tuiCopied = await page.evaluate(() => navigator.clipboard.readText());
  if (!tuiCopied.includes('SYNTHETIC_CLI_SELECT_ROW_03')) {
    throw new Error(`select-and-copy mode copied the wrong fullscreen TUI text: ${JSON.stringify(tuiCopied)}`);
  }
  const selectionMessages = await page.evaluate(() => window.__terminalVerificationSends);
  if (selectionMessages.some((message) => message.includes('\\u001b[<'))) {
    throw new Error(`select-and-copy leaked mouse reports into fullscreen TUI: ${JSON.stringify(selectionMessages)}`);
  }
  await page.evaluate((id) => window[`webterm-ws-${id}`](JSON.stringify({ data: '\u0004' })), terminalID);
  const selectionExitDeadline = Date.now() + 3000;
  while (Date.now() < selectionExitDeadline && paneCurrentCommand(sessionName) !== 'bash') {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (paneCurrentCommand(sessionName) !== 'bash') throw new Error('synthetic selection TUI did not exit');

  const shortcutPasteMarker = `WEBTERM_SHORTCUT_PASTE_${randomBytes(6).toString('hex')}`;
  await page.evaluate((marker) => navigator.clipboard.writeText(marker), shortcutPasteMarker);
  await page.evaluate(() => { window.__terminalVerificationSends = []; });
  await page.keyboard.press('Control+Shift+V');
  try {
    await waitForCapture(sessionName, shortcutPasteMarker);
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      activeElement: document.activeElement?.className || document.activeElement?.tagName,
      notices: Array.from(document.querySelectorAll('[role="status"]')).map((node) => node.textContent),
      sends: window.__terminalVerificationSends,
    }));
    throw new Error(`${error.message}; browser=${JSON.stringify(diagnostic)}`);
  }
  const shortcutPasteMessages = await page.evaluate(() => window.__terminalVerificationSends);
  const shortcutPasteData = shortcutPasteMessages.map((message) => {
    try { return JSON.parse(message).data || ''; } catch { return ''; }
  }).join('');
  const shortcutPasteOccurrences = shortcutPasteData.split(shortcutPasteMarker).length - 1;
  if (shortcutPasteOccurrences !== 1) {
    throw new Error(`Ctrl+Shift+V pasted ${shortcutPasteOccurrences} copies: ${JSON.stringify(shortcutPasteMessages)}`);
  }
  await page.evaluate((id) => window[`webterm-ws-${id}`](JSON.stringify({ data: '\u0003' })), terminalID);

  const pasteMarker = `WEBTERM_CONTEXT_PASTE_${randomBytes(6).toString('hex')}`;
  await page.evaluate((marker) => navigator.clipboard.writeText(marker), pasteMarker);
  await screen.click({ button: 'right', position: { x: box.width / 2, y: box.height / 2 } });
  await page.getByText('粘贴', { exact: true }).click();
  await waitForCapture(sessionName, pasteMarker);
  await page.evaluate((id) => window[`webterm-ws-${id}`](JSON.stringify({ data: '\u0003' })), terminalID);

  const clearMarker = `WEBTERM_CLEAR_HISTORY_${randomBytes(6).toString('hex')}`;
  await page.evaluate(({ id, marker }) => {
    window[`webterm-ws-${id}`](JSON.stringify({ data: `for i in $(seq 1 120); do echo ${marker}-$i; done\r` }));
  }, { id: terminalID, marker: clearMarker });
  await waitForCapture(sessionName, `${clearMarker}-120`);
  if (paneHistory(sessionName, '#{history_limit}') !== 200000) {
    throw new Error(`tmux history limit is ${paneHistory(sessionName, '#{history_limit}')}, want 200000`);
  }
  if (paneHistory(sessionName, '#{history_size}') < 1) throw new Error('history fixture did not create tmux scrollback');
  await screen.click({ button: 'right', position: { x: box.width / 2, y: box.height / 2 } });
  await page.getByText('清屏', { exact: true }).click();
  const clearDeadline = Date.now() + 5000;
  while (Date.now() < clearDeadline && (paneHistory(sessionName, '#{history_size}') !== 0 || captureHistory(sessionName).includes(clearMarker))) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (paneHistory(sessionName, '#{history_size}') !== 0 || captureHistory(sessionName).includes(clearMarker)) {
    throw new Error('frontend Clear did not remove the current tab tmux history');
  }
  const afterClearMarker = `WEBTERM_AFTER_CLEAR_${randomBytes(6).toString('hex')}`;
  await page.keyboard.type(`echo ${afterClearMarker}`);
  await page.keyboard.press('Enter');
  await waitForCaptureLine(sessionName, afterClearMarker);
  if (captureHistory(sessionName).includes(clearMarker)) throw new Error('cleared history returned after new terminal input');

  // Keep the clicked tmux cell blank so the standard menu has a stable shape;
  // clicking a populated cell conditionally inserts "Copy Line" above Split.
  await page.evaluate((id) => window[`webterm-ws-${id}`](JSON.stringify({ data: 'clear\r' })), terminalID);
  await new Promise((resolve) => setTimeout(resolve, 300));

  await page.keyboard.down('Control');
  await page.evaluate(() => { window.__terminalVerificationSends = []; });
  await screen.click({ button: 'right', position: { x: box.width / 2, y: box.height / 2 } });
  await page.keyboard.up('Control');
  await new Promise((resolve) => setTimeout(resolve, 150));
  const panesBeforeMenuSelection = paneCount(sessionName);
  await page.screenshot({ path: '/tmp/webterm-ctrl-right-before-move.png' });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 13, { steps: 4 });
  await new Promise((resolve) => setTimeout(resolve, 150));
  await page.screenshot({ path: '/tmp/webterm-ctrl-right-moved.png' });
  const ctrlRightClickMessages = await page.evaluate(() => window.__terminalVerificationSends);
  if (!ctrlRightClickMessages.some((message) => message.includes('\\u001b[<10;'))) {
    throw new Error(`Ctrl+right-click did not send tmux's menu-bound Alt+right mouse event: ${JSON.stringify(ctrlRightClickMessages)}`);
  }
  if (ctrlRightClickMessages.some((message) => message.includes('[<10;') && message.includes('m"}'))) {
    throw new Error(`Ctrl+right-click sent a release that closes the tmux menu: ${JSON.stringify(ctrlRightClickMessages)}`);
  }
  if (!ctrlRightClickMessages.some((message) => message.includes('\\u001b[<42;'))) {
    throw new Error(`moving over the tmux menu did not send a held right-button drag: ${JSON.stringify(ctrlRightClickMessages)}`);
  }
  if (await page.getByText('复制', { exact: true }).count() !== 0) {
    throw new Error('Ctrl+right-click incorrectly opened the frontend menu');
  }
  await page.screenshot({ path: '/tmp/webterm-ctrl-right-click.png' });
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2 + 13);
  const paneSelectionDeadline = Date.now() + 3000;
  while (Date.now() < paneSelectionDeadline && paneCount(sessionName) === panesBeforeMenuSelection) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (paneCount(sessionName) !== panesBeforeMenuSelection + 1) {
    const messagesAfterClick = await page.evaluate(() => window.__terminalVerificationSends);
    throw new Error(`plain left click did not activate the tmux Horizontal Split menu item: ${JSON.stringify(messagesAfterClick)}`);
  }

  await screen.click({ button: 'right', position: { x: box.width / 2, y: box.height / 2 } });
  await page.getByText('八分屏（上四下四）', { exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.xterm-screen').length === 8, null, { timeout });
  if (pageErrors.length > 0) throw new Error(`browser errors: ${pageErrors.join(' | ')}`);
  process.stdout.write(`${JSON.stringify({ defaultPanels: 'collapsed', keyboardInputAndEnter: 'ok', ctrlCInterrupt: 'ok', interruptMessages, plainRightClick: 'frontend-only', outsideClickClose: 'ok', plainLeftSelection: 'ok', fullscreenTuiSelectAndCopy: 'ok-no-mouse-leak', copyShortcutBrowserDefault: 'blocked', keyboardCopyPaste: 'single-copy', contextMenuCopyPaste: 'ok', clearCurrentTabHistory: 'ok', tmuxHistoryLimit: paneHistory(sessionName, '#{history_limit}'), ctrlRightClick: 'tmux-mouse-operable', ctrlRightClickMessages, eightPaneGrid: '4x2', pageErrors })}\n`);
  }
} finally {
  if (controllerToken && temporaryUserID && page) { try { await api(page, controllerToken, `/api/users/${temporaryUserID}`, { method: 'DELETE' }); } catch { /* cleanup best effort */ } }
  if (temporaryUserID) {
    try {
      const prefix = `wt-${temporaryUserID}-`;
      const sessions = execFileSync('tmux', ['list-sessions', '-F', '#{session_name}'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
        .trim().split('\n').filter((name) => name.startsWith(prefix));
      for (const name of sessions) execFileSync('tmux', ['kill-session', '-t', name], { stdio: 'ignore' });
    } catch { /* already gone */ }
  }
  if (context) await context.close();
  if (browser) await browser.close();
}
