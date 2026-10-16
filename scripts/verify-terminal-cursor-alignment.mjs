// Pixel-level cursor placement check for terminal panels. Frame-differences a
// short burst of screenshots to locate the blinking cursor block regardless of
// blink phase, then asserts the block sits immediately right of the prompt's
// '$' on the same row and that the panel actually rendered text.
//
//   WEBTERM_BASE_URL=https://192.168.11.87:9444 \
//   WEBTERM_QA_OUTPUT=runtime/terminal-cursor-align/<stamp> \
//   node scripts/verify-terminal-cursor-alignment.mjs
import playwright from '/media/pgz/DATA-B/code/tools/webterm-xufanchn/webterm-HelloKity007/ui/node_modules/@playwright/test/index.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const { chromium } = playwright;
const origin = (process.env.WEBTERM_BASE_URL || 'https://192.168.11.87:9444').replace(/\/$/, '');
const outDir = process.env.WEBTERM_QA_OUTPUT || 'runtime/terminal-cursor-align/latest';
await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1360, height: 900 } });
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
const page = await context.newPage();
const results = [];

const analyse = async (name, paneIndex) => {
  const clip = await page.evaluate((paneIndex) => {
    const r = document.querySelectorAll('.terminal-pane')[paneIndex].getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  }, paneIndex);
  const paths = [];
  for (let i = 0; i < 6; i += 1) {
    const path = `${outDir}/${name}-${i}.png`;
    await page.screenshot({ path, clip });
    paths.push(path);
    await page.waitForTimeout(200);
  }
  const analysis = execFileSync('python3', ['-c', `
from PIL import Image
import json, sys
paths = json.loads(sys.argv[1])
frames = [Image.open(p).convert('RGB') for p in paths]
w, h = frames[0].size
bg = (31, 33, 31)
def diff_pair(a, b):
    pa, pb = a.load(), b.load()
    pts = [(x, y) for y in range(h) for x in range(w) if pa[x, y] != pb[x, y]]
    return pts
best = None
for i in range(len(frames)):
    for j in range(i + 1, len(frames)):
        pts = diff_pair(frames[i], frames[j])
        if not pts: continue
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        bw, bh = max(xs) - min(xs) + 1, max(ys) - min(ys) + 1
        if 40 <= len(pts) <= 800 and bw <= 30 and bh <= 30:
            best = (min(xs), min(ys), max(xs), max(ys), len(pts))
            break
    if best: break
# Find '$' glyphs: pinkish red ink
img = frames[0]; px = img.load()
pink = [(x, y) for y in range(24, h) for x in range(w)
        if px[x, y][0] - px[x, y][1] > 25 and px[x, y][0] > 100]
text_rows = []
for y in range(24, h):
    n = sum(1 for x in range(w) if px[x, y] != bg)
    if n > 2: text_rows.append(y)
out = {'cursor': best, 'pinkCount': len(pink),
       'pinkByRow': {}, 'nonEmptyRows': [min(text_rows), max(text_rows)] if text_rows else None,
       'blank': len(text_rows) == 0, 'size': [w, h]}
if best and pink:
    cx0, cy0, cx1, cy1, _ = best
    # nearest pink pixel to the cursor block
    near = min(pink, key=lambda p: (abs(p[0] - cx0) + abs(p[1] - cy0)))
    out['nearestPink'] = near
    out['sameRow'] = abs(near[1] - cy0) <= 12
    out['immediatelyLeft'] = 0 <= cx0 - near[0] <= 14
print(json.dumps(out))
`, JSON.stringify(paths)], { encoding: 'utf8' });
  const parsed = JSON.parse(analysis.trim());
  const record = {
    name,
    ok: !parsed.blank && parsed.cursor && parsed.sameRow && parsed.immediatelyLeft,
    ...parsed,
  };
  results.push(record);
  console.log(`${record.ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(parsed)}`);
};

try {
  await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll('.terminal-surface').length > 0, null, { timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.workspace-tabs-toggle').first().click();
  await page.waitForTimeout(300);
  await page.getByRole('tab', { name: '2: 730' }).first().click();
  await page.waitForTimeout(2000);

  const paneIndex = await page.evaluate(() => {
    const panes = Array.from(document.querySelectorAll('.terminal-pane'));
    return panes.findIndex((pane) => Array.from(pane.querySelectorAll('.terminal-tabbar [data-terminal-tab]'))
      .some((tab) => /^53:/.test((tab.textContent || '').trim())));
  });
  const pane = page.locator('.terminal-pane').nth(paneIndex);
  const labels = await pane.evaluate((node) => Array.from(node.querySelectorAll('.terminal-tabbar [data-terminal-tab]'))
    .map((n) => (n.textContent || '').trim().split(/\s/)[0].replace(/:$/, '')));
  console.log('pane', paneIndex, JSON.stringify(labels));
  for (const label of labels) {
    await pane.locator('.terminal-tabbar [data-terminal-tab]').filter({ hasText: new RegExp(`^${label}:`) }).first().click();
    await page.waitForTimeout(1200);
    await pane.evaluate((node) => Array.from(node.querySelectorAll('.terminal-surface'))
      .find((n) => n.offsetParent !== null)?.querySelector('.xterm-helper-textarea')?.focus());
    await page.waitForTimeout(300);
    await analyse(`tab-${label}`, paneIndex);
  }
} finally {
  await writeFile(`${outDir}/summary.json`, JSON.stringify(results, null, 2));
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} aligned ===`);
process.exitCode = failed.length ? 1 : 0;
