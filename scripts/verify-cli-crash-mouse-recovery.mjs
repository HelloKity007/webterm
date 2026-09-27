import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '../ui/node_modules/playwright/index.mjs';
import { terminalViewportProbe } from './terminal-viewport-probe.mjs';

const origin = process.env.WEBTERM_QA_ORIGIN || 'https://192.168.11.87:9444';
const apiOrigin = process.env.WEBTERM_QA_API_ORIGIN || 'http://127.0.0.1:8889';
const expectedVersion = process.env.WEBTERM_QA_EXPECT_VERSION || 'e9867b7-mouse-guard-proactive';
const output = resolve(process.env.WEBTERM_QA_OUTPUT || 'runtime/cli-crash-mouse-recovery');
await mkdir(output, { recursive: true, mode: 0o700 });

let browser;
let context;
let terminalID = '';
let token = '';
let failure;
let lastLines = [];
const checks = [];

try {
  const session = await (await fetch(`${apiOrigin}/api/auth/test-session`, { method: 'POST' })).json();
  token = session.token;
  assert.equal(typeof token, 'string');
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const created = await (await fetch(`${apiOrigin}/api/terminal-sessions/2`, { method: 'POST', headers, body: '{}' })).json();
  terminalID = created.terminal_id;
  assert.match(terminalID, /^terminal-[a-f0-9]{32}$/);

  browser = await chromium.launch();
  context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1360, height: 900 } });
  await context.addInitScript(({ authToken, user }) => {
    localStorage.setItem('token', authToken);
    localStorage.setItem('webterm-user', JSON.stringify(user));
  }, { authToken: token, user: session.user });
  const paneID = 'cli-crash-qa-pane';
  const layout = { schema_version: 2, revision: 1, layout: { workspaceTabs: [{ id: 'cli-crash-qa-workspace', index: 97, name: 'CLI crash QA', layout: { tree: { type: 'leaf', id: paneID }, panes: { [paneID]: { tabs: [{ id: terminalID, type: 'ssh', title: 'CLI crash QA', connId: 2, labelNumber: 1 }], activeTabId: terminalID } }, focusedPaneId: paneID } }] } };
  await context.route('**/api/layout', route => route.fulfill({ json: layout }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(origin);
  const health = await page.evaluate(async () => await (await fetch('/api/health')).json());
  assert.equal(health.version, expectedVersion);
  const surface = page.locator('.terminal-surface');
  await surface.waitFor({ timeout: 10000 });
  const waitForText = async text => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const probe = await surface.evaluate(terminalViewportProbe, true);
      lastLines = probe.diagnostic.lines.map(line => line.text);
      if (probe.diagnostic.lines.some(line => line.text.includes(text))) return;
      await page.waitForTimeout(50);
    }
    throw new Error(`terminal did not display ${text}`);
  };
  const assertNoShellMouseLeak = async () => {
    const probe = await surface.evaluate(terminalViewportProbe, true);
    const lines = probe.diagnostic.lines.map(line => line.text);
    lastLines = lines;
    assert.equal(lines.some(line => /-bash: .*未找到命令|-bash: .*command not found/.test(line)), false, 'mouse report leaked into Bash');
  };
  const typeCommand = async command => {
    await surface.click({ position: { x: 50, y: 45 } });
    await page.keyboard.insertText(command);
    await page.keyboard.press('Enter');
  };

  // This intentionally models a container/CLI death: the program enables
  // all-motion SGR tracking, then exits without DEC reset. The WebSocket must
  // turn tracking off as soon as Bash's prompt output is observed, before the
  // next browser mouse event can reach readline.
  const box = await surface.boundingBox();
  assert.ok(box);
  for (let round = 1; round <= 3; round++) {
    await typeCommand(`python3 -c "import os,tty,time,termios; old=termios.tcgetattr(0); tty.setraw(0); os.write(1,b'\\x1b[?1003h\\x1b[?1006h'); time.sleep(.25); termios.tcsetattr(0,termios.TCSADRAIN,old)"`);
    await page.waitForTimeout(1200);
    await page.mouse.move(box.x + 100 + round * 15, box.y + 100 + round * 10);
    await page.mouse.move(box.x + 180 + round * 15, box.y + 130 + round * 10);
    const marker = `SHELL_AFTER_CRASH_OK_${round}`;
    await typeCommand(`printf "${marker}\\n"`);
    await waitForText(marker);
    await assertNoShellMouseLeak();
  }
  checks.push({ name: 'three CLI exits without DEC reset leave shell free of mouse bytes', status: 'PASS' });

  // Re-enter a CLI that reads exactly one SGR report. Its own DECSET output
  // must re-enable xterm's mouse reporting after the prior safety reset.
  await typeCommand(`python3 -c "import os,tty,termios; old=termios.tcgetattr(0); tty.setraw(0); os.write(1,b'\\x1b[?1003h\\x1b[?1006hCLI_MOUSE_READY\\r\\n'); os.read(0,64); termios.tcsetattr(0,termios.TCSADRAIN,old); os.write(1,b'\\r\\nCLI_MOUSE_REOPEN_OK\\r\\n')"`);
  await waitForText('CLI_MOUSE_READY');
  await page.mouse.move(box.x + 220, box.y + 160);
  await waitForText('CLI_MOUSE_REOPEN_OK');
  checks.push({ name: 'subsequent CLI DECSET re-enables mouse reporting', status: 'PASS' });
  assert.deepEqual(errors, []);
  await page.screenshot({ path: resolve(output, 'cli-crash-mouse-recovery.png') });
} catch (error) {
  failure = String(error);
} finally {
  if (context) await context.close();
  if (browser) await browser.close();
  if (terminalID && token && process.env.WEBTERM_QA_KEEP_FIXTURE !== '1') {
    try {
      await fetch(`${apiOrigin}/api/terminal-sessions/2?terminal_id=${encodeURIComponent(terminalID)}&terminate=1`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    } catch { /* Exact disposable QA session only. */ }
  }
  await writeFile(resolve(output, 'report.json'), JSON.stringify({ status: failure ? 'FAIL' : 'PASS', failure, expectedVersion, terminalID, checks, lastLines, isolation: 'server-created terminal ID, release-test endpoint/socket, exact-session cleanup only' }, null, 2), { mode: 0o600 });
}

if (failure) {
  console.error(failure);
  process.exitCode = 1;
} else {
  console.log(`PASS: ${checks.map(check => check.name).join('; ')}`);
}
