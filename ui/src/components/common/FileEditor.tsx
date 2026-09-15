import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorView, keymap } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { t } from '../../i18n';
import { defaultKeymap } from '@codemirror/commands';
import { basicSetup } from 'codemirror';
import { sql } from '@codemirror/lang-sql';
import { json } from '@codemirror/lang-json';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { colors, font } from '../../theme/tokens';

interface Props {
  filePath: string;
  fileName: string;
  ws: WebSocket | null;
  revision?: string;
  refreshMode: 'auto' | 'manual' | null;
  onRefreshModeChange: (mode: 'auto' | 'manual') => void;
  onClose: () => void;
  onSaved: () => void;
  embedded?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}

type RemoteFileMessage = { type?: string; path?: string; content?: string; error?: string; revision?: string };

function detectLanguage(fileName: string): Extension | Extension[] {
  const ext = fileName.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'sql': return sql();
    case 'json': return json();
    case 'js': case 'ts': case 'jsx': case 'tsx': return javascript();
    case 'py': return python();
    case 'yaml': case 'yml':
    case 'sh': case 'bash':
    case 'conf': case 'ini': case 'cfg':
    case 'xml': case 'html': case 'css':
    default: return []; // plain text
  }
}

export default function FileEditor({ filePath, fileName, ws, revision, refreshMode, onRefreshModeChange, onClose, onSaved, embedded = false, onDirtyChange }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Backups are useful for exceptional changes, but must never silently create
  // remote files. Let the operator opt in for each file instead.
  const [backup, setBackup] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [externalChange, setExternalChange] = useState(false);
  const [saveConflict, setSaveConflict] = useState(false);
  const [observedRevision, setObservedRevision] = useState<string | undefined>();
  const origContentRef = useRef('');
  const serverRevisionRef = useRef(revision);
  const saveHandlerRef = useRef<() => void>(() => {});
  const lastRevisionRef = useRef(revision);
  const dirtyChangeRef = useRef(onDirtyChange);

  useEffect(() => { dirtyChangeRef.current = onDirtyChange; }, [onDirtyChange]);

  // Read file from remote
  useEffect(() => {
    if (!ws) return;
    ws.send(JSON.stringify({ action: 'read', path: filePath }));

    const handler = (e: MessageEvent) => {
      const msg = JSON.parse(e.data) as RemoteFileMessage;
      if (msg.type === 'file_content' && msg.path === filePath) {
        setContent(msg.content || '');
        origContentRef.current = msg.content || '';
        serverRevisionRef.current = msg.revision || serverRevisionRef.current;
        lastRevisionRef.current = msg.revision || lastRevisionRef.current;
        dirtyChangeRef.current?.(false);
        setExternalChange(false);
        setLoading(false);
        ws.removeEventListener('message', handler);
      } else if (msg.type === 'error') {
        setError(msg.error || 'Unable to read file');
        setLoading(false);
        ws.removeEventListener('message', handler);
      }
    };
    ws.addEventListener('message', handler);

    return () => ws.removeEventListener('message', handler);
  }, [filePath, reloadNonce, ws]);

  useEffect(() => {
    const currentRevision = observedRevision || revision;
    if (!currentRevision || currentRevision === lastRevisionRef.current) return;
    lastRevisionRef.current = currentRevision;
    if (loading) return;
    const dirty = viewRef.current?.state.doc.toString() !== origContentRef.current;
    if (dirty || refreshMode !== 'auto') {
      setExternalChange(true);
    } else {
      setLoading(true);
      setReloadNonce((value) => value + 1);
    }
  }, [loading, observedRevision, refreshMode, revision]);

  // Auto refresh is an explicit per-file choice. It only observes revision
  // metadata; the normal change path above decides whether content may reload.
  useEffect(() => {
    if (!ws || refreshMode !== 'auto') return;
    const stat = () => ws.send(JSON.stringify({ action: 'stat', path: filePath }));
    const handler = (event: MessageEvent) => {
      const message = JSON.parse(event.data) as RemoteFileMessage;
      if (message.type === 'file_stat' && message.path === filePath) {
        setObservedRevision(message.revision);
      }
    };
    ws.addEventListener('message', handler);
    stat();
    const interval = window.setInterval(stat, 5000);
    return () => {
      window.clearInterval(interval);
      ws.removeEventListener('message', handler);
    };
  }, [filePath, refreshMode, ws]);

  const reloadExternalChange = useCallback(() => {
    setExternalChange(false);
    setLoading(true);
    setReloadNonce((value) => value + 1);
  }, []);
  const requestManualReload = useCallback(() => {
    if (!ws) return;
    // A manual check is still non-destructive: fetch metadata first, then let
    // the operator decide whether to replace the open buffer.
    const handler = (event: MessageEvent) => {
      const message = JSON.parse(event.data) as RemoteFileMessage;
      if (message.type !== 'file_stat' || message.path !== filePath) return;
      if (message.revision && message.revision !== lastRevisionRef.current) {
        setObservedRevision(message.revision);
        setExternalChange(true);
      }
      ws.removeEventListener('message', handler);
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ action: 'stat', path: filePath }));
  }, [filePath, ws]);

  // Create CodeMirror editor
  useEffect(() => {
    if (loading || !editorRef.current) return;

    const lang = detectLanguage(fileName);

    const extensions: Extension[] = [
      basicSetup,
      keymap.of([
        ...defaultKeymap,
        { key: 'Ctrl-s', run: () => { saveHandlerRef.current(); return true; } },
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          dirtyChangeRef.current?.(update.state.doc.toString() !== origContentRef.current);
        }
      }),
      EditorView.theme({
        '&': { height: '100%' },
        '.cm-scroller': { overflow: 'auto' },
        '.cm-content': { fontFamily: 'Menlo, Monaco, monospace', fontSize: font.lg, color: '#e6f2e7', caretColor: '#ffffff' },
        '.cm-line': { color: '#e6f2e7' },
        '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#ffffff', borderLeftWidth: '2px' },
        '.cm-selectionBackground, ::selection': { backgroundColor: '#2f6950 !important' },
        '.cm-activeLine': { backgroundColor: '#182b20' },
        '.cm-gutters': { background: colors.bgDeep, color: '#afc4b2', border: 'none' },
        '.cm-activeLineGutter': { background: '#1b3022', color: '#effbf1' },
      }, { dark: true }),
    ];

    if (Array.isArray(lang)) {
      extensions.push(...lang);
    } else if (lang) {
      extensions.push(lang);
    }

    const view = new EditorView({
      doc: content,
      extensions,
      parent: editorRef.current,
    });

    viewRef.current = view;

    return () => view.destroy();
  }, [content, fileName, loading]);

  const handleSave = useCallback((force = false) => {
    if (!ws || !viewRef.current) return;
    const text = viewRef.current.state.doc.toString();
    const bakPath = filePath + '.bak';
    setSaving(true);
    setError('');
    setSaveConflict(false);

    const finishSave = (message?: RemoteFileMessage) => {
      origContentRef.current = text;
      serverRevisionRef.current = message?.revision || serverRevisionRef.current;
      lastRevisionRef.current = serverRevisionRef.current;
      setSaving(false);
      dirtyChangeRef.current?.(false);
      onSaved();
      if (!embedded) onClose();
    };

    const handler = (e: MessageEvent) => {
      const msg = JSON.parse(e.data) as RemoteFileMessage;
      if (msg.type === 'write_done' && msg.path === filePath) {
        if (backup) {
          // The guarded write must finish first: creating a .bak cannot mask
          // a concurrent change or leave the editor waiting for a stale reply.
          ws.send(JSON.stringify({ action: 'write', path: bakPath, content: origContentRef.current, force: true }));
        } else {
          finishSave(msg);
          ws.removeEventListener('message', handler);
        }
      } else if (msg.type === 'write_conflict' && msg.path === filePath) {
        setSaving(false);
        setSaveConflict(true);
        ws.removeEventListener('message', handler);
      } else if (msg.type === 'error') {
        setError(msg.error || 'Unable to save file');
        setSaving(false);
        ws.removeEventListener('message', handler);
      } else if (backup && msg.type === 'write_done' && msg.path === bakPath) {
        finishSave(msg);
        ws.removeEventListener('message', handler);
      }
    };
    ws.addEventListener('message', handler);

    ws.send(JSON.stringify({ action: 'write', path: filePath, content: text, expected_revision: serverRevisionRef.current, force }));
  }, [backup, embedded, filePath, onClose, onSaved, ws]);

  useEffect(() => {
    saveHandlerRef.current = handleSave;
  }, [handleSave]);

  const editor = (
      <div className={embedded ? 'file-editor-workbench' : undefined} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {loading && <div style={{ padding: 16, color: colors.textDim }}>{t("file_loading")}</div>}
        {error && (
          <div style={{ padding: '6px 12px', color: colors.danger, background: colors.bgError, fontSize: font.md }}>{error}</div>
        )}
        {externalChange && (
          <div style={{ padding: '6px 12px', color: colors.text, background: colors.dangerSoft, fontSize: font.md }} role="alert">
            <span>{t('file_external_change')}</span>
            <button onClick={reloadExternalChange}>{t('file_reload')}</button>
            <button onClick={() => setExternalChange(false)}>{t('file_keep_draft')}</button>
          </div>
        )}
        {saveConflict && (
          <div style={{ padding: '6px 12px', color: colors.text, background: colors.dangerSoft, fontSize: font.md }} role="alert">
            <span>{t('file_save_conflict')}</span>
            <button onClick={() => setSaveConflict(false)}>{t('file_cancel_save')}</button>
            <button onClick={() => handleSave(true)}>{t('file_force_save')}</button>
          </div>
        )}
        {refreshMode === null && !loading && (
          <div style={{ padding: '6px 12px', color: colors.text, background: colors.bgBar, fontSize: font.md }} role="status">
            <span>{t('file_refresh_mode_prompt')}</span>
            <button onClick={() => onRefreshModeChange('auto')}>{t('file_auto_refresh')}</button>
            <button onClick={() => onRefreshModeChange('manual')}>{t('file_manual_refresh')}</button>
          </div>
        )}
        <div ref={editorRef} style={{ flex: 1, minHeight: 0 }} />
        <div style={{
          padding: '8px 16px', background: colors.bgBar, display: 'flex',
          justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ color: colors.textDim, fontSize: font.sm, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>{filePath} · Ctrl+S {t("conn_save")}</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="checkbox" checked={backup} onChange={(e) => setBackup(e.target.checked)} />
              {t('file_bak')}
            </label>
            {refreshMode === 'auto' ? (
              <button onClick={() => onRefreshModeChange('manual')}>{t('file_pause_auto_refresh')}</button>
            ) : refreshMode === 'manual' ? (
              <>
                <button onClick={requestManualReload}>{t('file_reload')}</button>
                <button onClick={() => onRefreshModeChange('auto')}>{t('file_auto_refresh')}</button>
              </>
            ) : null}
          </span>
          <button onClick={() => handleSave()} disabled={saving} style={{
            background: saving ? colors.border : colors.info, border: 'none',
            color: colors.white, padding: '6px 16px', borderRadius: 4, cursor: 'pointer', fontSize: font.md,
          }}>
            {saving ? t('conn_saving') : t('conn_save')}
          </button>
        </div>
      </div>
  );

  if (embedded) return editor;

  // Retain the standalone form for callers outside the file workspace.
  return <div className="file-editor-standalone">{editor}</div>;
}
