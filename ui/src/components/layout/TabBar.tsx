import { t } from '../../i18n';
import React, { useState } from 'react';
import { useLayoutStore } from '../../store/layout';
import type { Tab, BroadcastScope } from '../../store/layout';
import Icon from '../common/Icon';
import { colors, font } from '../../theme/tokens';

interface Props {
  tabs: Tab[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onRenameTab?: (id: string, title: string) => void;
  onReceiveTab?: (tab: Tab) => void;
  filterType?: string;
}

const scopeLabels: Record<BroadcastScope, string> = {
  off: t('broadcast_off'),
  pane: t('broadcast_pane'),
  all: t('broadcast_all'),
};

export default function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab, onRenameTab, onReceiveTab, filterType }: Props) {
  const filtered = filterType ? tabs.filter((t) => t.type === filterType) : tabs;
  const broadcastScope = useLayoutStore((s) => s.broadcastScope);
  const setBroadcastScope = useLayoutStore((s) => s.setBroadcastScope);
  const [dragOverAdd, setDragOverAdd] = useState(false);
  const [editingTabID, setEditingTabID] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  const cycleScope = () => {
    const order: BroadcastScope[] = ['off', 'pane', 'all'];
    const idx = order.indexOf(broadcastScope);
    setBroadcastScope(order[(idx + 1) % order.length]);
  };

  const beginRename = (tab: Tab) => {
    if (!onRenameTab) return;
    setEditingTabID(tab.id);
    setEditingTitle(tab.title);
  };
  const finishRename = () => {
    if (editingTabID && editingTitle.trim()) onRenameTab?.(editingTabID, editingTitle.trim());
    setEditingTabID(null);
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
            onDoubleClick={(e) => { e.preventDefault(); beginRename(tab); }}
            style={{
              padding: '4px 14px', fontSize: font.md, borderRadius: 5, cursor: 'pointer',
              background: activeTabId === tab.id ? colors.accent : 'transparent',
              color: activeTabId === tab.id ? colors.bg : colors.textMuted2,
              display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap',
              height: 28, marginBottom: 0,
              transition: 'background 0.1s',
            }}>
            {editingTabID === tab.id ? (
              <input
                autoFocus
                aria-label="标签名称"
                value={editingTitle}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                onChange={(e) => setEditingTitle(e.target.value)}
                onBlur={finishRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); finishRename(); }
                  if (e.key === 'Escape') { e.preventDefault(); setEditingTabID(null); }
                }}
                style={{ width: 112, border: 'none', borderRadius: 3, padding: '1px 4px', fontSize: font.md, color: colors.text, background: colors.bgInput }}
              />
            ) : `${tab.labelNumber ?? idx + 1}: ${tab.title}`}
            <span onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
              style={{ color: colors.textMuted, cursor: 'pointer', borderRadius: '50%', width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = colors.border; e.currentTarget.style.color = colors.bg; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = colors.textMuted; }}><Icon name="x" size={11} /></span>
          </div>
        </React.Fragment>
      ))}
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
