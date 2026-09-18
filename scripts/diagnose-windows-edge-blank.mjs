import { chromium } from '../ui/node_modules/playwright/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { sendWindowsNativeReload } from './windows-native-key.mjs';

const output = `runtime/edge-blank-${Date.now()}`;
await mkdir(output, { recursive: true, mode: 0o700 });
const browser = await chromium.connectOverCDP('http://127.0.0.1:19335');
const context = browser.contexts()[0];
let page = context.pages().find(p => p.url().startsWith('https://192.168.11.87:9444/'));
const reused = !!page;
page ||= await context.newPage();
const events = [], rounds = [];
const safeURL = url => { try { const u = new URL(url); return u.origin + u.pathname; } catch { return 'unparseable'; } };
page.on('requestfailed', r => events.push({ time: Date.now(), type: 'requestfailed', url: safeURL(r.url()), error: r.failure()?.errorText }));
page.on('response', r => { if (r.status() >= 400 || r.request().resourceType() === 'document') events.push({ time: Date.now(), type: 'response', status: r.status(), url: safeURL(r.url()) }); });
page.on('pageerror', e => events.push({ time: Date.now(), type: 'pageerror', error: e.message }));
page.on('console', m => { if (['error', 'warning'].includes(m.type())) events.push({ time: Date.now(), type: 'console', level: m.type(), text: m.text().replace(/token=[^ &]+/g, 'token=REDACTED') }); });
page.on('websocket', ws => { events.push({ time: Date.now(), type: 'wsopen', url: safeURL(ws.url()) }); ws.on('close', () => events.push({ time: Date.now(), type: 'wsclose', url: safeURL(ws.url()) })); ws.on('socketerror', error => events.push({ time: Date.now(), type: 'wserror', error })); });
const cdp = await context.newCDPSession(page);
// This dedicated QA profile does not trust the LAN self-signed certificate.
// Preserve the initial certificate failure artifact; no system trust changes.
await cdp.send('Security.setIgnoreCertificateErrors', { ignore: true });
await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
let frames = 0, recording = false;
cdp.on('Page.screencastFrame', async event => {
  await cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
  if (recording && frames < 400) await writeFile(`${output}/frame-${String(frames++).padStart(4, '0')}.jpg`, Buffer.from(event.data, 'base64'));
});
const inspect = () => page.evaluate(() => ({ url: location.origin + location.pathname, ready: document.readyState, rootChildren: document.querySelector('#root')?.childElementCount, bodyNodes: document.body?.querySelectorAll('*').length, terminals: document.querySelectorAll('.xterm').length, visibleTerminals: [...document.querySelectorAll('.xterm')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.height && r.bottom > 0 && r.top < innerHeight; }).length, canvas: document.querySelectorAll('canvas').length, loginInputs: document.querySelectorAll('input[type=password]').length, inner: [innerWidth, innerHeight], dpr: devicePixelRatio, scale: visualViewport?.scale, ua: navigator.userAgent }));
let status = 'RUNNING', error;
try {
  if (!reused) await page.goto('https://192.168.11.87:9444/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  const health = await page.evaluate(() => fetch('/api/health').then(r => r.json()));
  if (health.environment !== 'release-test') throw new Error('Wrong environment');
  await writeFile(`${output}/initial.json`, JSON.stringify({ reused, health, state: await inspect() }, null, 2));
  await page.screenshot({ path: `${output}/initial.png` });
  for (let i = 0; i < Number(process.env.QA_ROUNDS || 12); i++) {
    if (!page.url().startsWith('https://192.168.11.87:9444/')) throw new Error('Target left test environment');
    await page.evaluate(() => { document.title = 'WebTerm-native-reload-QA'; });
    await page.bringToFront();
    const round = { index: i, before: await inspect(), started: Date.now() }; rounds.push(round);
    recording = true;
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 55, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 2 });
    const navigation = page.waitForEvent('framenavigated', { predicate: f => f === page.mainFrame(), timeout: 20000 }); navigation.catch(() => {});
    round.delivery = await sendWindowsNativeReload();
    try { await navigation; round.navigated = true; } catch { round.navigated = false; }
    await page.waitForTimeout(6000);
    round.after = await inspect();
    await page.screenshot({ path: `${output}/round-${i}.png` });
    recording = false; await cdp.send('Page.stopScreencast');
    round.blank = !round.after.rootChildren || round.after.bodyNodes < 10;
    await writeFile(`${output}/report.json`, JSON.stringify({ status, reused, rounds, events }, null, 2));
    console.log(JSON.stringify({ round: i, navigated: round.navigated, blank: round.blank, after: round.after }));
    if (!round.navigated || round.blank) { status = 'FAIL'; break; }
  }
  if (status === 'RUNNING') status = 'NOT_REPRODUCED';
} catch (e) { status = 'FAIL'; error = e.message; }
finally {
  recording = false; await cdp.send('Page.stopScreencast').catch(() => {});
  await writeFile(`${output}/report.json`, JSON.stringify({ status, error, reused, rounds, events }, null, 2));
  await cdp.detach(); await browser.close();
}
console.log(JSON.stringify({ output, status, error, rounds: rounds.length }));
