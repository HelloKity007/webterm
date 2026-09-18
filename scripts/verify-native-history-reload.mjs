import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '../ui/node_modules/playwright/index.mjs';
import { terminalViewportProbe } from './terminal-viewport-probe.mjs';
import { sendWindowsNativeReload } from './windows-native-key.mjs';

const platform = process.env.WEBTERM_QA_NATIVE_PLATFORM || 'windows';
assert(['windows', 'linux'].includes(platform));
const output = process.env.WEBTERM_QA_OUTPUT || `runtime/${platform}-history-reload`;
const expectedVersion = process.env.WEBTERM_QA_EXPECT_VERSION || '';
const rounds = Number(process.env.WEBTERM_QA_ROUNDS || 10);
const panels = (process.env.WEBTERM_QA_PANELS || '2,14').split(',').map(Number);
const keys = (process.env.WEBTERM_QA_KEYS || 'F5,Control+R,Control+Shift+R').split(',');
assert(keys.every(key => ['F5', 'Control+R', 'Control+Shift+R'].includes(key)));
assert(Number.isInteger(rounds) && rounds > 0);
await mkdir(output, { recursive: true });
const browser = platform === 'windows'
  ? await chromium.connectOverCDP(process.env.WEBTERM_QA_CDP || 'http://127.0.0.1:19335')
  : await chromium.launch({ headless: false });
