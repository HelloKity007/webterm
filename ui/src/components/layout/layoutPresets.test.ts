import { describe, expect, it } from 'vitest';
import type { LayoutNode } from './layoutPersistence';
import { panelGrid, presetDestinationID, replaceLeafWithEightPaneGrid } from './layoutPresets';

describe('replaceLeafWithEightPaneGrid', () => {
  it('replaces the target with two rows of four panes', () => {
    const paneIDs = ['root', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];

    const result = replaceLeafWithEightPaneGrid({ type: 'leaf', id: 'root' }, 'root', paneIDs);

    expect(result).toEqual({
      type: 'split',
      direction: 'vertical',
      ratios: [0.5, 0.5],
      children: [
        {
          type: 'split',
          direction: 'horizontal',
          ratios: [0.25, 0.25, 0.25, 0.25],
          children: paneIDs.slice(0, 4).map((id) => ({ type: 'leaf', id })),
        },
        {
          type: 'split',
          direction: 'horizontal',
          ratios: [0.25, 0.25, 0.25, 0.25],
          children: paneIDs.slice(4).map((id) => ({ type: 'leaf', id })),
        },
      ],
    });
  });

  it('preserves panes outside the selected nested leaf', () => {
    const root: LayoutNode = {
      type: 'split',
      direction: 'horizontal',
      ratios: [0.5, 0.5],
      children: [{ type: 'leaf', id: 'left' }, { type: 'leaf', id: 'right' }],
    };

    const result = replaceLeafWithEightPaneGrid(root, 'right', ['right', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']);

    expect(result?.type).toBe('split');
    expect(result && result.type === 'split' ? result.children[0] : null).toEqual({ type: 'leaf', id: 'left' });
    expect(result && result.type === 'split' ? result.children[1] : null).toMatchObject({ type: 'split', direction: 'vertical' });
  });
});

describe('panelGrid', () => {
  it('creates a one-panel layout and a four-by-two layout', () => {
    expect(panelGrid(['only'], 1)).toEqual({ type: 'leaf', id: 'only' });
    const grid = panelGrid(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 4);
    expect(grid).toMatchObject({ type: 'split', direction: 'vertical', ratios: [0.5, 0.5] });
    expect(grid && grid.type === 'split' && grid.children[0].type === 'split' ? grid.children[0].ratios : []).toEqual([0.25, 0.25, 0.25, 0.25]);
  });
});

describe('presetDestinationID', () => {
  it('keeps a preferred pane only when the selected preset retains it', () => {
    const retained = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
    expect(presetDestinationID(retained, 'p6')).toBe('p6');
    expect(presetDestinationID(retained, 'p9')).toBe('p1');
  });
});
