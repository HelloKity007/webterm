import { describe, expect, it } from 'vitest';
import type { LayoutNode } from './layoutPersistence';
import { layoutDividers, resizeLayoutDivider } from './layoutDividers';

const root: LayoutNode = {
  type: 'split', direction: 'vertical', ratios: [0.5, 0.5], children: [
    { type: 'split', direction: 'horizontal', ratios: [0.25, 0.75], children: [{ type: 'leaf', id: 'a' }, { type: 'leaf', id: 'b' }] },
    { type: 'leaf', id: 'c' },
  ],
};

describe('layout dividers', () => {
  it('describes nested divider bounds in normalized container coordinates', () => {
    const dividers = layoutDividers(root);
    expect(dividers).toHaveLength(2);
    expect(dividers[0]).toMatchObject({ path: [], index: 0, direction: 'vertical', position: 0.5, crossStart: 0, crossSize: 1 });
    expect(dividers[1]).toMatchObject({ path: [0], index: 0, direction: 'horizontal', position: 0.25, crossStart: 0, crossSize: 0.5 });
  });

  it('changes only the adjacent pair and clamps the minimum share', () => {
    const resized = resizeLayoutDivider(root, [0], 0, 0.01);
    expect(resized).not.toBe(root);
    expect(resized.type === 'split' && resized.children[0].type === 'split' ? resized.children[0].ratios : []).toEqual([0.1, 0.9]);
    expect(root.type === 'split' && root.children[0].type === 'split' ? root.children[0].ratios : []).toEqual([0.25, 0.75]);
  });
});
