import { describe, expect, it } from 'vitest';
import { shouldPersistLayout } from './layoutSave';

describe('layout save deduplication', () => {
  it('does not persist a layout that was only restored from the server', () => {
    const restored = JSON.stringify({ tree: { type: 'leaf', id: 'root' }, panes: { root: { tabs: [], activeTabId: null } }, focusedPaneId: 'root' });

    expect(shouldPersistLayout(restored, restored)).toBe(false);
    expect(shouldPersistLayout(`${restored} `, restored)).toBe(true);
  });
});
