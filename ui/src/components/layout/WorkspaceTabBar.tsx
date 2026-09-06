import { useRef, useState } from 'react';
import { t } from '../../i18n';
import { colors, font } from '../../theme/tokens';
import type { WorkspaceCreateMode, WorkspaceTab } from './workspaceLayout';

interface Props {
  tabs: WorkspaceTab[];
  activeWorkspaceTabId: string;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onCreate: (mode: WorkspaceCreateMode) => void;
  onClose?: (id: string) => void;
}

export default function WorkspaceTabBar({ tabs, activeWorkspaceTabId, onSelect, onRename, onCreate, onClose }: Props) {
  const [editingID, setEditingID] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createMode, setCreateMode] = useState<WorkspaceCreateMode>('blank');
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
    setCreateMode('blank');
    setShowCreate(true);
  };

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', height: 38, flexShrink: 0, padding: '0 8px', gap: 4, overflow: 'visible', background: colors.bgDeep, borderBottom: `1px solid ${colors.border}` }}>
      <div role="tablist" aria-label={t('workspace_tabs')} style={{ display: 'flex', alignItems: 'center', gap: 3, minWidth: 0, overflowX: 'auto', scrollbarWidth: 'thin' }}>
        {tabs.map((workspace) => {
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
              aria-selected={active}
              aria-label={label}
              title={label}
              onClick={() => onSelect(workspace.id)}
              onDoubleClick={() => beginRename(workspace)}
              style={{ height: 30, maxWidth: 260, minWidth: 90, padding: '0 6px 0 12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', border: `1px solid ${active ? colors.accent : 'transparent'}`, borderRadius: 5, cursor: 'pointer', color: active ? colors.bg : colors.textMuted2, background: active ? colors.accent : 'transparent', fontSize: font.md, display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
              {onClose && tabs.length > 1 && <button type="button" aria-label={`${t('workspace_close')}: ${label}`} title={t('workspace_close')}
                onClick={(event) => { event.stopPropagation(); if (window.confirm(t('workspace_close_confirm'))) onClose(workspace.id); }}
                style={{ width: 18, height: 18, flexShrink: 0, padding: 0, border: 0, borderRadius: '50%', cursor: 'pointer', color: active ? colors.bg : colors.textMuted, background: 'transparent', fontSize: font.md, lineHeight: '16px' }}>×</button>}
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
