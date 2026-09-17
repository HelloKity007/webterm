import { useRef, useState } from 'react';
import { t } from '../../i18n';
import { colors, font } from '../../theme/tokens';
import type { WorkspaceCreateMode, WorkspaceTab } from './workspaceLayout';
import { useWorkspaceChromeStore } from '../../store/layout';
import TabCloseButton from './TabCloseButton';

interface Props {
  tabs: WorkspaceTab[];
  activeWorkspaceTabId: string;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onCreate: (mode: WorkspaceCreateMode) => void;
  onClose?: (id: string) => void;
  onReorder?: (sourceID: string, targetID: string, after: boolean) => void;
  collapsible?: boolean;
  closing?: boolean;
}

export default function WorkspaceTabBar({ tabs, activeWorkspaceTabId, onSelect, onRename, onCreate, onClose, onReorder, collapsible = false, closing = false }: Props) {
  const expanded = useWorkspaceChromeStore(s => s.expanded);
  const [editingID, setEditingID] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createMode, setCreateMode] = useState<WorkspaceCreateMode>('copy');
  const [filter, setFilter] = useState('');
  const [sortByName, setSortByName] = useState(false);
  const cancelRenameRef = useRef(false);

  const beginRename = (workspace: WorkspaceTab) => {
    cancelRenameRef.current = false;
    setEditingID(workspace.id);
    setEditingName(workspace.name);
  };
  const finishRename = () => {
    if (!cancelRenameRef.current && editingID && editingName.trim()) onRename(editingID, editingName.trim());
    cancelRenameRef.current = false;
    setEditingID(null);
  };
  const openCreate = () => {
    setCreateMode('copy');
    setShowCreate(true);
  };

  if (collapsible && !expanded) return null;
  const visibleTabs = tabs
    .filter((workspace) => `${workspace.index}: ${workspace.name}`.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()))
    .slice()
    .sort((a, b) => sortByName ? a.name.localeCompare(b.name) || a.index - b.index : a.index - b.index);
  return (
    <div className="workspace-tabs" style={{ position: 'relative', display: 'flex', alignItems: 'center', height: 38, flexShrink: 0, padding: '0 8px', gap: 4, overflow: 'visible', background: colors.bgDeep, borderBottom: `1px solid ${colors.border}` }}>
      {tabs.length > 2 && <input aria-label={t('workspace_search')} placeholder={t('workspace_search')} value={filter} onChange={(event) => setFilter(event.target.value)}
        style={{ width: 150, minWidth: 80, height: 28, flexShrink: 1, border: `1px solid ${colors.border}`, borderRadius: 4, outline: 'none', padding: '0 7px', color: colors.text, background: colors.bgInput, fontSize: font.sm }} />}
      {tabs.length > 1 && <button type="button" aria-label={t('workspace_sort')} title={t('workspace_sort')} onClick={() => setSortByName((value) => !value)}
        style={{ width: 28, height: 28, flexShrink: 0, border: `1px solid ${colors.border}`, borderRadius: 5, cursor: 'pointer', color: sortByName ? colors.accent : colors.textMuted2, background: colors.bg, fontSize: font.md }}>{sortByName ? 'A' : '#'}</button>}
      <div role="tablist" aria-label={t('workspace_tabs')} style={{ display: 'flex', alignItems: 'center', gap: 3, minWidth: 0, overflowX: 'auto', scrollbarWidth: 'thin' }}>
        {visibleTabs.map((workspace) => {
          const label = `${workspace.index}: ${workspace.name}`;
          const active = workspace.id === activeWorkspaceTabId;
          return editingID === workspace.id ? (
            <div key={workspace.id} role="tab" aria-selected={active} style={{ height: 30, maxWidth: 260, display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px', borderRadius: 5, color: active ? colors.bg : colors.text, background: active ? colors.accent : colors.bgInput }}>
              <span style={{ flexShrink: 0, fontSize: font.md }}>{workspace.index}:</span>
              <input
                autoFocus
                aria-label={t('workspace_name')}
                maxLength={256}
                value={editingName}
                onChange={(event) => setEditingName(event.target.value)}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onBlur={finishRename}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') { event.preventDefault(); finishRename(); }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    cancelRenameRef.current = true;
                    setEditingID(null);
                  }
                }}
                style={{ width: 150, minWidth: 60, border: 0, borderRadius: 3, outline: 'none', padding: '2px 5px', color: colors.text, background: colors.bgInputAlt, fontSize: font.md }}
              />
            </div>
          ) : (
            <div
              key={workspace.id}
              role="tab"
              draggable={!!onReorder}
              aria-selected={active}
              aria-label={label}
              title={label}
              onClick={() => onSelect(workspace.id)}
              onDoubleClick={() => beginRename(workspace)}
              onDragStart={(event) => {
                if (!onReorder) return;
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', `webterm-workspace:${workspace.id}`);
              }}
              onDragOver={(event) => { if (onReorder) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }}
              onDrop={(event) => {
                if (!onReorder) return;
                event.preventDefault();
                const sourceID = event.dataTransfer.getData('text/plain').replace(/^webterm-workspace:/, '');
                if (!sourceID) return;
                const bounds = event.currentTarget.getBoundingClientRect();
                onReorder(sourceID, workspace.id, event.clientX > bounds.left + bounds.width / 2);
              }}
              style={{ height: 30, maxWidth: 260, minWidth: 90, padding: '0 6px 0 12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', border: `1px solid ${active ? colors.accent : 'transparent'}`, borderRadius: 5, cursor: 'pointer', color: active ? colors.bg : colors.textMuted2, background: active ? colors.accent : 'transparent', fontSize: font.md, display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
              {onClose && <TabCloseButton label={`${t('workspace_close')}: ${label}`} disabled={closing} onClick={() => {
                const count = Object.values(workspace.layout.panes).reduce((total, pane) => total + pane.tabs.length, 0);
                if (window.confirm(`${label}\n${t('workspace_close_confirm')}\nPanel: ${count}`)) onClose(workspace.id);
              }} />}
            </div>
          );
        })}
      </div>
      <button type="button" aria-label={t('workspace_new')} title={t('workspace_new')} onClick={openCreate}
        style={{ width: 28, height: 28, flexShrink: 0, border: `1px solid ${colors.border}`, borderRadius: 5, cursor: 'pointer', color: colors.accent, background: colors.bg, fontSize: font.lg, lineHeight: '24px' }}>+</button>
      {showCreate && (
        <div role="dialog" aria-label={t('workspace_create')} style={{ position: 'absolute', zIndex: 30, left: 8, top: 36, minWidth: 240, padding: 12, border: `1px solid ${colors.border}`, borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,.35)', color: colors.text, background: colors.bgRaised, fontSize: font.md }}>
          <div style={{ marginBottom: 10, color: colors.text }}>{t('workspace_create_mode')}</div>
          <label style={{ display: 'flex', gap: 7, alignItems: 'center', marginBottom: 8, cursor: 'pointer' }}>
            <input type="radio" name="workspace-create-mode" checked={createMode === 'blank'} onChange={() => setCreateMode('blank')} />
            {t('workspace_blank')}
          </label>
          <label style={{ display: 'flex', gap: 7, alignItems: 'center', marginBottom: 12, cursor: 'pointer' }}>
            <input type="radio" name="workspace-create-mode" checked={createMode === 'copy'} onChange={() => setCreateMode('copy')} />
            {t('workspace_copy')}
          </label>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" onClick={() => setShowCreate(false)} style={{ padding: '4px 10px', border: `1px solid ${colors.border}`, borderRadius: 4, color: colors.textMuted2, background: colors.bg, cursor: 'pointer' }}>{t('conn_cancel')}</button>
            <button type="button" onClick={() => { onCreate(createMode); setShowCreate(false); }} style={{ padding: '4px 10px', border: `1px solid ${colors.accent}`, borderRadius: 4, color: colors.bg, background: colors.accent, cursor: 'pointer' }}>{t('workspace_create')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
