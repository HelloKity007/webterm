import type { Tab } from '../../store/layout';
import {
  emptyPersistedLayout,
  localActiveTabID,
  normalizePersistedLayout,
  sharedLayoutSnapshot,
  type LayoutNode,
  type PersistedLayout,
} from './layoutPersistence';

export type WorkspaceCreateMode = 'blank' | 'copy';

export interface WorkspaceTab {
  id: string;
  index: number;
  name: string;
  layout: PersistedLayout;
}

export interface PersistedWorkspace {
  workspaceTabs: WorkspaceTab[];
}

export type WorkspaceIDFactory = (prefix: string) => string;
export type WorkspaceTabTitleFactory = (tab: Tab) => string;

let fallbackID = 0;

function defaultIDFactory(prefix: string): string {
  const randomID = globalThis.crypto?.randomUUID?.();
  if (randomID) return `${prefix}-${randomID}`;
  fallbackID += 1;
  return `${prefix}-${Date.now()}-${fallbackID}`;
}

export function migrateLayoutV1(value: unknown): PersistedWorkspace | null {
  if (hasWorkspaceTabs(value)) return normalizeWorkspaceV2(value);
  const layout = normalizePersistedLayout(value);
  if (!layout) return null;
  return {
    workspaceTabs: [{ id: 'workspace-1', index: 1, name: 'workspace', layout }],
  };
}

export function normalizePersistedWorkspace(value: unknown): PersistedWorkspace | null {
  if (hasWorkspaceTabs(value)) return normalizeWorkspaceV2(value);
  return migrateLayoutV1(value);
}

export function emptyPersistedWorkspace(): PersistedWorkspace {
  return migrateLayoutV1(emptyPersistedLayout())!;
}

export function sharedWorkspaceSnapshot(value: PersistedWorkspace): PersistedWorkspace {
  return {
    workspaceTabs: value.workspaceTabs.map((workspace) => ({
      id: workspace.id,
      index: workspace.index,
      name: workspace.name,
      layout: sharedLayoutSnapshot(workspace.layout),
    })),
  };
}

export function preserveLocalWorkspaceSelection(remote: PersistedWorkspace, local: PersistedWorkspace): PersistedWorkspace {
  const localByID = new Map(local.workspaceTabs.map((workspace) => [workspace.id, workspace]));
  return {
    workspaceTabs: remote.workspaceTabs.map((workspace) => {
      const previous = localByID.get(workspace.id);
      if (!previous) return workspace;
      const panes: PersistedLayout['panes'] = {};
      for (const [paneID, pane] of Object.entries(workspace.layout.panes)) {
        const previousPane = previous.layout.panes[paneID];
        panes[paneID] = {
          tabs: pane.tabs.map((tab) => ({ ...tab })),
          activeTabId: localActiveTabID(previousPane?.activeTabId, pane.tabs, pane.activeTabId),
        };
      }
      const leaves = new Set(Object.keys(panes));
      const focusedPaneId = previous.layout.focusedPaneId && leaves.has(previous.layout.focusedPaneId)
        ? previous.layout.focusedPaneId
        : workspace.layout.focusedPaneId && leaves.has(workspace.layout.focusedPaneId)
          ? workspace.layout.focusedPaneId
          : Object.keys(panes)[0] || null;
      return { ...workspace, layout: { tree: structuredClone(workspace.layout.tree), panes, focusedPaneId } };
    }),
  };
}

export function createWorkspaceTab(
  value: PersistedWorkspace,
  sourceWorkspaceID: string,
  mode: WorkspaceCreateMode = 'blank',
  idFactory: WorkspaceIDFactory = defaultIDFactory,
  titleFactory?: WorkspaceTabTitleFactory,
): { value: PersistedWorkspace; workspace: WorkspaceTab } {
  const nextIndex = value.workspaceTabs.reduce((highest, workspace) => Math.max(highest, workspace.index), 0) + 1;
  const source = value.workspaceTabs.find((workspace) => workspace.id === sourceWorkspaceID) || value.workspaceTabs[0];
  const layout = mode === 'copy' && source
    ? cloneLayoutWithNewIdentity(source.layout, idFactory, titleFactory)
    : blankLayoutWithNewIdentity(idFactory);
  const workspace: WorkspaceTab = {
    id: idFactory('workspace'),
    index: nextIndex,
    name: 'workspace',
    layout,
  };
  return {
    value: { workspaceTabs: [...value.workspaceTabs, workspace] },
    workspace,
  };
}

