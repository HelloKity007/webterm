import { chromium } from '../ui/node_modules/playwright/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = process.env.WEBTERM_QA_OUTPUT || path.join(root, 'runtime/snapshot-order-diagnostic');
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const scenarios = JSON.parse(Buffer.concat(chunks).toString());
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const results = [];
try {
  for (const scenario of scenarios) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await page.setContent('<div id="terminal" style="height:850px;width:1150px"></div>');
    await page.addStyleTag({ path: path.join(root, 'ui/node_modules/@xterm/xterm/css/xterm.css') });
    await page.addScriptTag({ path: path.join(root, 'ui/node_modules/@xterm/xterm/lib/xterm.js') });
    const result = await page.evaluate(async ({ name, stream }) => {
      const term = new window.Terminal({ cols: 104, rows: 38, fontSize: 16 });
      term.open(document.querySelector('#terminal'));
      // Match the production grid-announcement contract, without any replay
      // timers, application state or existing user sessions in this experiment.
      const grids = [];
      term.onTitleChange(title => {
        const match = /^webterm-grid:(\d+)x(\d+)$/.exec(title);
        if (match) { grids.push(title); term.resize(Number(match[1]), Number(match[2])); }
      });
      await new Promise(resolve => term.write(stream, resolve));
      const buffer = term.buffer.active;
      const lines = Array.from({ length: term.rows }, (_, i) => buffer.getLine(i)?.translateToString(true) || '');
      return { name, rows: term.rows, cols: term.cols, grids, lines,
        currentFirstRow: lines[0] === 'CURRENT row 01',
        currentComposer: lines[36] === 'COMPOSER_DRAFT_UNSUBMITTED',
        currentStatusline: lines[37] === 'STATUSLINE_CURRENT',
        cursor: { x: buffer.cursorX, y: buffer.cursorY } };
    }, scenario);
    result.pass = result.rows === 38 && result.currentFirstRow && result.currentComposer && result.currentStatusline;
    results.push(result);
    await page.screenshot({ path: path.join(output, `${scenario.name}.png`) });
    await page.close();
  }
} finally {
  await browser.close();
  await writeFile(path.join(output, 'results.json'), JSON.stringify({
    scope: 'Controlled encoder/order schedules, not a live-user trace', results,
  }, null, 2));
}
console.log(JSON.stringify(results.map(({ lines, ...result }) => ({ ...result, blankRows: lines.filter(line => !line).length })), null, 2));
if (results.some(result => !result.pass)) process.exitCode = 1;
