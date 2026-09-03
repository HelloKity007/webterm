import { lazy, Suspense, useState, useEffect, useRef, useCallback } from 'react';
import { useLayoutStore } from '../../store/layout';
import type { Tab } from '../../store/layout';
import { useConnectionStore } from '../../store/connections';
import TabBar from './TabBar';
const TerminalTab = lazy(() => import('../terminal/TerminalTab'));
const QueryEditor = lazy(() => import('../database/QueryEditor'));
import { t } from '../../i18n';
import MatrixRain from '../common/MatrixRain';
import { useAuthStore } from '../../store/auth';
import { apiGet, apiPost, apiPut } from '../../api/client';
import { colors, font } from '../../theme/tokens';
import { emptyPersistedLayout, normalizePersistedLayout, type Direction, type LayoutNode, type PersistedLayout } from './layoutPersistence';
import { layoutEventRevision, layoutSocketURL } from './layoutSync';
import { shouldPersistLayout } from './layoutSave';
import { useWebSocket } from '../../hooks/useWebSocket';

// Grid cell — computed from the tree
interface GridCell {
  id: string;       // pane id
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
}

// Module-level state
let layoutRoot: LayoutNode = { type: 'leaf', id: 'root' };
let listeners: Array<() => void> = [];
let layoutRestoreVersion = 0;
let generatedID = 0;

function nextLayoutID(prefix: string) {
  generatedID += 1;
  return `${prefix}-${Date.now()}-${generatedID}`;
}

// Registry of all pane IDs ever created (panes never removed from DOM, just hidden)
const allPaneIds = new Set<string>(['root']);

function subscribe(fn: () => void) {
  listeners.push(fn);
  return () => { listeners = listeners.filter((l) => l !== fn); };
}
function notify() { listeners.forEach((fn) => fn()); }

function leafIDs(node: LayoutNode, ids: string[] = []): string[] {
  if (node.type === 'leaf') {
    ids.push(node.id);
    return ids;
  }
  node.children.forEach((child) => leafIDs(child, ids));
  return ids;
}

function layoutSnapshot(): PersistedLayout {
  const panes: PersistedLayout['panes'] = {};
  for (const paneID of leafIDs(layoutRoot)) {
    panes[paneID] = {
      tabs: (paneTabsCache.get(paneID) || []).map((tab) => ({ ...tab })),
      activeTabId: paneActiveCache.get(paneID) || null,
    };
  }
  return { tree: structuredClone(layoutRoot), panes, focusedPaneId: useLayoutStore.getState().focusedPaneId };
}

function restoreLayout(value: unknown) {
  const layout = normalizePersistedLayout(value) || emptyPersistedLayout();
  layoutRoot = structuredClone(layout.tree);
  allPaneIds.clear();
  leafIDs(layoutRoot).forEach((id) => allPaneIds.add(id));
  paneTabsCache.clear();
  paneActiveCache.clear();
  for (const [paneID, pane] of Object.entries(layout.panes)) {
    paneTabsCache.set(paneID, pane.tabs.map((tab) => ({ ...tab })));
    paneActiveCache.set(paneID, pane.activeTabId);
  }
  useLayoutStore.getState().setFocusedPane(layout.focusedPaneId || 'root');
  layoutRestoreVersion++;
  notify();
}


// Find a leaf node by ID and return its path
function findLeaf(node: LayoutNode, id: string, path: LayoutNode[]): LayoutNode[] | null {
  if (node.type === 'leaf') return node.id === id ? [...path, node] : null;
  for (const child of node.children) {
    const result = findLeaf(child, id, [...path, node]);
    if (result) return result;
  }
  return null;
}

