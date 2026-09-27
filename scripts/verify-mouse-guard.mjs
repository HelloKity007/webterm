import { chromium } from '../ui/node_modules/playwright/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const { reset, snapshot } = JSON.parse(Buffer.concat(chunks));
const browser = await chromium.launch();
const results = [];
const output = new URL('../runtime/mouse-guard-qa/', import.meta.url);
await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 650 } });
  for (const phase of ['initial', 'reload']) {
    if (phase === 'reload') await page.reload();
    await page.setContent('<div id="terminal"></div>');
    await page.addStyleTag({ path: new URL('../ui/node_modules/@xterm/xterm/css/xterm.css', import.meta.url).pathname });
    await page.addScriptTag({ path: new URL('../ui/node_modules/@xterm/xterm/lib/xterm.js', import.meta.url).pathname });
    await page.evaluate(async () => {
      window.term = new window.Terminal({ cols: 80, rows: 24 });
      window.term.open(document.querySelector('#terminal'));
      window.sent = [];
      window.term.onData(data => window.sent.push(data));
      await new Promise(resolve => window.term.write('draft 中文\x1b[?1003h\x1b[?1006h', resolve));
      window.term.focus();
    });
    await page.mouse.move(30, 30); await page.mouse.move(80, 45);
    const before = await page.evaluate(() => ({ text: window.term.buffer.active.getLine(0).translateToString(true), cursor: window.term.buffer.active.cursorX, sent: window.sent.join('') }));
    await page.evaluate(async reset => { await new Promise(resolve => window.term.write(reset, resolve)); window.sent = []; }, reset);
    await page.mouse.move(100, 50); await page.mouse.wheel(0, 50);
    const after = await page.evaluate(() => ({ text: window.term.buffer.active.getLine(0).translateToString(true), cursor: window.term.buffer.active.cursorX, sent: window.sent.join(''), mouse: window.term.modes.mouseTrackingMode }));
    await page.keyboard.insertText('正常输入abc'); await page.keyboard.press('ArrowLeft');
    const typed = await page.evaluate(() => window.sent.join(''));
    await page.evaluate(async () => { await new Promise(resolve => window.term.write('\x1b[?1003h\x1b[?1006h', resolve)); window.sent = []; });
    await page.mouse.move(140, 70);
    const resumed = await page.evaluate(() => window.sent.join(''));
    await page.evaluate(async snapshot => { await new Promise(resolve => window.term.write(snapshot, resolve)); }, snapshot);
    const snapshotMouse = await page.evaluate(() => window.term.modes.mouseTrackingMode);
    const pass = before.sent.includes('\x1b[<') && after.text === before.text && after.cursor === before.cursor && after.sent === '' && after.mouse === 'none' && typed === '正常输入abc\x1b[D' && resumed.includes('\x1b[<') && snapshotMouse === 'none';
    results.push({ phase, pass, before, after, typed, resumed, snapshotMouse });
  }
} finally {
  await browser.close();
  await writeFile(new URL('results.json', output), JSON.stringify(results, null, 2));
}
console.log(JSON.stringify(results));
if (results.some(x => !x.pass)) process.exitCode = 1;
