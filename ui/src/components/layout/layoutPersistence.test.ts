import { describe, expect, it } from 'vitest';
import { emptyPersistedLayout, localActiveTabID, normalizePersistedLayout, sharedLayoutSnapshot } from './layoutPersistence';

describe('normalizePersistedLayout', () => {
  it('accepts a valid per-user layout snapshot', () => {
    const layout = emptyPersistedLayout();
    layout.panes.root.tabs.push({ id: 'ssh-7', type: 'ssh', title: 'LAN shell', connId: 7, labelNumber: 1 });
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

  it('assigns stable unique label numbers to legacy tabs that have none', () => {
    const normalized = normalizePersistedLayout({
      tree: { type: 'leaf', id: 'root' },
      panes: { root: { tabs: [
        { id: 'ssh-1', type: 'ssh', title: 'one', connId: 1 },
        { id: 'ssh-2', type: 'ssh', title: 'two', connId: 2, labelNumber: 1 },
      ], activeTabId: 'ssh-1' } },
      focusedPaneId: 'root',
    });

    expect(normalized?.panes.root.tabs.map((tab) => tab.labelNumber)).toEqual([2, 1]);
  });
});

describe('sharedLayoutSnapshot', () => {
  it('does not persist the active tab or focused pane from one browser', () => {
    const layout = emptyPersistedLayout();
    layout.panes.root.tabs.push({ id: 'ssh-7', type: 'ssh', title: 'LAN shell', connId: 7 });
    layout.panes.root.activeTabId = 'ssh-7';
    layout.focusedPaneId = 'root';

    expect(sharedLayoutSnapshot(layout)).toEqual({
      tree: layout.tree,
      panes: { root: { tabs: layout.panes.root.tabs, activeTabId: null } },
      focusedPaneId: null,
    });
  });
});

describe('normalizePersistedLayout shared-state compatibility', () => {
  it('accepts empty browser-local selection fields returned by the server', () => {
    expect(normalizePersistedLayout({
      tree: { type: 'leaf', id: 'root' },
      panes: { root: { tabs: [{ id: 'ssh-1', type: 'ssh', title: 'x99', connId: 2 }], activeTabId: '' } },
      focusedPaneId: '',
    })).toEqual({
      tree: { type: 'leaf', id: 'root' },
      panes: { root: { tabs: [{ id: 'ssh-1', type: 'ssh', title: 'x99', connId: 2, labelNumber: 1 }], activeTabId: null } },
      focusedPaneId: null,
    });
  });
});

describe('localActiveTabID', () => {
  it('keeps this browser on its own selected tab when another browser changes the shared layout', () => {
    const tabs = [
      { id: 'ssh-1', type: 'ssh' as const, title: 'one', connId: 1 },
      { id: 'ssh-2', type: 'ssh' as const, title: 'two', connId: 1 },
    ];

    expect(localActiveTabID('ssh-1', tabs, 'ssh-2')).toBe('ssh-1');
  });
});
