import { lazy, Suspense, useState, useEffect } from 'react';
import { normalizeModuleType, useLayoutStore } from '../../store/layout';
import type { Tab } from '../../store/layout';
import { useConnectionStore } from '../../store/connections';
import SplitPane from './SplitPane';
import DualPaneSftp from '../sftp/DualPaneSftp';
import ConfigPage from '../config/ConfigPage';
const QueryEditor = lazy(() => import('../database/QueryEditor'));
import TabBar from './TabBar';
import { colors, font } from '../../theme/tokens';

export default function MainArea() {
  // Normalize at the rendering boundary too so a legacy persisted `sftp`
  // snapshot cannot restore into an empty workspace before migration runs.
  const activeModule = normalizeModuleType(useLayoutStore((s) => s.activeModule));
  const connections = useConnectionStore((s) => s.connections);
  const drainTabQueue = useLayoutStore((s) => s.drainTabQueue);
  const [dbTabs, setDbTabs] = useState<Tab[]>([]);
  const [dbActiveTabId, setDbActiveTabId] = useState<string | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      const queue = drainTabQueue('database');
      if (queue.length > 0) {
        const newDb = queue.filter((t) => t.type === 'database');
        if (newDb.length > 0) {
          setDbTabs((prev) => {
            const ids = new Set(prev.map((t) => t.id));
            return [...prev, ...newDb.filter((t) => !ids.has(t.id))];
          });
          setDbActiveTabId(newDb[newDb.length - 1].id);
        }
      }
    }, 100);
    return () => clearInterval(interval);
  }, [drainTabQueue]);

  const dbCloseTab = (id: string) => {
    setDbTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (dbActiveTabId === id) {
        setDbActiveTabId(next.length > 0 ? next[next.length - 1].id : null);
      }
      return next;
    });
  };
  const dbRenameTab = (id: string, title: string) => {
    setDbTabs((prev) => prev.map((tab) => tab.id === id ? { ...tab, title } : tab));
  };

  const dbActiveTab = dbTabs.find((t) => t.id === dbActiveTabId);
  const show = (m: string) => activeModule === m ? 'flex' : 'none';

  return (
    <div className="main-area-shell" style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      {/* SSH module */}
      <div style={{ flex: 1, display: show('ssh'), overflow: 'hidden', position: 'relative' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          <SplitPane />
        </div>
      </div>

      {/* Unified local/remote file workspace. */}
      <div data-testid="file-workspace" style={{ flex: 1, display: show('files'), flexDirection: 'column', overflow: 'hidden' }}>
        <DualPaneSftp connections={connections} />
      </div>

      {/* Database module */}
      <div style={{ flex: 1, display: show('database'), flexDirection: 'column', overflow: 'hidden' }}>
        <TabBar tabs={dbTabs} activeTabId={dbActiveTabId} onSelectTab={setDbActiveTabId} onCloseTab={dbCloseTab} onRenameTab={dbRenameTab} filterType="database" />
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {dbActiveTab?.type === 'database' && dbActiveTab.connId ? (
            <Suspense fallback={<div style={{ padding: 12, fontSize: font.md, color: colors.textMuted }}>Loading…</div>}>
              <QueryEditor connId={dbActiveTab.connId} />
            </Suspense>
          ) : null}
        </div>
      </div>

      {/* Config module */}
      <div style={{ flex: 1, display: show('config'), flexDirection: 'column', overflow: 'hidden' }}>
        <ConfigPage />
      </div>
    </div>
  );
}
