import { t } from '../../i18n';
import React, { useState, useRef, useEffect } from 'react';
import { useLayoutStore } from '../../store/layout';
import type { Tab, BroadcastScope } from '../../store/layout';
import Icon from '../common/Icon';
import { colors, font } from '../../theme/tokens';

interface Props {
  tabs: Tab[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onAddTab?: (connId: number, name: string, type: string) => void;
  onReceiveTab?: (tab: Tab) => void;
  filterType?: string;
  connections?: { id: number; name: string }[];
  quickConnect?: { label: string; onClick: () => void | Promise<void> };
}

const scopeLabels: Record<BroadcastScope, string> = {
  off: t('broadcast_off'),
  pane: t('broadcast_pane'),
  all: t('broadcast_all'),
};

export default function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab, onAddTab, onReceiveTab, filterType, connections, quickConnect }: Props) {
  const filtered = filterType ? tabs.filter((t) => t.type === filterType) : tabs;
  const broadcastScope = useLayoutStore((s) => s.broadcastScope);
  const setBroadcastScope = useLayoutStore((s) => s.setBroadcastScope);
  const [showPicker, setShowPicker] = useState(false);
  const [dragOverAdd, setDragOverAdd] = useState(false);
  const [quickConnectError, setQuickConnectError] = useState('');
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showPicker) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setShowPicker(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPicker]);

  const cycleScope = () => {
    const order: BroadcastScope[] = ['off', 'pane', 'all'];
    const idx = order.indexOf(broadcastScope);
    setBroadcastScope(order[(idx + 1) % order.length]);
  };

  return (
    <div style={{ display: 'flex', background: colors.bg, height: 36, alignItems: 'center', padding: '0 6px', gap: 2, flexShrink: 0, overflow: 'visible', borderBottom: '1px solid var(--c-border)' }}>
      {filtered.map((tab, idx) => (
        <React.Fragment key={tab.id}>
          {idx > 0 && (
            <span style={{
              width: 1, height: 16, flexShrink: 0, alignSelf: 'center',
              background: (activeTabId !== tab.id && activeTabId !== filtered[idx-1]?.id) ? colors.border : 'transparent',
            }} />
          )}
          <div
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('text/plain', JSON.stringify({ id: tab.id, title: tab.title, type: tab.type, connId: tab.connId }));
              e.dataTransfer.effectAllowed = 'move';
            }}
            onClick={() => onSelectTab(tab.id)}
            style={{
              padding: '4px 14px', fontSize: font.md, borderRadius: 5, cursor: 'pointer',
              background: activeTabId === tab.id ? colors.accent : 'transparent',
              color: activeTabId === tab.id ? colors.bg : colors.textMuted2,
              display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap',
              height: 28, marginBottom: 0,
              transition: 'background 0.1s',
            }}>
            {tab.title}
            <span onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
              style={{ color: colors.textMuted, cursor: 'pointer', borderRadius: '50%', width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = colors.border; e.currentTarget.style.color = colors.bg; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = colors.textMuted; }}><Icon name="x" size={11} /></span>
          </div>
        </React.Fragment>
      ))}
      {/* Add tab button with connection picker */}
      {quickConnect && (
        <button type="button" aria-label={quickConnect.label} title={quickConnect.label}
          onClick={() => { setQuickConnectError(''); void Promise.resolve(quickConnect.onClick()).catch(() => setQuickConnectError('本机会话创建失败，请稍后重试。')); }}
          style={{ border: 0, padding: '2px 6px', cursor: 'pointer', color: colors.accent, background: 'transparent', borderRadius: 4, marginBottom: 2, display: 'flex', alignItems: 'center' }}>
          <Icon name="plus" size={14} />
        </button>
      )}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <span onClick={() => setShowPicker(!showPicker)} title={t("tab_new")}
          style={{ padding: '2px 6px', cursor: 'pointer', color: showPicker ? colors.accent : colors.textMuted, borderRadius: 4, marginBottom: 2, display: 'flex', alignItems: 'center' }}>
          <Icon name="plus" size={14} />
        </span>
        {showPicker && connections && connections.length > 0 && (
          <div ref={pickerRef} style={{
            position: 'absolute', top: '100%', left: 0, zIndex: 1000,
            background: colors.bgInput, border: '1px solid var(--c-border)', borderRadius: 4,
            minWidth: 160, maxHeight: 200, overflow: 'auto', padding: '4px 0',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          }}>
            {connections.map((c) => (
              <div key={c.id} onClick={() => { onAddTab?.(c.id, c.name, 'ssh'); setShowPicker(false); }}
                style={{
                  padding: '6px 12px', cursor: 'pointer', color: colors.textLight, fontSize: font.sm,
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = colors.accentSoft}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                <Icon name="circle" size={8} fill={colors.success} color={colors.success} style={{ marginRight: 4 }} /> {c.name}
              </div>
            ))}
          </div>
        )}
      </div>
      {/* Flex spacer & drop zone for receiving tabs from other panes */}
      <div
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverAdd(true); }}
        onDragLeave={() => setDragOverAdd(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOverAdd(false);
          try {
            const data = JSON.parse(e.dataTransfer.getData('text/plain'));
            if (data.id && onReceiveTab) onReceiveTab(data as Tab);
          } catch { /* ignore malformed tab drag data */ }
        }}
        style={{ flex: 1, alignSelf: 'stretch', minWidth: 4, background: dragOverAdd ? 'rgba(0,122,204,0.3)' : 'transparent' }}
      />
      {quickConnectError && <span role="status" style={{ color: colors.dangerBright, fontSize: font.sm, flexShrink: 0 }}>{quickConnectError}</span>}
      {(!filterType || filterType === 'ssh') && (
        <span onClick={cycleScope} title={t("broadcast_toggle")}
          style={{
            padding: '4px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
            background: broadcastScope !== 'off' ? colors.dangerBg : 'transparent',
            color: broadcastScope !== 'off' ? colors.white : colors.textDim,
            borderRadius: 4, fontSize: font.md, flexShrink: 0, alignSelf: 'center',
          }}>
          <Icon name="radio" size={12} /> {scopeLabels[broadcastScope]}
        </span>
      )}
    </div>
  );
}
