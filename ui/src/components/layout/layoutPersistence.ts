import type { Tab } from '../../store/layout';

export type Direction = 'horizontal' | 'vertical';

export type LayoutNode = {
  type: 'leaf';
  id: string;
} | {
  type: 'split';
  direction: Direction;
  children: LayoutNode[];
  ratios: number[];
};

export interface PersistedPane {
  tabs: Tab[];
  activeTabId: string | null;
}

export interface PersistedLayout {
  tree: LayoutNode;
  panes: Record<string, PersistedPane>;
  focusedPaneId: string | null;
}

export const emptyPersistedLayout = (): PersistedLayout => ({
  tree: { type: 'leaf', id: 'root' },
  panes: { root: { tabs: [], activeTabId: null } },
  focusedPaneId: 'root',
});

// The shape of the workspace is shared between a user's browsers. The current
// tab and focused pane are intentionally local: syncing either would make a
// click in one browser steal focus (and rebuild terminals) in every other one.
export function sharedLayoutSnapshot(layout: PersistedLayout): PersistedLayout {
  const panes: Record<string, PersistedPane> = {};
  for (const [paneID, pane] of Object.entries(layout.panes)) {
    panes[paneID] = {
      tabs: pane.tabs.map((tab) => ({ ...tab })),
      activeTabId: null,
    };
  }
  return {
    tree: structuredClone(layout.tree),
    panes,
    focusedPaneId: null,
  };
}

export function localActiveTabID(previousID: string | null | undefined, tabs: Tab[], restoredID: string | null): string | null {
  const hasTab = (id: string | null | undefined) => !!id && tabs.some((tab) => tab.id === id);
  if (hasTab(previousID)) return previousID!;
  if (hasTab(restoredID)) return restoredID!;
  return tabs.at(-1)?.id || null;
}

export function normalizePersistedLayout(value: unknown): PersistedLayout | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<PersistedLayout>;
  const leaves = new Set<string>();
  if (!isValidNode(candidate.tree, leaves) || !candidate.panes || typeof candidate.panes !== 'object') return null;
  const paneIds = Object.keys(candidate.panes);
  if (paneIds.length !== leaves.size || paneIds.some((id) => !leaves.has(id))) return null;

  const panes: Record<string, PersistedPane> = {};
  const usedLabelNumbers = new Set<number>();
  for (const paneID of paneIds) {
    for (const tab of candidate.panes[paneID].tabs) {
      if (typeof tab.labelNumber === 'number' && Number.isInteger(tab.labelNumber) && tab.labelNumber > 0) {
        usedLabelNumbers.add(tab.labelNumber);
      }
    }
  }
  const claimedLabelNumbers = new Set<number>();
  let nextLabelNumber = 1;
  const allocateLabelNumber = () => {
    while (usedLabelNumbers.has(nextLabelNumber)) nextLabelNumber++;
    const allocated = nextLabelNumber++;
    usedLabelNumbers.add(allocated);
    return allocated;
  };
  for (const paneID of paneIds) {
    const pane = candidate.panes[paneID];
    if (!pane || !Array.isArray(pane.tabs) || !pane.tabs.every(isValidTab)) return null;
    const ids = new Set(pane.tabs.map((tab) => tab.id));
    const activeTabId = pane.activeTabId || null;
    if (ids.size !== pane.tabs.length || (activeTabId !== null && !ids.has(activeTabId))) return null;
    const tabs = pane.tabs.map((tab) => {
      const labelNumber = tab.labelNumber;
      if (typeof labelNumber === 'number' && Number.isInteger(labelNumber) && labelNumber > 0 && !claimedLabelNumbers.has(labelNumber)) {
        claimedLabelNumbers.add(labelNumber);
        return { ...tab, labelNumber };
      }
      return { ...tab, labelNumber: allocateLabelNumber() };
    });
    panes[paneID] = { tabs, activeTabId };
  }
  const focusedPaneId = candidate.focusedPaneId || null;
  if (focusedPaneId !== null && !leaves.has(focusedPaneId)) return null;
  return { tree: candidate.tree as LayoutNode, panes, focusedPaneId };
}

function isValidNode(node: unknown, leaves: Set<string>): node is LayoutNode {
  if (!node || typeof node !== 'object') return false;
  const candidate = node as Partial<LayoutNode>;
  if (candidate.type === 'leaf') {
    if (typeof candidate.id !== 'string' || candidate.id.trim() === '' || leaves.has(candidate.id)) return false;
    leaves.add(candidate.id);
    return true;
  }
  if (candidate.type !== 'split' || (candidate.direction !== 'horizontal' && candidate.direction !== 'vertical') || !Array.isArray(candidate.children) || !Array.isArray(candidate.ratios) || candidate.children.length < 2 || candidate.children.length !== candidate.ratios.length || !candidate.ratios.every((ratio) => typeof ratio === 'number' && Number.isFinite(ratio) && ratio > 0)) return false;
  return candidate.children.every((child) => isValidNode(child, leaves));
}

function isValidTab(tab: unknown): tab is Tab {
  if (!tab || typeof tab !== 'object') return false;
  const candidate = tab as Partial<Tab>;
  return typeof candidate.id === 'string' && candidate.id.trim() !== '' &&
    typeof candidate.title === 'string' && candidate.title.trim() !== '' &&
    (candidate.type === 'ssh' || candidate.type === 'database') &&
    typeof candidate.connId === 'number' && Number.isInteger(candidate.connId) && candidate.connId > 0 &&
    (candidate.labelNumber === undefined || (typeof candidate.labelNumber === 'number' && Number.isInteger(candidate.labelNumber) && candidate.labelNumber > 0));
}
