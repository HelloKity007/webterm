import { t } from '../../i18n';
import React, { useEffect, useRef, useState } from 'react';
import type { Tab } from '../../store/layout';
import TabCloseButton from './TabCloseButton';
import { colors, font } from '../../theme/tokens';
import { horizontalTabScrollTarget } from './tabBarScroll';

interface Props {
  tabs: Tab[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onRenameTab?: (id: string, title: string) => void;
  onReceiveTab?: (tab: Tab) => void;
  onReorderTab?: (sourceId: string, targetId: string, after: boolean) => void;
  onAddTab?: () => void;
  filterType?: string;
}

export default function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab, onRenameTab, onReceiveTab, onReorderTab, onAddTab, filterType }: Props) {
  const filtered = filterType ? tabs.filter((t) => t.type === filterType) : tabs;
  const [dragOverAdd, setDragOverAdd] = useState(false);
  const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean } | null>(null);
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
            data-tab-id={tab.id}
            data-active={activeTabId === tab.id}
            draggable={!coarsePointer && editingTabID !== tab.id}
            onDragStart={(e) => {
              e.dataTransfer.setData('text/plain', JSON.stringify(tab));
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragEnd={() => { setDropTarget(null); setDragOverAdd(false); }}
            onDragOver={(e) => {
              if (!onReorderTab && !onReceiveTab) return;
              e.preventDefault(); e.stopPropagation();
              e.dataTransfer.dropEffect = 'move';
              const rect = e.currentTarget.getBoundingClientRect();
              setDropTarget({ id: tab.id, after: e.clientX > rect.left + rect.width / 2 });
              const bar = barRef.current;
              if (bar) {
                const bounds = bar.getBoundingClientRect();
                if (e.clientX > bounds.right - 32) bar.scrollLeft += 24;
                else if (e.clientX < bounds.left + 32) bar.scrollLeft -= 24;
              }
            }}
            onDragLeave={() => setDropTarget(null)}
            onDrop={(e) => {
              e.preventDefault(); e.stopPropagation(); setDropTarget(null);
              try {
                const data = JSON.parse(e.dataTransfer.getData('text/plain')) as Tab;
                if (filtered.some(item => item.id === data.id)) {
                  const rect = e.currentTarget.getBoundingClientRect();
                  onReorderTab?.(data.id, tab.id, e.clientX > rect.left + rect.width / 2);
                } else if (data.id) onReceiveTab?.(data);
              } catch { /* Ignore non-tab drops. */ }
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
              boxShadow: dropTarget?.id === tab.id ? `inset ${dropTarget.after ? '-2px' : '2px'} 0 ${colors.accent}` : undefined,
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
            <TabCloseButton label={t('tab_close')} onClick={() => { if (window.confirm(t('tab_close_confirm'))) onCloseTab(tab.id); }} />
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
          e.stopPropagation();
          setDragOverAdd(false);
          try {
            const data = JSON.parse(e.dataTransfer.getData('text/plain'));
            if (filtered.some(tab => tab.id === data.id)) {
              const last = filtered.at(-1);
              if (last) onReorderTab?.(data.id, last.id, true);
            } else if (data.id && onReceiveTab) onReceiveTab(data as Tab);
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