// Add a split: wraps the target leaf in a split, or adds sibling if same direction
// If newId is provided, uses it instead of generating one
function doSplit(targetId: string, direction: Direction, newId?: string) {
  const id = newId || nextLayoutID('pane');
  allPaneIds.add(id);

  if (layoutRoot.type === 'leaf' && layoutRoot.id === targetId) {
    // Splitting root
    layoutRoot = {
      type: 'split',
      direction,
      children: [
        { type: 'leaf', id: targetId },
        { type: 'leaf', id },
      ],
      ratios: [0.5, 0.5],
    };
  } else {
    const path = findLeaf(layoutRoot, targetId, []);
    if (!path || path.length < 2) return;
    const parent = path[path.length - 2];
    if (parent.type !== 'split') return;

    if (parent.direction === direction) {
      // Same direction — split only the target pane's space in half
      const idx = parent.children.findIndex((child) => child.type === 'leaf' && child.id === targetId);
      if (idx < 0) return;
      const half = parent.ratios[idx] / 2;
      parent.ratios[idx] = half;
      parent.ratios.splice(idx + 1, 0, half);
      parent.children.splice(idx + 1, 0, { type: 'leaf', id });
    } else {
      // Different direction — wrap this leaf in a sub-split
      const idx = parent.children.findIndex((child) => child.type === 'leaf' && child.id === targetId);
      if (idx < 0) return;
      parent.children[idx] = {
        type: 'split',
        direction,
        children: [
          { type: 'leaf', id: targetId },
          { type: 'leaf', id },
        ],
        ratios: [0.5, 0.5],
      };
    }
  }
  notify();
  return id;
}

// Remove a pane from the layout
function doRemovePane(paneId: string) {
  // Only refuse to remove root when it's the sole pane
  if (paneId === 'root' && layoutRoot.type === 'leaf') return;

  function removeFrom(node: LayoutNode): LayoutNode | null {
    if (node.type === 'leaf') return node.id === paneId ? null : node;
    const filtered = node.children
      .map((c) => removeFrom(c))
      .filter((c): c is LayoutNode => c !== null);
    if (filtered.length === 1) return filtered[0];
    if (filtered.length === 0) return null;
    node.children = filtered;
    // Redistribute ratios
    node.ratios = filtered.map(() => 1 / filtered.length);
    return node;
  }

  const result = removeFrom(layoutRoot);
  if (result) {
    layoutRoot = result;
    allPaneIds.delete(paneId);
  }
  notify();
}

// Helper: greatest common divisor
function gcd(a: number, b: number): number { return b === 0 ? a : gcd(b, a % b); }

// Largest remainder method for distributing integer spans proportional to ratios
function allocateSpans(total: number, ratios: number[]): number[] {
  const raw = ratios.map((r) => r * total);
  const spans = raw.map((s) => Math.max(0, Math.floor(s)));
  const remainders = raw.map((r, i) => ({ idx: i, rem: r - spans[i] }));
  const allocated = spans.reduce((a, b) => a + b, 0);
  const deficit = total - allocated;
  remainders.sort((a, b) => b.rem - a.rem);
  for (let i = 0; i < deficit; i++) {
    spans[remainders[i % remainders.length].idx]++;
  }
  return spans.map((s) => Math.max(1, s));
}

// Normalize cells: scale spans and positions down by their global GCD
function normalizeCells(cells: GridCell[]): { cells: GridCell[]; cols: number; rows: number } {
  let colGcd = 0, rowGcd = 0;
  for (const c of cells) {
    colGcd = colGcd === 0 ? c.colSpan : gcd(colGcd, c.colSpan);
    rowGcd = rowGcd === 0 ? c.rowSpan : gcd(rowGcd, c.rowSpan);
  }
  if (colGcd < 1) colGcd = 1;
  if (rowGcd < 1) rowGcd = 1;

  const normalized = cells.map((c) => ({
    ...c,
    col: ((c.col - 1) / colGcd) + 1,
    row: ((c.row - 1) / rowGcd) + 1,
    colSpan: c.colSpan / colGcd,
    rowSpan: c.rowSpan / rowGcd,
  }));

  const maxCol = normalized.reduce((m, c) => Math.max(m, c.col + c.colSpan - 1), 0);
  const maxRow = normalized.reduce((m, c) => Math.max(m, c.row + c.rowSpan - 1), 0);

  return { cells: normalized, cols: maxCol, rows: maxRow };
}

