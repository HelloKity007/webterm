import { lazy, Suspense, useState, useEffect, useCallback, useRef } from 'react';
import { useLayoutStore } from '../../store/layout';
import { t } from '../../i18n';
import type { Tab } from '../../store/layout';
import { useConnectionStore } from '../../store/connections';
import Icon from '../common/Icon';
import SplitPane from './SplitPane';
import DualPaneSftp from '../sftp/DualPaneSftp';
import SftpPanel from '../sftp/SftpPanel';
import ConfigPage from '../config/ConfigPage';
const QueryEditor = lazy(() => import('../database/QueryEditor'));
import TabBar from './TabBar';
import { colors, font } from '../../theme/tokens';

export default function MainArea() {
  const activeModule = useLayoutStore((s) => s.activeModule);
  const connections = useConnectionStore((s) => s.connections);
  const drainTabQueue = useLayoutStore((s) => s.drainTabQueue);
  const [sftpCollapsed, setSftpCollapsed] = useState(false);
  const [sftpWidth, setSftpWidth] = useState(260);
  const sftpDragRef = useRef({ startX: 0, startW: 0, dragging: false });
  const [sftpCtx, setSftpCtx] = useState<{ connId: number; tabId: string } | null>(null);

  const onSftpResizeStart = useCallback((e: React.MouseEvent) => {
    sftpDragRef.current = { startX: e.clientX, startW: sftpWidth, dragging: true };
    const onMove = (ev: MouseEvent) => {
      if (!sftpDragRef.current.dragging) return;
      const w = Math.max(160, Math.min(600, sftpDragRef.current.startW - (ev.clientX - sftpDragRef.current.startX)));
      setSftpWidth(w);
    };
    const onUp = () => { sftpDragRef.current.dragging = false; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [sftpWidth]);
  const handleActiveSsh = useCallback((connId: number | null, tabId: string | null) => {
    // Negative connId: signal to close SFTP for that connId if it's the current one
    if (connId != null && connId < 0) {
      setSftpCtx((prev) => prev && prev.connId === -connId ? null : prev);
      return;
    }
    if (connId == null || tabId == null) { setSftpCtx(null); return; }
    setSftpCtx((prev) => {
      if (prev && prev.connId === connId && prev.tabId === tabId) return prev;
      return { connId, tabId };
    });
  }, []);
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
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      {/* SSH module */}
      <div style={{ flex: 1, display: show('ssh'), overflow: 'hidden', position: 'relative' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          <SplitPane onActiveSshChange={handleActiveSsh} />
        </div>
        {sftpCtx ? (
          <>
            <div style={{ width: sftpCollapsed ? 0 : sftpWidth, flexShrink: 0, borderLeft: sftpCollapsed ? 'none' : '1px solid var(--c-border)', overflow: 'hidden' }}>
              <SftpPanel connId={sftpCtx.connId} tabId={sftpCtx.tabId} />
            </div>
            <button onClick={() => setSftpCollapsed(!sftpCollapsed)} title={sftpCollapsed ? t('sftp_expand') : t('sftp_collapse')}
              style={{
                width: 20, flexShrink: 0, background: colors.bg, border: 'none',
                borderLeft: '1px solid var(--c-border)', color: colors.textGray, cursor: 'pointer',
                fontSize: font.xs, padding: 0,
              }}>
              <Icon name={sftpCollapsed ? 'chevron-left' : 'chevron-right'} size={12} color={colors.textGray} />
            </button>
          </>
        ) : null}
        {/* Resize handle overlaid on SFTP left edge */}
        {sftpCtx && !sftpCollapsed && (
          <div onMouseDown={onSftpResizeStart}
            style={{
              position: 'absolute', right: sftpWidth + 20 - 3, top: 0, bottom: 0,
              width: 6, cursor: 'col-resize', zIndex: 10,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            onMouseEnter={(e) => {
              const line = e.currentTarget.firstChild as HTMLElement;
              line.style.width = '2px'; line.style.background = colors.border;
              (e.currentTarget.lastChild as HTMLElement).style.opacity = '1';
            }}
            onMouseLeave={(e) => {
              const line = e.currentTarget.firstChild as HTMLElement;
              line.style.width = '0px';
              (e.currentTarget.lastChild as HTMLElement).style.opacity = '0';
            }}>
            <div style={{ width: 0, height: '100%', background: colors.accent }} />
            <span style={{ position: 'absolute', color: colors.accent, userSelect: 'none', background: colors.bg, padding: '2px 0', opacity: 0, display: 'flex', alignItems: 'center' }}><Icon name="grip-vertical" size={12} /></span>
          </div>
        )}
      </div>

      {/* SFTP module */}
      <div style={{ flex: 1, display: show('sftp'), flexDirection: 'column', overflow: 'hidden' }}>
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
