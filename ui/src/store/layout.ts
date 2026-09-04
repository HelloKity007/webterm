import { create } from 'zustand';

export type ModuleType = 'ssh' | 'sftp' | 'database' | 'config';
export type BroadcastScope = 'off' | 'pane' | 'all';

export interface Tab {
  id: string;
  type: ModuleType;
  title: string;
  connId?: number;
  // Shared, immutable label shown before the editable title (for example 3:).
  labelNumber?: number;
}

interface LayoutState {
  activeModule: ModuleType;
  newTabQueue: Tab[];
  sftpCdPaths: Record<string, string>;
  focusedPaneId: string | null;
  broadcastScope: BroadcastScope;
  broadcastSourceId: string | null;
  terminalRegistry: string[];
  removedTabQueue: string[];
  setActiveModule: (m: ModuleType) => void;
  requestTab: (tab: Tab) => void;
  drainTabQueue: (type?: Tab['type']) => Tab[];
  drainRemovedTabs: () => string[];
  notifyTabMoved: (tabId: string) => void;
  setSftpCdPath: (tabId: string, path: string) => void;
  setFocusedPane: (paneId: string | null) => void;
  setBroadcastScope: (scope: BroadcastScope) => void;
  setBroadcastSource: (id: string | null) => void;
  registerTerminal: (tabId: string) => void;
  unregisterTerminal: (tabId: string) => void;
  sftpDisconnectSignal: number;
  signalSftpDisconnect: () => void;
  sftpPruneConn: number | null;
  pruneSftpConn: (connId: number) => void;
  statusConn: { name: string; host: string; connected: boolean } | null;
  setStatusConn: (info: { name: string; host: string; connected: boolean } | null) => void;
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
      activeModule: 'ssh',
      newTabQueue: [],
      sftpCdPaths: {},
      focusedPaneId: 'root',
      broadcastScope: 'off',
      broadcastSourceId: null,
      terminalRegistry: [],
      removedTabQueue: [],
      sftpDisconnectSignal: 0,
      sftpPruneConn: null,
      pruneSftpConn: (connId) => set({ sftpPruneConn: connId }),
      statusConn: null,
      setStatusConn: (info) => set({ statusConn: info }),
      signalSftpDisconnect: () => set((s) => ({ sftpDisconnectSignal: s.sftpDisconnectSignal + 1 })),
      setActiveModule: (m) => set({ activeModule: m }),
      requestTab: (tab) => set((s) => ({ newTabQueue: [...s.newTabQueue, tab] })),
      drainTabQueue: (type) => {
        const queue = get().newTabQueue;
        if (!type) {
          if (queue.length > 0) set({ newTabQueue: [] });
          return queue;
        }
        const matched = queue.filter((tab) => tab.type === type);
        if (matched.length > 0) set({ newTabQueue: queue.filter((tab) => tab.type !== type) });
        return matched;
      },
      drainRemovedTabs: () => {
        const queue = get().removedTabQueue;
        if (queue.length > 0) set({ removedTabQueue: [] });
        return queue;
      },
      notifyTabMoved: (tabId) => set((s) => ({ removedTabQueue: [...s.removedTabQueue, tabId] })),
      setFocusedPane: (paneId) => set({ focusedPaneId: paneId }),
      setSftpCdPath: (tabId, path) => set((s) => ({ sftpCdPaths: { ...s.sftpCdPaths, [tabId]: path } })),
      setBroadcastScope: (scope) => set({ broadcastScope: scope, broadcastSourceId: scope !== 'off' ? get().broadcastSourceId : null }),
      setBroadcastSource: (id) => set({ broadcastSourceId: id }),
      registerTerminal: (tabId) => set((s) => {
        if (s.terminalRegistry.includes(tabId)) return s;
        return { terminalRegistry: [...s.terminalRegistry, tabId] };
      }),
      unregisterTerminal: (tabId) => set((s) => ({
        terminalRegistry: s.terminalRegistry.filter((id) => id !== tabId),
      })),
}));