// Flatten tree into grid cells using precise integer span allocation
const PRECISION = 100;
function flattenTree(node: LayoutNode, row: number, col: number, rowSpan: number, colSpan: number): GridCell[] {
  if (node.type === 'leaf') {
    return [{ id: node.id, row, col, rowSpan, colSpan }];
  }
  const cells: GridCell[] = [];
  if (node.direction === 'horizontal') {
    const spans = allocateSpans(colSpan, node.ratios);
    let c = col;
    node.children.forEach((child, i) => {
      cells.push(...flattenTree(child, row, c, rowSpan, spans[i]));
      c += spans[i];
    });
  } else {
    const spans = allocateSpans(rowSpan, node.ratios);
    let r = row;
    node.children.forEach((child, i) => {
      cells.push(...flattenTree(child, r, col, spans[i], colSpan));
      r += spans[i];
    });
  }
  return cells;
}

// Compute the total extents of the tree (ignoring ratios, just leaf count)
function treeExtents(node: LayoutNode): { cols: number; rows: number } {
  if (node.type === 'leaf') return { cols: 1, rows: 1 };
  if (node.direction === 'horizontal') {
    let cols = 0, rows = 1;
    for (const child of node.children) {
      const e = treeExtents(child);
      cols += e.cols;
      rows = Math.max(rows, e.rows);
    }
    return { cols: Math.max(1, cols), rows };
  } else {
    let rows = 0, cols = 1;
    for (const child of node.children) {
      const e = treeExtents(child);
      rows += e.rows;
      cols = Math.max(cols, e.cols);
    }
    return { rows: Math.max(1, rows), cols };
  }
}

// Compute grid dimensions with precise ratio encoding
function computeGrid(node: LayoutNode): { cols: number; rows: number; cells: GridCell[] } {
  if (node.type === 'leaf') return { cols: 1, rows: 1, cells: [{ id: node.id, row: 1, col: 1, rowSpan: 1, colSpan: 1 }] };

  const extents = treeExtents(node);
  const rawCells = flattenTree(node, 1, 1, extents.rows * PRECISION, extents.cols * PRECISION);
  return normalizeCells(rawCells);
}

// Cache tabs per pane
const paneTabsCache = new Map<string, Tab[]>();
const paneActiveCache = new Map<string, string | null>();

