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

export function normalizePersistedLayout(value: unknown): PersistedLayout | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<PersistedLayout>;
  const leaves = new Set<string>();
  if (!isValidNode(candidate.tree, leaves) || !candidate.panes || typeof candidate.panes !== 'object') return null;
  const paneIds = Object.keys(candidate.panes);
  if (paneIds.length !== leaves.size || paneIds.some((id) => !leaves.has(id))) return null;

  const panes: Record<string, PersistedPane> = {};
  for (const paneID of paneIds) {
    const pane = candidate.panes[paneID];
    if (!pane || !Array.isArray(pane.tabs) || !pane.tabs.every(isValidTab)) return null;
    const ids = new Set(pane.tabs.map((tab) => tab.id));
    if (ids.size !== pane.tabs.length || (pane.activeTabId !== null && pane.activeTabId !== undefined && !ids.has(pane.activeTabId))) return null;
    panes[paneID] = { tabs: pane.tabs, activeTabId: pane.activeTabId ?? null };
  }
  const focusedPaneId = candidate.focusedPaneId ?? null;
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
    typeof candidate.connId === 'number' && Number.isInteger(candidate.connId) && candidate.connId > 0;
}