export function renameWorkspaceTab(value: PersistedWorkspace, workspaceID: string, name: string): PersistedWorkspace {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 256) return value;
  return {
    workspaceTabs: value.workspaceTabs.map((workspace) => workspace.id === workspaceID
      ? { ...workspace, name: trimmed }
      : workspace),
  };
}

function blankLayoutWithNewIdentity(idFactory: WorkspaceIDFactory): PersistedLayout {
  const paneID = idFactory('pane');
  return {
    tree: { type: 'leaf', id: paneID },
    panes: { [paneID]: { tabs: [], activeTabId: null } },
    focusedPaneId: paneID,
  };
}

function cloneLayoutWithNewIdentity(layout: PersistedLayout, idFactory: WorkspaceIDFactory, titleFactory?: WorkspaceTabTitleFactory): PersistedLayout {
  const paneIDs = new Map<string, string>();
  const tabIDs = new Map<string, string>();
  const cloneTree = (node: LayoutNode): LayoutNode => {
    if (node.type === 'leaf') {
      const paneID = idFactory('pane');
      paneIDs.set(node.id, paneID);
      return { type: 'leaf', id: paneID };
    }
    return {
      type: 'split',
      direction: node.direction,
      ratios: [...node.ratios],
      children: node.children.map(cloneTree),
    };
  };
  const tree = cloneTree(layout.tree);
  const panes: PersistedLayout['panes'] = {};
  for (const [oldPaneID, pane] of Object.entries(layout.panes)) {
    const paneID = paneIDs.get(oldPaneID)!;
    const tabs = pane.tabs.map((tab): Tab => {
      const tabID = idFactory(tab.type === 'ssh' ? 'ssh' : 'database');
      tabIDs.set(tab.id, tabID);
      return { ...tab, id: tabID, title: titleFactory?.(tab) || (tab.type === 'ssh' ? 'SSH' : 'Database') };
    });
    panes[paneID] = {
      tabs,
      activeTabId: pane.activeTabId ? tabIDs.get(pane.activeTabId) || null : null,
    };
  }
  return {
    tree,
    panes,
    focusedPaneId: layout.focusedPaneId ? paneIDs.get(layout.focusedPaneId) || null : null,
  };
}

function hasWorkspaceTabs(value: unknown): value is { workspaceTabs: unknown } {
  return !!value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'workspaceTabs');
}

function normalizeWorkspaceV2(value: { workspaceTabs: unknown }): PersistedWorkspace | null {
  if (!Array.isArray(value.workspaceTabs) || value.workspaceTabs.length === 0) return null;
  const workspaceIDs = new Set<string>();
  const workspaceIndexes = new Set<number>();
  const paneIDs = new Set<string>();
  const terminalIDs = new Set<string>();
  const workspaceTabs: WorkspaceTab[] = [];
  for (const rawWorkspace of value.workspaceTabs) {
    if (!rawWorkspace || typeof rawWorkspace !== 'object') return null;
    const candidate = rawWorkspace as Partial<WorkspaceTab>;
    if (typeof candidate.id !== 'string' || candidate.id.trim() === '' || workspaceIDs.has(candidate.id)) return null;
    if (!Number.isSafeInteger(candidate.index) || candidate.index! < 1 || workspaceIndexes.has(candidate.index!)) return null;
    if (typeof candidate.name !== 'string' || candidate.name.trim() === '' || candidate.name.length > 256) return null;
    const layout = normalizePersistedLayout(candidate.layout);
    if (!layout) return null;
    for (const [paneID, pane] of Object.entries(layout.panes)) {
      if (paneIDs.has(paneID)) return null;
      paneIDs.add(paneID);
      for (const tab of pane.tabs) {
        if (terminalIDs.has(tab.id)) return null;
        terminalIDs.add(tab.id);
      }
    }
    workspaceIDs.add(candidate.id);
    workspaceIndexes.add(candidate.index!);
    workspaceTabs.push({ id: candidate.id, index: candidate.index!, name: candidate.name, layout });
  }
  return { workspaceTabs };
}