// Leaf pane component — always mounted, just hidden when not in layout
function LeafPane({ nodeId, onActiveSshChange, isInSplit }: {
  nodeId: string; onActiveSshChange?: (connId: number | null, tabId: string | null) => void; isInSplit: boolean;
}) {
  const [tabs, setTabs] = useState<Tab[]>(() => {
    return paneTabsCache.get(nodeId) || [];
  });
  const [activeTabId, setActiveTabId] = useState<string | null>(() => {
    return paneActiveCache.get(nodeId) || null;
  });
  const drainTabQueue = useLayoutStore((s) => s.drainTabQueue);
  const queuedTabs = useLayoutStore((s) => s.newTabQueue);
  const focusedPaneId = useLayoutStore((s) => s.focusedPaneId);
  const setFocusedPane = useLayoutStore((s) => s.setFocusedPane);
  const setStatusConn = useLayoutStore((s) => s.setStatusConn);
  const drainRemovedTabs = useLayoutStore((s) => s.drainRemovedTabs);
  const removedTabs = useLayoutStore((s) => s.removedTabQueue);
  const notifyTabMoved = useLayoutStore((s) => s.notifyTabMoved);
  const connections = useConnectionStore((s) => s.connections);
  const userRole = useAuthStore((s) => s.user?.role);

  useEffect(() => {
    paneTabsCache.set(nodeId, tabs);
    paneActiveCache.set(nodeId, activeTabId);
    notify();
  }, [tabs, activeTabId, nodeId]);

  useEffect(() => {
    if (focusedPaneId !== nodeId || queuedTabs.length === 0) return;
    const queue = drainTabQueue();
    if (queue.length === 0) return;
    const timer = window.setTimeout(() => {
      setTabs((prev) => {
        const ids = new Set(prev.map((tab) => tab.id));
        return [...prev, ...queue.filter((tab) => !ids.has(tab.id))];
      });
      setActiveTabId(queue[queue.length - 1].id);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [drainTabQueue, focusedPaneId, nodeId, queuedTabs]);

  useEffect(() => {
    if (removedTabs.length === 0) return;
    const removed = drainRemovedTabs();
    if (removed.length === 0) return;
    const timer = window.setTimeout(() => setTabs((prev) => prev.filter((tab) => !removed.includes(tab.id))), 0);
    return () => window.clearTimeout(timer);
  }, [drainRemovedTabs, removedTabs]);

  const handleAddTab = (connId: number, name: string, type: string) => {
    const tab: Tab = { id: nextLayoutID(`${type}-${connId}`), type: type as Tab['type'], title: name, connId };
    setTabs((prev) => [...prev, tab]); setActiveTabId(tab.id);
  };
  const openLocalQuickTab = async () => {
    const data = await apiPost('/api/quick-connect/local', {});
    handleAddTab(data.connection.id, data.connection.name, 'ssh');
  };
  const handleReceiveTab = (tab: Tab) => {
    setTabs((prev) => { if (prev.find((t) => t.id === tab.id)) return prev; return [...prev, tab]; });
    setActiveTabId(tab.id); notifyTabMoved(tab.id);
  };
  const closeTab = (id: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (next.length === 0 && isInSplit) {
          setTimeout(() => {
            doRemovePane(nodeId);
            setFocusedPane(layoutRoot.type === 'leaf' ? layoutRoot.id : 'root');
          }, 0);
          return next;
        }
      if (activeTabId === id) setActiveTabId(next.length > 0 ? next[next.length - 1].id : null);
      return next;
    });
  };
  const handleSplit = (dir: Direction) => {
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (!activeTab?.connId) return;

    const newPaneId = nextLayoutID('pane');
    const newTab: Tab = { ...activeTab, id: nextLayoutID(`${activeTab.type}-${activeTab.connId}`) };
    // Pre-cache tab BEFORE doSplit so the new LeafPane finds it on first mount
    paneTabsCache.set(newPaneId, [newTab]);
    paneActiveCache.set(newPaneId, newTab.id);
    const resultId = doSplit(nodeId, dir, newPaneId);
    if (resultId) setTimeout(() => setFocusedPane(resultId), 100);
  };
  const handleClosePane = () => { if (isInSplit) doRemovePane(nodeId); };
  const handleQuadSplit = () => {
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (!activeTab?.connId) return;
    const vId1 = nextLayoutID('pane');
    const vId2 = nextLayoutID('pane');
    const tab1: Tab = { ...activeTab, id: nextLayoutID(`${activeTab.type}-${activeTab.connId}`) };
    const tab2: Tab = { ...activeTab, id: nextLayoutID(`${activeTab.type}-${activeTab.connId}`) };
    paneTabsCache.set(vId1, [tab1]);
    paneTabsCache.set(vId2, [tab2]);
    paneActiveCache.set(vId1, tab1.id);
    paneActiveCache.set(vId2, tab2.id);
    const horizId = doSplit(nodeId, 'horizontal');
    if (!horizId) return;
    setTimeout(() => {
      doSplit(nodeId, 'vertical', vId1);
      doSplit(horizId, 'vertical', vId2);
    }, 0);
  };

  const activeTab = tabs.find((t) => t.id === activeTabId);
  // Helper: check if a connId still has any active tab across all panes
  const connHasTabs = (cId: number) => {
    for (const t of paneTabsCache.values()) {
      if (t.some((tab) => tab.connId === cId)) return true;
    }
    return false;
  };

  const prevConnRef = useRef<number | null>(null);
  useEffect(() => {
    if (activeTab?.connId) {
      onActiveSshChange?.(activeTab.connId, activeTab.id);
      const conn = connections.find((c) => c.id === activeTab.connId);
      if (conn) setStatusConn({ name: conn.name, host: conn.host, connected: true });
      prevConnRef.current = activeTab.connId;
    } else if (tabs.length === 0 && !isInSplit) {
      // Root pane empty — check if any pane still has tabs
      for (const t of paneTabsCache.values()) { if (t.length > 0) return; }
      onActiveSshChange?.(null, null);
      prevConnRef.current = null;
    } else if (prevConnRef.current != null && !connHasTabs(prevConnRef.current)) {
      // Last tab for this connId was closed — notify SFTP to release this connId
      useLayoutStore.getState().pruneSftpConn(prevConnRef.current);
      onActiveSshChange?.(-prevConnRef.current, null);
      prevConnRef.current = null;
    }
  }, [activeTab?.connId, activeTab?.id, connections, isInSplit, onActiveSshChange, setStatusConn, tabs.length]);
  // Also sync SFTP when this pane gains focus
  useEffect(() => {
    if (focusedPaneId === nodeId && activeTab?.connId) {
      onActiveSshChange?.(activeTab.connId, activeTab.id);
      const conn = connections.find((c) => c.id === activeTab.connId);
      if (conn) setStatusConn({ name: conn.name, host: conn.host, connected: true });
    }
  }, [focusedPaneId, nodeId, activeTab?.connId, activeTab?.id, onActiveSshChange, connections, setStatusConn]);

  return (
    <div onClick={() => setFocusedPane(nodeId)} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0, minHeight: 0 }}>
      {tabs.length > 0 && (
        <TabBar tabs={tabs} activeTabId={activeTabId} onSelectTab={setActiveTabId} onCloseTab={closeTab} filterType="ssh"
          connections={connections} onAddTab={handleAddTab} onReceiveTab={handleReceiveTab}
          quickConnect={userRole === 'admin' ? { label: '新增本机会话', onClick: openLocalQuickTab } : undefined} />
      )}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {tabs.map((tab) => (
          <div key={tab.id} style={{ flex: 1, display: tab.id === activeTabId ? 'flex' : 'none', overflow: 'hidden' }}>
            {tab.type === 'ssh' && tab.connId && (
              <Suspense fallback={<div style={{ padding: 12, fontSize: font.md, color: colors.textMuted }}>Loading…</div>}>
                <TerminalTab connId={tab.connId} myTabId={tab.id} paneTabs={tabs} extraMenuItems={[
                  { label: t('term_split_h'), action: () => handleSplit('horizontal') },
                  { label: t('term_split_v'), action: () => handleSplit('vertical') },
                  { label: t('term_split_quad'), action: handleQuadSplit },
                  ...(isInSplit ? [{ label: t('term_close_pane'), action: handleClosePane }] : []),
                ]} />
              </Suspense>
            )}
            {tab.type === 'database' && tab.connId && (
              <Suspense fallback={<div style={{ padding: 12, fontSize: font.md, color: colors.textMuted }}>Loading…</div>}>
                <QueryEditor connId={tab.connId} />
              </Suspense>
            )}
          </div>
        ))}
        {tabs.length === 0 && <SessionWelcome />}
      </div>
    </div>
  );
}

