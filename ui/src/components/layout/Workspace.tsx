import { useState, useRef, useCallback } from 'react';
import ActivityBar from './ActivityBar';
import Sidebar from './Sidebar';
import MainArea from './MainArea';
import SettingsPanel from '../config/SettingsPanel';
import Icon from '../common/Icon';
import { useLayoutStore } from '../../store/layout';
import { t } from '../../i18n';
import { colors, font } from '../../theme/tokens';
import { useMobileViewport } from './useMobileViewport';

export default function Workspace() {
  const viewportRef = useMobileViewport();
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const statusConn = useLayoutStore((s) => s.statusConn);
  const [sidebarWidth, setSidebarWidth] = useState(210);
  const dragRef = useRef({ startX: 0, startW: 0, dragging: false });

  const onSidebarResizeStart = useCallback((e: React.MouseEvent) => {
    dragRef.current = { startX: e.clientX, startW: sidebarWidth, dragging: true };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current.dragging) return;
      const w = Math.max(120, Math.min(500, dragRef.current.startW + ev.clientX - dragRef.current.startX));
      setSidebarWidth(w);
    };
    const onUp = () => { dragRef.current.dragging = false; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [sidebarWidth]);

  return (
    <div ref={viewportRef} className="app-shell" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div className="app-body" style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
        <ActivityBar onOpenSettings={() => setShowSettings(true)} sidebarCollapsed={sidebarCollapsed} onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)} />
        <Sidebar collapsed={sidebarCollapsed} width={sidebarWidth} />
        <MainArea />
        {/* Resize handle overlaid on sidebar right edge */}
        {!sidebarCollapsed && (
          <div onMouseDown={onSidebarResizeStart}
            style={{
              position: 'absolute', left: 38 + sidebarWidth - 3, top: 0, bottom: 0,
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
            <div style={{ width: 0, height: '100%', background: colors.accent, transition: 'width 0.1s' }} />
            <span style={{ position: 'absolute', color: colors.accent, userSelect: 'none', background: colors.bg, padding: '2px 0', opacity: 0, transition: 'opacity 0.1s', display: 'flex', alignItems: 'center' }}><Icon name="grip-vertical" size={12} /></span>
          </div>
        )}
      </div>
      {showSettings && (
        <SettingsPanel onClose={() => setShowSettings(false)} />
      )}
      {/* Global status bar */}
      <div className="app-statusbar" style={{
        height: 22, flexShrink: 0, background: colors.bg, borderTop: '1px solid var(--c-border)',
        display: 'flex', alignItems: 'center', padding: '0 10px',
        fontSize: font.sm, color: colors.accent, gap: 10, lineHeight: '26px',
      }}>
        <span style={{ opacity: 0.7, flexShrink: 0 }}>webterm</span>
        <span style={{ flex: 1 }} />
        {statusConn ? (
          <>
            <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
              background: statusConn.connected ? colors.success : colors.danger,
            }} />
            <span style={{ minWidth: 64, textAlign: 'center', flexShrink: 0, whiteSpace: 'nowrap' }}>{statusConn.connected ? t('status_connected') : t('status_disconnected')}</span>
            <span style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>{statusConn.name}{statusConn.host ? ` (${statusConn.host})` : ''}</span>
          </>
        ) : (
          <span style={{ color: colors.textDim, flexShrink: 0 }}>{t('status_disconnected')}</span>
        )}
      </div>
    </div>
  );
}
