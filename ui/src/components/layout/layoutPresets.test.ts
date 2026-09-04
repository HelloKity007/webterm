import { describe, expect, it } from 'vitest';
import type { LayoutNode } from './layoutPersistence';
import { replaceLeafWithEightPaneGrid } from './layoutPresets';

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