// Top-level grid container — ALL panes are direct children with stable keys
function GridContainer({ onActiveSshChange }: { onActiveSshChange?: (connId: number | null, tabId: string | null) => void }) {
  const [, forceUpdate] = useState(0);

  useEffect(() => subscribe(() => forceUpdate((n) => n + 1)), []);

  const { cols, rows, cells } = computeGrid(layoutRoot);
  const cellMap = new Map(cells.map((c) => [c.id, c]));
  const paneIds = Array.from(allPaneIds);
  const isInSplit = layoutRoot.type !== 'leaf';

  // Build grid-template-areas
  const grid: string[][] = Array.from({ length: rows }, () => Array(cols).fill('.'));
  for (const cell of cells) {
    for (let r = cell.row - 1; r < cell.row - 1 + cell.rowSpan; r++) {
      for (let c = cell.col - 1; c < cell.col - 1 + cell.colSpan; c++) {
        if (r < rows && c < cols) grid[r][c] = cell.id;
      }
    }
  }
  const gridTemplateAreas = grid.map((row) => `"${row.join(' ')}"`).join(' ');

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gridTemplateRows: `repeat(${rows}, 1fr)`,
      gridTemplateAreas,
      flex: 1, overflow: 'hidden', minWidth: 0, minHeight: 0,
      gap: 1, background: colors.border,
    }}>
      {paneIds.map((id) => {
        const cell = cellMap.get(id);
        return (
          <div key={id} style={{
            gridArea: cell ? id : undefined,
            display: cell ? 'flex' : 'none',
            overflow: 'hidden',
          }}>
            <LeafPane key={`${id}-${layoutRestoreVersion}`} nodeId={id} onActiveSshChange={onActiveSshChange} isInSplit={isInSplit && cellMap.has(id)} />
          </div>
        );
      })}
    </div>
  );
}

