import { describe, expect, it } from 'vitest';
import { reorderTabs } from './tabOrder';

describe('panel tab ordering', () => {
  const tabs = [5, 9, 10, 12].map((labelNumber) => ({ id: String(labelNumber), labelNumber }));
  it('moves before and after a target in either direction', () => {
    expect(reorderTabs(tabs, '5', '10', true).map(t => t.labelNumber)).toEqual([9, 10, 5, 12]);
    expect(reorderTabs(tabs, '12', '9', false).map(t => t.labelNumber)).toEqual([5, 12, 9, 10]);
  });
  it('preserves identities, labels and the original array', () => {
    const next = reorderTabs(tabs, '5', '12', true);
    expect(next[3]).toBe(tabs[0]);
    expect(tabs.map(t => t.labelNumber)).toEqual([5, 9, 10, 12]);
  });
  it('ignores same position, external and missing tabs', () => {
    expect(reorderTabs(tabs, '5', '5', false)).toBe(tabs);
    expect(reorderTabs(tabs, '5', '9', false)).toBe(tabs);
    expect(reorderTabs(tabs, 'unknown', '9', false)).toBe(tabs);
    expect(reorderTabs(tabs, '5', 'unknown', false)).toBe(tabs);
  });
});
