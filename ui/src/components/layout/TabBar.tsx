import { t } from '../../i18n';
import React, { useEffect, useRef, useState } from 'react';
import type { Tab } from '../../store/layout';
import Icon from '../common/Icon';
import { colors, font } from '../../theme/tokens';
import { horizontalTabScrollTarget } from './tabBarScroll';

interface Props {
  tabs: Tab[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onRenameTab?: (id: string, title: string) => void;
  onReceiveTab?: (tab: Tab) => void;
  onAddTab?: () => void;
  filterType?: string;
}

export default function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab, onRenameTab, onReceiveTab, onAddTab, filterType }: Props) {
  const filtered = filterType ? tabs.filter((t) => t.type === filterType) : tabs;
  const [dragOverAdd, setDragOverAdd] = useState(false);
  const [editingTabID, setEditingTabID] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [coarsePointer, setCoarsePointer] = useState(() => window.matchMedia?.('(pointer: coarse)').matches ?? false);
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const query = window.matchMedia?.('(pointer: coarse)');
    if (!query) return;
    const update = () => setCoarsePointer(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const handleWheel = (event: WheelEvent) => {
      // An overflowing name bar owns wheel gestures while the pointer is over
      // it. Consume the event even at either horizontal boundary so it cannot
      // scroll the compact panel page at the same time.
      if (bar.scrollWidth <= bar.clientWidth) return;
      event.preventDefault();
      event.stopPropagation();
      const target = horizontalTabScrollTarget(bar.scrollLeft, bar.clientWidth, bar.scrollWidth, event.deltaX, event.deltaY, event.deltaMode);
      if (target === null) return;
      bar.scrollLeft = target;
    };
    bar.addEventListener('wheel', handleWheel, { passive: false });
    return () => bar.removeEventListener('wheel', handleWheel);
  }, []);
  useEffect(() => {
    if (window.matchMedia?.('(max-width: 700px)').matches) {
      barRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
  }, [activeTabId]);

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
    <div ref={barRef} className="terminal-tabbar" style={{ display: 'flex', background: colors.bg, height: 36, alignItems: 'center', padding: '0 6px', gap: 2, flexShrink: 0, overflowX: 'auto', overflowY: 'hidden', touchAction: 'pan-x', scrollbarWidth: 'none', borderBottom: '1px solid var(--c-border)' }}>
      {filtered.map((tab, idx) => (
        <React.Fragment key={tab.id}>
          {idx > 0 && (
            <span style={{
              width: 1, height: 16, flexShrink: 0, alignSelf: 'center',
              background: (activeTabId !== tab.id && activeTabId !== filtered[idx-1]?.id) ? colors.border : 'transparent',
            }} />
          )}
          <div
            data-terminal-tab="true"
            data-active={activeTabId === tab.id}
            draggable={!coarsePointer && editingTabID !== tab.id}
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
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                onDragStart={(e) => e.preventDefault()}
                onChange={(e) => setEditingTitle(e.target.value)}
                onBlur={finishRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); finishRename(); }
                  if (e.key === 'Escape') { e.preventDefault(); setEditingTabID(null); }
                }}
                style={{ width: 112, border: 'none', borderRadius: 3, padding: '1px 4px', fontSize: font.md, color: colors.text, background: colors.bgInput, userSelect: 'text' }}
              />
            ) : `${tab.labelNumber ?? idx + 1}: ${tab.title}`}
            <span aria-label={t('tab_close')} onClick={(e) => { e.stopPropagation(); if (window.confirm(t('tab_close_confirm'))) onCloseTab(tab.id); }}
              style={{ color: colors.textMuted, cursor: 'pointer', borderRadius: '50%', width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = colors.border; e.currentTarget.style.color = colors.bg; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = colors.textMuted; }}><Icon name="x" size={11} /></span>
          </div>
        </React.Fragment>
      ))}
      {/* Flex spacer & drop zone for receiving tabs from other panes */}
      <div
        className="terminal-tabbar-spacer"
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
      {onAddTab && (
        <button type="button" aria-label={t('tab_new')} title={t('tab_new')} onClick={(e) => { e.stopPropagation(); onAddTab(); }}
          style={{ width: 24, height: 24, flexShrink: 0, border: `1px solid ${colors.border}`, borderRadius: 4, cursor: 'pointer', color: colors.accent, background: colors.bg, fontSize: font.lg, lineHeight: '20px', padding: 0 }}>+</button>
      )}
    </div>
  );
}