const banner = [
  ' _    _  _____  _____  _____  _____  _____  __  __ ',
  '| |  | ||  ___||  __ \\|_   _||  ___||  __ \\|  \\/  |',
  '| |  | || |__  | |__) | | |  | |__  | |__) | \\  / |',
  '| |/\\| ||  __| |  _  /  | |  |  __| |  _  /| |\\/| |',
  '\\  /\\  /| |___ | | \\ \\  | |  | |___ | | \\ \\| |  | |',
  ' \\/  \\/ |_____||_|  \\_\\ \\_/  |_____||_|  \\_\\|_|  |_|',
];

function SessionWelcome() {
  const [tick, setTick] = useState(0);
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const setAuth = useAuthStore((s) => s.setAuth);
  const requestTab = useLayoutStore((s) => s.requestTab);
  const [step, setStep] = useState<'user' | 'pass' | 'done'>('user');
  const [username, setUsername] = useState(localStorage.getItem('webterm-rm-user') || '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [lines, setLines] = useState<string[]>([]);
  const [remember, setRemember] = useState(!!localStorage.getItem('webterm-rm-user'));
  const [quickConnectError, setQuickConnectError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const savedPwd = localStorage.getItem('webterm-rm-pwd') || '';

  const append = (text: string) => setLines((l) => [...l, text]);

  const handleLogin = async (user: string, pass: string) => {
    setError('');
    try {
      const data = await apiPost('/api/auth/login', { username: user, password: pass });
      if (remember) {
        localStorage.setItem('webterm-rm-user', user);
        localStorage.setItem('webterm-rm-pwd', pass);
      } else {
        localStorage.removeItem('webterm-rm-user');
        localStorage.removeItem('webterm-rm-pwd');
      }
      setStep('done');
      setLines([
        `<span style="color:var(--c-accent)">login:</span> ${user}`,
        `<span style="color:var(--c-accent)">password:</span>`,
        `<span style="color:#9ece6a">Welcome, ${data.user.username}!</span>`,
      ]);
      setTimeout(() => {
        // Clear all connection state before setting new auth
        if (useConnectionStore.getState().connections.length > 0) {
          useConnectionStore.setState({ connections: [], groups: [], dbConnections: [] });
        }
        setAuth(data.user, data.token);
      }, 1000);
    } catch {
      setStep('done');
      setLines([
        `<span style="color:var(--c-accent)">login:</span> ${user}`,
        `<span style="color:var(--c-accent)">password:</span>`,
        `<span style="color:var(--c-danger-bright)">${t('login_error')}</span>`,
      ]);
      setTimeout(() => { setLines([]); setStep('user'); setUsername(''); setPassword(''); }, 1000);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== 'Tab') return;
    e.preventDefault();
    if (step === 'user') {
      const u = username.trim();
      if (!u) return;
      append(`<span style="color:var(--c-accent)">login:</span> ${u}`);
      if (remember && savedPwd && u === localStorage.getItem('webterm-rm-user')) {
        handleLogin(u, savedPwd);
        return;
      }
      setStep('pass');
    } else {
      handleLogin(username.trim(), password);
    }
  };

  const openLocalQuickConnection = async () => {
    setQuickConnectError('');
    try {
      const data = await apiPost('/api/quick-connect/local', {});
      requestTab({
        id: `ssh-${data.connection.id}-${Date.now()}`,
        type: 'ssh',
        title: data.connection.name,
        connId: data.connection.id,
      });
    } catch {
      setQuickConnectError('本机连接暂不可用，请检查部署状态。');
    }
  };

  // Focus input when step changes
  useEffect(() => { inputRef.current?.focus(); }, [step]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', background: colors.bg, position: 'relative', overflow: 'hidden' }}>
      <MatrixRain key={tick} fontSize={22} columns={24} opacity={0.5} />
      <div onClick={() => setTick((n) => n + 1)}
        style={{ position: 'absolute', top: '60%', left: '50%', transform: 'translate(-50%, -50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, cursor: 'pointer', zIndex: 1, fontFamily: '"JetBrains Maple Mono", "JetBrains Mono", "Courier New", monospace' }}>
          <pre style={{
            margin: 0, fontSize: font.xl3, lineHeight: 1.25, fontWeight: 700,
            color: colors.accent,
            textShadow: `
              1px 1px 0 var(--c-purple),
              2px 2px 0 var(--c-accent),
              3px 3px 0 var(--c-accent80),
              4px 4px 0 var(--c-accent60),
              5px 5px 0 var(--c-accent-mid),
              6px 6px 0 var(--c-accent-faint),
              0 0 20px var(--c-accent-mid)
            `,
          }}>
            {banner.join('\n')}
          </pre>
          <div style={{ color: colors.textMuted, fontSize: font.xl, letterSpacing: 1 }}>{t('app_slogan')}</div>
        </div>

        {!token && (
          <div onClick={() => inputRef.current?.focus()}
            style={{
              position: 'absolute', top: '70%', left: '50%', transform: 'translateX(-50%)',
              fontFamily: '"JetBrains Maple Mono", "JetBrains Mono", "Courier New", monospace',
              fontSize: font.xl, color: colors.text, width: 320, zIndex: 1,
              padding: '16px 20px', cursor: 'text',
            }}>
            {lines.map((l, i) => (
              <div key={i} style={{ lineHeight: 1.8 }} dangerouslySetInnerHTML={{ __html: l }} />
            ))}
            {error && <div style={{ color: colors.dangerBright, lineHeight: 1.8 }}>{error}</div>}
            {step !== 'done' && (
            <div style={{ display: 'flex', alignItems: 'center', lineHeight: 1.8 }}>
              <span style={{ color: colors.accent, marginRight: 8 }}>
                {step === 'user' ? 'login:' : 'password:'}
              </span>
              <input ref={inputRef}
                className="login-input"
                type={step === 'user' ? 'text' : 'password'}
                value={step === 'user' ? username : password}
                onChange={(e) => step === 'user' ? setUsername(e.target.value) : setPassword(e.target.value)}
                onKeyDown={onKey}
                autoFocus
                style={{
                  flex: 1, background: 'none', border: 'none', color: colors.text,
                  fontSize: font.xl, outline: 'none', fontFamily: 'inherit',
                  caretColor: colors.accent, caretShape: 'block',
                }} />
            </div>
            )}
            {step !== 'done' && (
            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
              onClick={() => setRemember(!remember)}>
              <span style={{
                width: 13, height: 13, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '1px solid var(--c-border)', background: remember ? colors.accent : 'rgba(31,35,53,0.5)', flexShrink: 0,
              }}>
                {remember && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={colors.bg} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
              </span>
              <span style={{ color: colors.textMuted, fontSize: font.md, userSelect: 'none' }}>
                remember
              </span>
            </div>
            )}
          </div>
        )}
        {token && user?.role === 'admin' && (
          <div style={{ position: 'absolute', top: '70%', left: '50%', transform: 'translateX(-50%)', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <button onClick={openLocalQuickConnection}
              style={{ padding: '10px 18px', border: '1px solid var(--c-accent)', borderRadius: 6, background: colors.accent, color: colors.bg, cursor: 'pointer', fontSize: font.lg, fontWeight: 700 }}>
              连接到本机 127.0.0.1:22
            </button>
            {quickConnectError && <span style={{ color: colors.dangerBright, fontSize: font.md }}>{quickConnectError}</span>}
          </div>
        )}
      </div>
  );
}


// Expose for SFTP panel to check active connIds
(window as unknown as { __paneTabsCache: Map<string, Tab[]> }).__paneTabsCache = paneTabsCache;

function LayoutSync({ token, onMessage }: { token: string; onMessage: (raw: string) => void }) {
  useWebSocket({ url: layoutSocketURL(token), onMessage });
  return null;
}

export default function SplitPane({ onActiveSshChange }: { onActiveSshChange?: (connId: number | null, tabId: string | null) => void }) {
  const token = useAuthStore((s) => s.token);
  const userID = useAuthStore((s) => s.user?.id);
  const revisionRef = useRef(0);
  const persistedLayoutRef = useRef('');
  const restoredAtRef = useRef(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [layoutMessage, setLayoutMessage] = useState('');

  const applyLayout = useCallback((response: { revision: number; layout: unknown; skipped_tabs: number }) => {
    revisionRef.current = response.revision;
    restoreLayout(response.layout);
    persistedLayoutRef.current = JSON.stringify(layoutSnapshot());
    restoredAtRef.current = Date.now();
    if (response.skipped_tabs > 0) setLayoutMessage(`已跳过 ${response.skipped_tabs} 个无法访问的已保存标签页。`);
  }, []);

  const loadLayout = useCallback(async (minimumRevision = 0) => {
    const response = await apiGet('/api/layout');
    if (response.revision < minimumRevision) return;
    applyLayout(response);
  }, [applyLayout]);

  useEffect(() => {
    let active = true;
    if (!token || !userID) {
      restoreLayout(emptyPersistedLayout());
      return () => { active = false; };
    }
    const clearMessageTimer = window.setTimeout(() => setLayoutMessage(''), 0);
    void apiGet('/api/layout').then((response) => {
      if (!active) return;
      applyLayout(response);
    }).catch(() => {
      if (active) setLayoutMessage('无法恢复已保存布局；当前会话仍可继续使用。');
    });
    return () => { active = false; window.clearTimeout(clearMessageTimer); };
  }, [applyLayout, token, userID]);

  useEffect(() => {
    if (!token || !userID) return;
    const scheduleSave = () => {
      if (Date.now() - restoredAtRef.current < 500) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        const layout = layoutSnapshot();
        const serializedLayout = JSON.stringify(layout);
        if (!shouldPersistLayout(serializedLayout, persistedLayoutRef.current)) return;
        void apiPut('/api/layout', {
          schema_version: 1,
          revision: revisionRef.current,
          layout,
        }).then((response) => {
          revisionRef.current = response.revision;
          persistedLayoutRef.current = serializedLayout;
          setLayoutMessage('');
        }).catch((error: Error) => {
          if (error.message.includes('layout revision conflict')) {
            setLayoutMessage('布局已在另一端更新，正在同步最新布局。');
            void loadLayout().catch(() => setLayoutMessage('布局同步失败；请稍后重试。'));
            return;
          }
          setLayoutMessage('布局保存失败；请稍后重试。');
        });
      }, 500);
    };
    const stopLayout = subscribe(scheduleSave);
    const stopStore = useLayoutStore.subscribe(scheduleSave);
    return () => {
      stopLayout();
      stopStore();
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [loadLayout, token, userID]);

  return <>
    {token && <LayoutSync token={token} onMessage={(raw) => {
      const revision = layoutEventRevision(raw, revisionRef.current);
      if (revision !== null) void loadLayout(revision).catch(() => setLayoutMessage('无法同步另一端更新的布局；请稍后重试。'));
    }} />}
    <GridContainer onActiveSshChange={onActiveSshChange} />
    {layoutMessage && <div role="status" style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 20, padding: '8px 12px', borderRadius: 4, background: colors.bgRaised, border: `1px solid ${colors.border}`, color: colors.text, fontSize: font.md }}>{layoutMessage}</div>}
  </>;
}