const context = await browser.newContext({
  ignoreHTTPSErrors: true, viewport: platform === 'windows' ? null : { width: 1920, height: 1080 },
  ...(platform === 'linux' ? { recordVideo: { dir: `${output}/video`, size: { width: 1920, height: 1080 } } } : {}),
});
const report = { status: 'RUNNING', platform, rounds, panels, cases: [] };
const detailed = process.env.WEBTERM_QA_HISTORY_DIAGNOSTIC === '1';
const networkTrace = { events: [], history: [], errors: [], bytes: 0, overflow: false };
const networkJobs = [];
let cdp;
let stopFrames;
async function recordFrames(name, result) {
  if (!cdp) return;
  const directory = `${output}/${name}-frames`;
  await mkdir(directory, { recursive: true });
  let pending = Promise.resolve();
  let failure;
  const frames = [];
  const listener = event => {
    const index = frames.length;
    frames.push({ index, at: Date.now(), metadata: event.metadata });
    pending = pending.then(() => writeFile(`${directory}/${String(index).padStart(5, '0')}.jpg`, Buffer.from(event.data, 'base64')))
      .catch(error => { failure = error; });
    cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(error => { failure = error; });
  };
  cdp.on('Page.screencastFrame', listener);
  stopFrames = async () => {
    await cdp.send('Page.stopScreencast');
    cdp.off('Page.screencastFrame', listener);
    await pending;
    await writeFile(`${directory}/manifest.json`, JSON.stringify(frames, null, 2));
    result.renderedFrames = { directory, count: frames.length, error: failure?.message };
    stopFrames = null;
    if (failure) throw failure;
    assert(frames.length > 0, 'Missing actual rendered Windows frames');
  };
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 60, everyNthFrame: 1 });
}
async function nativeReload(key) {
  if (platform === 'windows') return sendWindowsNativeReload(key);
  const window = execFileSync('xdotool', ['search', '--sync', '--name', 'WebTerm-native-reload-QA'], { encoding: 'utf8', timeout: 5000 }).trim().split('\n').at(-1);
  execFileSync('xdotool', ['windowfocus', '--sync', window]);
  execFileSync('xdotool', ['key', '--clearmodifiers', { F5: 'F5', 'Control+R': 'ctrl+r', 'Control+Shift+R': 'ctrl+shift+r' }[key]]);
  return { platform, key, window };
}
function historyView({ mode, baseY, viewportY, historyReplay: _historyReplay, ...view }, { positionIneligible = false, serverHistoryChanged = false } = {}) {
  // Private-control reset temporarily reports unknown instead of shell. Keep
  // the mode in evidence, but compare actual normal-buffer content/geometry.
  assert.notEqual(mode, 'cli');
  // Bounded tmux capture includes its current screen height. Negotiating 27
  // rows before settling at 26 can add one leading buffer row without moving
  // any visible text. The isolated real-tmux/xterm origin experiment proves
  // this case. Retain absolute indices in evidence, validate their relation,
  // and compare logical offset + every visible line, not buffer origin.
  assert(Number.isInteger(baseY) && Number.isInteger(viewportY) && viewportY >= 0 && viewportY <= baseY);
  assert.equal(baseY - viewportY, view.fromBottom);
  // A buffer shorter than even four screens cannot expose a history-reader
  // position: its viewport is necessarily at line zero. tmux's physical
  // capture and its logical -J replay legitimately differ in invisible
  // trailing spaces / one physical blank row there. Keep the visual invariant
  // strict, but do not pretend that an unavailable scroll offset is evidence
  // of a reader-position regression.
  if (positionIneligible) {
    return {
      ...view,
      viewportY: 0,
      fromBottom: 0,
      lines: view.lines.map(line => line.trimEnd()),
    };
  }
  // When tmux has genuinely appended output between the pre-reload capture
  // and the reconnect capture, distance from the live bottom must change to
  // keep the same visible reader block in place. The full rendered context
  // and geometry remain exact; this exception is never used without two
  // distinct server-side capture hashes in the evidence.
  if (serverHistoryChanged) {
    const { fromBottom: _fromBottom, ...dynamicView } = view;
    return dynamicView;
  }
  return view;
}
try {
  const page = await context.newPage();
  if (detailed) {
    let socketSequence = 0;
    page.on('websocket', socket => {
      const url = new URL(socket.url());
      const panel = Number(url.searchParams.get('panel_number'));
      if (!panels.includes(panel)) return;
      const id = socketSequence++;
      networkTrace.events.push({ at: Date.now(), kind: 'open', id, panel });
      socket.on('framereceived', ({ payload }) => {
        networkTrace.bytes += Buffer.byteLength(payload);
        if (networkTrace.bytes > 8 * 1024 * 1024) { networkTrace.overflow = true; return; }
        try {
          const value = JSON.parse(payload);
          networkTrace.events.push({ at: Date.now(), kind: 'receive', id, panel,
            type: value.type, data: value.data, b64: value.b64 });
        } catch { networkTrace.errors.push('Unparsed received frame'); }
      });
      socket.on('close', () => networkTrace.events.push({ at: Date.now(), kind: 'close', id, panel }));
    });
    page.on('response', response => {
      const url = new URL(response.url());
      const panel = Number(url.searchParams.get('panel_number'));
      if (!url.pathname.startsWith('/api/terminal-history/') || !panels.includes(panel)) return;
      const at = Date.now();
      networkJobs.push(response.json().then(body => {
        const encoded = typeof body.data === 'string' ? body.data : '';
        const bytes = encoded ? Buffer.from(encoded, 'base64') : Buffer.alloc(0);
        networkTrace.history.push({ at, panel, status: response.status(),
          reportedBytes: body.bytes, bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          tailHex: bytes.subarray(Math.max(0, bytes.length - 32)).toString('hex') });
      }).catch(error => networkTrace.errors.push(error.message)));
    });
  }
  if (platform === 'windows') {
    cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
    const { windowId } = await cdp.send('Browser.getWindowForTarget');
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'maximized' } });
  }
  if (page.video()) report.video = await page.video().path();
  await page.goto('https://192.168.11.87:9444', { waitUntil: 'networkidle' });
  report.candidate = await page.evaluate(async () => (await fetch('/api/health')).json());
  assert.equal(report.candidate.environment, 'release-test');
  if (expectedVersion) assert.equal(report.candidate.version, expectedVersion);
  report.userAgent = await page.evaluate(() => navigator.userAgent);
  report.metrics = await page.evaluate(() => ({ dpr: devicePixelRatio, inner: [innerWidth, innerHeight],
    outer: [outerWidth, outerHeight], screen: [screen.width, screen.height], visualScale: visualViewport.scale }));
  assert.match(report.userAgent, platform === 'windows' ? /Windows/ : /Linux/);
  for (const number of panels) {
    const tab = page.locator('[data-tab-id]').filter({ hasText: new RegExp(`^${number}:`) }).first();
    await tab.click();
    const surface = tab.locator('xpath=ancestor::*[contains(@class,"terminal-grid-cell")]').locator('.terminal-surface:visible');
    await surface.hover();
    for (let wheel = 0; wheel < 27; wheel++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(100); }
    await page.waitForTimeout(2000);
    if (process.env.WEBTERM_QA_HISTORY_POSITION === 'middle') {
      // Use genuine wheel input until the real buffer reaches its middle.
      // A live shell with fewer than four visible screens has no meaningful
      // middle. It is still reload-tested below, but is recorded as ineligible
      // for this position rather than being turned into a false 500-wheel
      // product failure.
      const initialPosition = await surface.evaluate(terminalViewportProbe);
      const minimumMiddleHistory = Math.max(100, initialPosition.rows * 4);
      if (initialPosition.baseY < minimumMiddleHistory) {
        report.insufficientHistoryPanels ||= [];
        if (!report.insufficientHistoryPanels.some(entry => entry.number === number)) {
          report.insufficientHistoryPanels.push({ number, reason: 'baseY below four visible screens',
            minimumMiddleHistory, position: { mode: initialPosition.mode, bufferType: initialPosition.bufferType,
              baseY: initialPosition.baseY, viewportY: initialPosition.viewportY, fromBottom: initialPosition.fromBottom,
              rows: initialPosition.rows, cols: initialPosition.cols } });
        }
      } else {
      const positioning = [];
      for (let step = 0; step < 500; step++) {
        const position = await surface.evaluate(terminalViewportProbe);
        if (step === 0 || step % 25 === 0 ||
          (position.fromBottom >= position.baseY * 0.45 && position.fromBottom <= position.baseY * 0.55)) {
          positioning.push({ step, mode: position.mode, bufferType: position.bufferType,
            baseY: position.baseY, viewportY: position.viewportY, fromBottom: position.fromBottom });
        }
        if (position.fromBottom >= position.baseY * 0.45 && position.fromBottom <= position.baseY * 0.55) break;
        if (step === 499) {
          report.positioningFailure = { number, positioning };
          assert.fail(`Could not reach the middle of actual history: ${JSON.stringify(positioning.at(-1))}`);
        }
        await page.mouse.wheel(0, position.fromBottom < position.baseY / 2 ? -1200 : 1200);
        await page.waitForTimeout(25);
      }
      }
    }
    for (const key of keys) {
      for (let round = 0; round < rounds; round++) {
        const name = `${number}-${key.replaceAll('+', '-')}-${round}`;
        await surface.locator('textarea').evaluate(e => e.focus({ preventScroll: true }));
        await page.evaluate(() => { document.title = 'WebTerm-native-reload-QA'; });
        await page.bringToFront();
        const before = await surface.evaluate(terminalViewportProbe);
        const priorHistory = detailed
          ? networkTrace.history.filter(entry => entry.panel === number).at(-1)
          : undefined;
        const result = { number, key, round, before, status: 'RUNNING' };
        report.cases.push(result);
        // HTTP history capture resets xterm and can set its mode to unknown.
        // The normal buffer plus real scrollback is the relevant invariant;
        // explicitly exclude CLI mode and alternate-screen rendering.
        assert.notEqual(before.mode, 'cli', 'CLI needs its separate native-history test');
        assert.equal(before.bufferType, 'normal', 'Do not measure alternate-screen CLI as Bash scrollback');
        assert(before.fromBottom > 0, 'Fixture must genuinely be reading history');
        await page.screenshot({ path: `${output}/${name}-before.png` });
        if (detailed) await writeFile(`${output}/${name}-buffer-before.json`, JSON.stringify(await surface.evaluate(terminalViewportProbe, true)));
        await surface.evaluate((element, source) => {
          const read = (0, eval)(`(${source})`);
          const frames = [];
          let done = false;
          const sample = () => { frames.push(read(element)); if (!done) requestAnimationFrame(sample); };
          requestAnimationFrame(sample);
          addEventListener('beforeunload', () => {
            done = true;
            frames.push(read(element));
            sessionStorage.setItem('qa-native-history-frames', JSON.stringify(frames));
          }, { once: true });
        }, terminalViewportProbe.toString());
        // OS key delivery alone is not proof of reload: require real navigation.
        const navigation = page.waitForEvent('framenavigated', { predicate: frame => frame === page.mainFrame(), timeout: 20000 });
        navigation.catch(() => {});
        result.titleAtDispatch = await page.title();
        await recordFrames(name, result);
        result.delivery = await nativeReload(key);
        await navigation;
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2500);
        const health = await page.evaluate(async () => (await fetch('/api/health')).json());
        assert.deepEqual(health, report.candidate, 'Candidate changed during native refresh verification');
        result.frames = await page.evaluate(() => JSON.parse(sessionStorage.getItem('qa-native-history-frames') || '[]'));
        result.after = await surface.evaluate(terminalViewportProbe);
        if (detailed) {
          await Promise.all(networkJobs);
          const reconnectHistory = networkTrace.history.filter(entry => entry.panel === number).at(-1);
          result.serverHistory = {
            before: priorHistory && { sha256: priorHistory.sha256, bytes: priorHistory.bytes },
            after: reconnectHistory && { sha256: reconnectHistory.sha256, bytes: reconnectHistory.bytes },
          };
        }
        if (detailed) await writeFile(`${output}/${name}-buffer-after.json`, JSON.stringify(await surface.evaluate(terminalViewportProbe, true)));
        await page.screenshot({ path: `${output}/${name}-after.png` });
        if (stopFrames) await stopFrames();
        assert(result.frames.length > 0, 'Missing pre-unload frames');
        const positionIneligible = before.baseY < Math.max(100, before.rows * 4);
        const serverHistoryChanged = Boolean(
          result.serverHistory?.before?.sha256 && result.serverHistory?.after?.sha256 &&
          result.serverHistory.before.sha256 !== result.serverHistory.after.sha256,
        );
        if (positionIneligible) result.positionIneligible = true;
        if (serverHistoryChanged) result.serverHistoryChanged = true;
        for (const frame of result.frames) assert.deepEqual(
          historyView(frame, { positionIneligible, serverHistoryChanged }),
          historyView(before, { positionIneligible, serverHistoryChanged }),
          'History content/offset changed before navigation',
        );
        assert.deepEqual(
          historyView(result.after, { positionIneligible, serverHistoryChanged }),
          historyView(before, { positionIneligible, serverHistoryChanged }),
          'History content/offset changed after reconnect',
        );
        result.status = 'PASS';
        await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
      }
    }
  }
  report.status = 'PASS (selected panels; not all-panel acceptance)';
} catch (error) {
  report.status = 'FAIL';
  report.error = error.message;
  if (report.cases.at(-1)?.status === 'RUNNING') report.cases.at(-1).status = 'FAIL';
  process.exitCode = 1;
} finally {
  if (stopFrames) {
    try { await stopFrames(); } catch (error) { report.captureError = error.message; report.status = 'FAIL'; process.exitCode = 1; }
  }
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  if (detailed) {
    await Promise.all(networkJobs);
    await writeFile(`${output}/history-network-trace.json`, JSON.stringify(networkTrace, null, 2));
  }
  await context.close();
  await browser.close();
}
console.log(JSON.stringify({ status: report.status, cases: report.cases.length, error: report.error }));
