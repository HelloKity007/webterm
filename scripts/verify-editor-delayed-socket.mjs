import assert from 'node:assert/strict';
import { createServer as httpServer } from 'node:http';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from '../ui/node_modules/vite/dist/node/index.js';
import { chromium } from '../ui/node_modules/playwright/index.mjs';
const require = createRequire(import.meta.url);
const { wsServer: WebSocketServer } = require('../ui/node_modules/playwright-core/lib/utilsBundle.js');
const output = process.env.WEBTERM_QA_OUTPUT || 'runtime/incident-20260917-production-tmux/editor-delayed-socket';
const baseline = process.env.WEBTERM_QA_BASELINE === '1';
await mkdir(output, { recursive: true });
const events = [], errors = [], upgrades = [], sockets = [];
const server = httpServer();
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (request, socket, head) => { upgrades.push(() => wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws))); });
wss.on('connection', ws => {
  sockets.push(ws);
  events.push({ type: 'open', at: Date.now() });
  ws.on('message', raw => {
    const value = JSON.parse(String(raw));
    events.push({ type: 'request', at: Date.now(), ...value });
    if (value.action === 'read') ws.send(JSON.stringify({ type: 'file_content', path: value.path, content: 'Delayed handshake fixture\nNo remote files touched.', revision: 'fixture-v1' }));
    else if (value.action === 'stat') ws.send(JSON.stringify({ type: 'file_stat', path: value.path, revision: 'fixture-v1' }));
    else throw new Error('Unexpected write/action: ' + value.action);
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const socketURL = `ws://127.0.0.1:${server.address().port}`;
const editorPath = resolve('ui/src/components/common/FileEditor.tsx');
const fixture = `import React from 'react';import {createRoot} from 'react-dom/client';import FileEditor from '/src/components/common/FileEditor.tsx';
const ws=new WebSocket(${JSON.stringify(socketURL)});window.fixtureSocket=ws;
createRoot(document.getElementById('root')).render(React.createElement(React.Fragment,null,React.createElement('h1',{id:'root-sentinel'},'Application root alive'),React.createElement('div',{style:{height:600}},React.createElement(FileEditor,{filePath:'/fixture.txt',fileName:'fixture.txt',ws,refreshMode:'auto',onRefreshModeChange:()=>{},onClose:()=>{},onSaved:()=>{},embedded:true}))));`;
const vite = await createServer({ configFile: false, root: resolve('ui'), server: { host: '127.0.0.1', port: 0 }, esbuild: { jsx: 'automatic' }, plugins: [{
  name: 'isolated-real-editor-fixture', enforce: 'pre',
  resolveId(id) { if (id === '/qa-entry.jsx') return '\0qa-entry.jsx'; },
  load(id) { if (id === '\0qa-entry.jsx') return fixture; if (baseline && id === editorPath) return execFileSync('git', ['show', 'HEAD:ui/src/components/common/FileEditor.tsx'], { encoding: 'utf8' }); },
  configureServer(s) { s.middlewares.use((req, res, next) => { if (req.url !== '/') return next(); res.setHeader('Content-Type', 'text/html');res.end('<html><body style="background:#14221a;color:white"><div id="root"></div><script type="module" src="/qa-entry.jsx"></script></body></html>'); }); },
}] });
await vite.listen();
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, recordVideo: { dir: `${output}/video` } });
const page = await context.newPage();
page.on('pageerror', e => errors.push(String(e)));
let failure;
try {
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}`);
  await page.waitForFunction(() => window.fixtureSocket?.readyState === WebSocket.CONNECTING);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${output}/connecting.png` });
  const before = { state: await page.evaluate(() => window.fixtureSocket.readyState), rootAlive: await page.locator('#root-sentinel').count(), events: [...events], errors: [...errors] };
  await writeFile(`${output}/before.json`, JSON.stringify(before, null, 2));
  assert.equal(before.rootAlive, 1, 'Application root must survive CONNECTING');
  assert.deepEqual(errors, [], 'No uncaught CONNECTING send error');
  assert.deepEqual(events, [], 'No request before server handshake');
  assert.equal(upgrades.length, 1);
  upgrades.shift()();
  await page.locator('.cm-content').filter({ hasText: 'Delayed handshake fixture' }).waitFor();
  await page.screenshot({ path: `${output}/loaded.png` });
  assert.equal(events.filter(e => e.action === 'read').length, 1);
  assert.equal(events.filter(e => e.action === 'write').length, 0);
  assert.deepEqual(errors, []);
  assert.equal(await page.locator('#root-sentinel').count(), 1);
} catch (error) { failure = String(error); }
finally {
  await writeFile(`${output}/report.json`, JSON.stringify({ baseline, status: failure ? 'FAIL' : 'PASS', failure, events, errors, scope: 'Real FileEditor and browser native WebSocket; local delayed server upgrade; no production or remote filesystem access' }, null, 2));
  await context.close(); await browser.close(); await vite.close();
  for (const socket of sockets) socket.terminate();
  server.closeAllConnections(); server.close(); wss.close();
}
if (failure) { console.error(failure); process.exitCode = 1; }
else console.log('PASS: root survives delayed native WebSocket handshake; exactly one read after OPEN, zero writes');
