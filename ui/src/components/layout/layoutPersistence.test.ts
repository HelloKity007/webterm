import { describe, expect, it } from 'vitest';
import { emptyPersistedLayout, normalizePersistedLayout } from './layoutPersistence';

describe('normalizePersistedLayout', () => {
  it('accepts a valid per-user layout snapshot', () => {
    const layout = emptyPersistedLayout();
    layout.panes.root.tabs.push({ id: 'ssh-7', type: 'ssh', title: 'LAN shell', connId: 7 });
    layout.panes.root.activeTabId = 'ssh-7';

    expect(normalizePersistedLayout(layout)).toEqual(layout);
  });

  it('rejects a snapshot with a duplicate pane leaf', () => {
    const invalid = {
      tree: { type: 'split', direction: 'horizontal', ratios: [0.5, 0.5], children: [{ type: 'leaf', id: 'root' }, { type: 'leaf', id: 'root' }] },
      panes: { root: { tabs: [], activeTabId: null } },
      focusedPaneId: 'root',
    };

    expect(normalizePersistedLayout(invalid)).toBeNull();
  });
});
