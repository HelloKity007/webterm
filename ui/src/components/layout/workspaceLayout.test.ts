import { describe, expect, it } from 'vitest';
import {
  applyLocalWorkspaceSelection,
  createWorkspaceTab,
  localWorkspaceSelection,
  migrateLayoutV1,
  normalizePersistedWorkspace,
  preserveLocalWorkspaceSelection,
  renameWorkspaceTab,
  removeWorkspaceTab,
  reorderWorkspaceTabs,
  sharedWorkspaceSnapshot,
} from './workspaceLayout';
import { emptyPersistedLayout } from './layoutPersistence';

describe('workspace layout schema v2', () => {
  it('closes the last workspace into a fresh empty workspace without reusing session identities', () => {
    const original = migrateLayoutV1(emptyPersistedLayout())!;
    original.workspaceTabs[0].layout.panes.root.tabs = [{ id: 'old-ssh', type: 'ssh', title: 'old', connId: 2 }];
    const result = removeWorkspaceTab(original, original.workspaceTabs[0].id);
    expect(result.workspaceTabs).toHaveLength(1);
    expect(result.workspaceTabs[0].id).not.toBe(original.workspaceTabs[0].id);
    expect(result.workspaceTabs[0].index).toBe(2);
    expect(Object.values(result.workspaceTabs[0].layout.panes).flatMap(pane => pane.tabs)).toEqual([]);
    expect(original.workspaceTabs[0].layout.panes.root.tabs).toHaveLength(1);
  });
  it('migrates a schema v1 layout without changing pane or terminal identity', () => {
    const legacy = emptyPersistedLayout();
    legacy.panes.root.tabs = [{ id: 'ssh-existing', type: 'ssh', title: 'production', connId: 7, labelNumber: 8 }];
    legacy.panes.root.activeTabId = 'ssh-existing';

    const migrated = migrateLayoutV1(legacy);

    expect(migrated).toEqual({
      workspaceTabs: [{ id: 'workspace-1', index: 1, name: 'workspace', layout: legacy }],
    });
    expect(normalizePersistedWorkspace(migrated)).toEqual(migrated);
  });

  it('rejects duplicate workspace indexes and malformed nested layouts', () => {
    const layout = emptyPersistedLayout();
    expect(normalizePersistedWorkspace({
      workspaceTabs: [
        { id: 'one', index: 1, name: 'one', layout },
        { id: 'two', index: 1, name: 'two', layout },
      ],
    })).toBeNull();
    expect(normalizePersistedWorkspace({
      workspaceTabs: [{ id: 'one', index: 1, name: 'one', layout: { tree: null, panes: {} } }],
    })).toBeNull();
  });

  it('removes browser-local pane and session selections from every workspace', () => {
    const first = emptyPersistedLayout();
    first.panes.root.tabs = [{ id: 'ssh-1', type: 'ssh', title: 'one', connId: 1 }];
    first.panes.root.activeTabId = 'ssh-1';
    const second = structuredClone(first);
    second.tree = { type: 'leaf', id: 'second-pane' };
    second.panes = { 'second-pane': { tabs: [{ id: 'ssh-2', type: 'ssh', title: 'two', connId: 1 }], activeTabId: 'ssh-2' } };
    second.focusedPaneId = 'second-pane';

    expect(sharedWorkspaceSnapshot({ workspaceTabs: [
      { id: 'one', index: 1, name: 'one', layout: first },
      { id: 'two', index: 2, name: 'two', layout: second },
    ] })).toEqual({ workspaceTabs: [
      { id: 'one', index: 1, name: 'one', layout: { ...first, panes: { root: { ...first.panes.root, activeTabId: null } }, focusedPaneId: null } },
      { id: 'two', index: 2, name: 'two', layout: { ...second, panes: { 'second-pane': { ...second.panes['second-pane'], activeTabId: null } }, focusedPaneId: null } },
    ] });
  });

  it('creates a blank workspace by default with the next stable index', () => {
    let sequence = 0;
    const idFactory = (prefix: string) => `${prefix}-${++sequence}`;
    const initial = migrateLayoutV1(emptyPersistedLayout())!;

    const created = createWorkspaceTab(initial, 'workspace-1', 'blank', idFactory);

    expect(created.workspace.index).toBe(2);
    expect(created.workspace.name).toBe('workspace');
    expect(created.workspace.layout.panes[created.workspace.layout.focusedPaneId!].tabs).toEqual([]);
    expect(created.value.workspaceTabs).toHaveLength(2);
  });

  it('copies layout structure with new workspace, pane, session-tab and terminal IDs', () => {
    let sequence = 0;
    const idFactory = (prefix: string) => `${prefix}-${++sequence}`;
    const layout = emptyPersistedLayout();
    layout.panes.root.tabs = [{ id: 'ssh-original', type: 'ssh', title: 'production', connId: 7, labelNumber: 3 }];
    layout.panes.root.activeTabId = 'ssh-original';
    const initial = migrateLayoutV1(layout)!;
    const renamedInitial = renameWorkspaceTab(initial, 'workspace-1', 'source panel')

    const created = createWorkspaceTab(renamedInitial, 'workspace-1', 'copy', idFactory, () => 'connection default');
    const copiedPaneID = created.workspace.layout.focusedPaneId!;
    const copiedTab = created.workspace.layout.panes[copiedPaneID].tabs[0];

    expect(created.workspace.id).not.toBe('workspace-1');
    expect(created.workspace.name).toBe('workspace');
    expect(copiedPaneID).not.toBe('root');
    expect(copiedTab.id).not.toBe('ssh-original');
    expect(copiedTab).toMatchObject({ title: 'connection default', connId: 7, labelNumber: 3 });
    expect(initial.workspaceTabs[0].layout.panes.root.tabs[0].id).toBe('ssh-original');
  });

  it('allows duplicate and HTML-like names while keeping index identity unchanged', () => {
    const initial = migrateLayoutV1(emptyPersistedLayout())!;
    const withSecond = createWorkspaceTab(initial, 'workspace-1', 'blank', (prefix) => `${prefix}-new`).value;
    const renamedFirst = renameWorkspaceTab(withSecond, 'workspace-1', '<b>production</b>');
    const renamedSecond = renameWorkspaceTab(renamedFirst, 'workspace-new', '<b>production</b>');

    expect(renamedSecond.workspaceTabs.map(({ index, name }) => ({ index, name }))).toEqual([
      { index: 1, name: '<b>production</b>' },
      { index: 2, name: '<b>production</b>' },
    ]);
    expect(renameWorkspaceTab(renamedSecond, 'workspace-1', '   ')).toBe(renamedSecond);
  });

  it('keeps each browser local selection when a shared workspace update arrives', () => {
    const local = migrateLayoutV1({
      tree: { type: 'leaf', id: 'root' },
      panes: { root: { tabs: [
        { id: 'ssh-1', type: 'ssh', title: 'one', connId: 1 },
        { id: 'ssh-2', type: 'ssh', title: 'two', connId: 1 },
      ], activeTabId: 'ssh-2' } },
      focusedPaneId: 'root',
    })!;
    const remote = sharedWorkspaceSnapshot(local);
    remote.workspaceTabs[0].name = 'renamed elsewhere';

    const merged = preserveLocalWorkspaceSelection(remote, local);

    expect(merged.workspaceTabs[0].name).toBe('renamed elsewhere');
    expect(merged.workspaceTabs[0].layout.panes.root.activeTabId).toBe('ssh-2');
    expect(merged.workspaceTabs[0].layout.focusedPaneId).toBe('root');
  });

  it('restores local active workspace, focused pane and every pane tab after a page reload', () => {
    const local = migrateLayoutV1({
      tree: { type: 'split', direction: 'horizontal', ratios: [0.5, 0.5], children: [{ type: 'leaf', id: 'left' }, { type: 'leaf', id: 'right' }] },
      panes: {
        left: { tabs: [{ id: 'ssh-left-a', type: 'ssh', title: 'left a', connId: 1 }, { id: 'ssh-left-b', type: 'ssh', title: 'left b', connId: 1 }], activeTabId: 'ssh-left-b' },
        right: { tabs: [{ id: 'ssh-right-a', type: 'ssh', title: 'right a', connId: 2 }, { id: 'ssh-right-b', type: 'ssh', title: 'right b', connId: 2 }], activeTabId: 'ssh-right-a' },
      },
      focusedPaneId: 'right',
    })!;
    const selection = localWorkspaceSelection(local, 'workspace-1');
    const restored = applyLocalWorkspaceSelection(sharedWorkspaceSnapshot(local), selection);

    expect(restored.activeWorkspaceTabID).toBe('workspace-1');
    expect(restored.value.workspaceTabs[0].layout.focusedPaneId).toBe('right');
    expect(restored.value.workspaceTabs[0].layout.panes.left.activeTabId).toBe('ssh-left-b');
    expect(restored.value.workspaceTabs[0].layout.panes.right.activeTabId).toBe('ssh-right-a');
  });

  it('reorders workspace tabs for before/after drops while preserving stable indexes', () => {
    const value = { workspaceTabs: [
      { id: 'one', index: 1, name: 'one', layout: emptyPersistedLayout() },
      { id: 'two', index: 2, name: 'two', layout: emptyPersistedLayout() },
      { id: 'three', index: 3, name: 'three', layout: emptyPersistedLayout() },
    ] };
    expect(reorderWorkspaceTabs(value, 'three', 'one').workspaceTabs.map(tab => tab.id)).toEqual(['three', 'one', 'two']);
    expect(reorderWorkspaceTabs(value, 'one', 'three', true).workspaceTabs.map(tab => tab.id)).toEqual(['two', 'three', 'one']);
    expect(reorderWorkspaceTabs(value, 'one', 'missing')).toBe(value);
    expect(reorderWorkspaceTabs(value, 'three', 'one').workspaceTabs.map(tab => tab.index)).toEqual([3, 1, 2]);
  });
});
