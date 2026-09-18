import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium } from '../ui/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';

const output = process.env.WEBTERM_QA_OUTPUT || 'runtime/bounded-history-origin';
await mkdir(output, { recursive: true });
const binary = `${process.cwd()}/runtime/tmux-fixed/bin/tmux`;
const socket = `qa-history-origin-${randomUUID()}`;
const tmux = (...args) => execFileSync(binary, ['-L', socket, ...args], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
const browser = await chromium.launch();
const results = [];
let owned = false;
try {
  // All writes go to this disposable server, never an existing user session.
  const fixture = String.raw`process.stdout.write(Array.from({length:650},(_,i)=>String(i).padStart(6,'0')+' '+'X'.repeat(1016)).join('\n')+'\nREADY\n');setInterval(()=>{},1000)`;
  tmux('new-session', '-d', '-x', '104', '-y', '26', '-s', 'fixture', process.execPath, '-e', fixture);
  owned = true;
  const deadline = Date.now() + 5000;
  while (!tmux('capture-pane', '-p', '-t', 'fixture').includes('READY')) {
    assert(Date.now() < deadline, 'Fixture did not finish printing');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  for (const [captureCols, captureRows] of [[104, 26], [103, 26], [105, 26], [104, 27], [104, 26]]) {
    tmux('resize-window', '-t', 'fixture', '-x', String(captureCols), '-y', String(captureRows));
    const captured = tmux('capture-pane', '-p', '-e', '-J', '-S', '-2000', '-t', 'fixture');
    const page = await browser.newPage();
    await page.addScriptTag({ path: 'ui/node_modules/@xterm/xterm/lib/xterm.js' });
    const replay = await page.evaluate(async captured => {
      const term = new window.Terminal({ cols: 104, rows: 26, scrollback: 10000 });
      const root = document.createElement('div'); document.body.append(root); term.open(root);
      await new Promise(resolve => term.write(captured.replace(/\r?\n/g, '\r\n'), resolve));
      const buffer = term.buffer.active;
      const result = { baseY: buffer.baseY, viewportY: buffer.baseY - 69,
        lines: Array.from({length:26},(_,i)=>buffer.getLine(buffer.baseY - 69 + i)?.translateToString(true) || '') };
      term.dispose(); return result;
    }, captured);
    results.push({ captureCols, captureRows, firstLogicalLineLength: captured.split('\n')[0].length, ...replay });
    await page.close();
  }
  for (const result of results.slice(1)) assert.deepEqual(result.lines, results[0].lines, 'Reading content should remain the same');
  console.log(JSON.stringify(results.map(({ lines, ...entry }) => ({ ...entry, visibleLines: lines.length }))));
} finally {
  if (owned) {
    try { tmux('kill-server'); } catch (error) {
      if (!String(error.stderr).includes('no server running')) console.error('Owned fixture cleanup failed:', error.message);
    }
  }
  await browser.close();
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
}
