import assert from 'node:assert/strict';

/** Real mouse drag. Start dragging before scrolling the destination into view:
 * locator.dragTo can scroll the destination first and hit a different source
 * tab at the now-stale source coordinate in an overflowing tab bar. */
export async function dragTerminalTab(source, target, { after = false } = {}) {
  const page = source.page();
  const sourceID = await source.getAttribute('data-tab-id');
  assert(sourceID, 'Expected a terminal tab drag source');
  await page.evaluate(() => {
    window.__qaTerminalDrag = {};
    document.addEventListener('dragstart', e => {
      window.__qaTerminalDrag.source = e.target.closest?.('[data-tab-id]')?.dataset.tabId;
    }, { once: true, capture: true });
    document.addEventListener('drop', e => {
      try { window.__qaTerminalDrag.payload = JSON.parse(e.dataTransfer.getData('text/plain')).id; } catch {}
    }, { once: true, capture: true });
  });
  await source.scrollIntoViewIfNeeded();
  const start = await source.boundingBox();
  assert(start, 'Drag source has no bounds');
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  try {
    await page.mouse.move(start.x + start.width / 2 - 8, start.y + start.height / 2, { steps: 4 });
    const actualSource = await page.evaluate(() => window.__qaTerminalDrag.source);
    assert.equal(actualSource, sourceID, 'Mouse drag started on a different tab');
    await target.scrollIntoViewIfNeeded();
    const end = await target.boundingBox();
    assert(end, 'Drag target has no bounds');
    const targetIsTab = await target.getAttribute('data-tab-id');
    const fraction = targetIsTab ? (after ? 0.75 : 0.25) : 0.5;
    await page.mouse.move(end.x + end.width * fraction, end.y + end.height / 2, { steps: 5 });
  } finally {
    await page.mouse.up();
  }
  assert.equal(await page.evaluate(() => window.__qaTerminalDrag.payload), sourceID, 'Drop did not carry the intended tab');
}
