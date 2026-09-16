import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import SftpPanel, { type OpenRemoteFile } from "./SftpPanel";
import CustomSelect from "../common/CustomSelect";
import Icon from "../common/Icon";
import { t } from "../../i18n";
import "./sftp.css";

const FileEditor = lazy(() => import("../common/FileEditor"));

interface Props {
  connections: Array<{ id: number; name: string }>;
}

type EditorGroup = "primary" | "secondary";
type PersistedDraft = { content: string; baseRevision?: string };
type EditorTab = OpenRemoteFile & {
  id: string;
  group: EditorGroup;
  refreshMode: "auto" | "manual" | null;
  dirty: boolean;
  draft?: PersistedDraft;
};

type PersistedWorkbench = {
  version: 1;
  connectionId: number;
  tabs: EditorTab[];
  active: Record<EditorGroup, string | null>;
  focusedGroup: EditorGroup;
  split: boolean;
};

const tabIdFor = (path: string) => `file:${path}`;
const FILE_WORKBENCH_STORAGE_KEY = "webterm:file-workbench:v1";
const otherGroup = (group: EditorGroup): EditorGroup => group === "primary" ? "secondary" : "primary";
const tabElement = (id: string) => [...document.querySelectorAll<HTMLElement>("[data-editor-tab-id]")]
  .find((element) => element.dataset.editorTabId === id) || null;
const isEditorGroup = (value: unknown): value is EditorGroup => value === "primary" || value === "secondary";
const isRefreshMode = (value: unknown): value is "auto" | "manual" | null => value === "auto" || value === "manual" || value === null;

function loadPersistedWorkbench(): PersistedWorkbench | null {
  if (typeof window === "undefined") return null;
  try {
    const saved = JSON.parse(window.localStorage.getItem(FILE_WORKBENCH_STORAGE_KEY) || "null") as Partial<PersistedWorkbench> | null;
    if (!saved || saved.version !== 1 || typeof saved.connectionId !== "number") return null;
    const tabs = Array.isArray(saved.tabs) ? saved.tabs.flatMap((tab): EditorTab[] => {
      if (!tab || typeof tab.path !== "string" || typeof tab.name !== "string" || !isEditorGroup(tab.group) || !isRefreshMode(tab.refreshMode)) return [];
      const draft = tab.draft && typeof tab.draft.content === "string"
        ? { content: tab.draft.content, baseRevision: typeof tab.draft.baseRevision === "string" ? tab.draft.baseRevision : undefined }
        : undefined;
      return [{ path: tab.path, name: tab.name, revision: typeof tab.revision === "string" ? tab.revision : undefined, id: tabIdFor(tab.path), group: tab.group, refreshMode: tab.refreshMode, dirty: Boolean(draft), draft }];
    }) : [];
    const restoreActive = (group: EditorGroup) => {
      const candidate = saved.active?.[group];
      return typeof candidate === "string" && tabs.some((tab) => tab.group === group && tab.id === candidate)
        ? candidate
        : tabs.filter((tab) => tab.group === group).at(-1)?.id || null;
    };
    return { version: 1, connectionId: saved.connectionId, tabs, active: { primary: restoreActive("primary"), secondary: restoreActive("secondary") }, focusedGroup: isEditorGroup(saved.focusedGroup) ? saved.focusedGroup : "primary", split: Boolean(saved.split) || tabs.some((tab) => tab.group === "secondary") };
  } catch {
    return null;
  }
}

function writePersistedWorkbench(saved: PersistedWorkbench) {
  try {
    window.localStorage.setItem(FILE_WORKBENCH_STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Preserve layout and opened files even if a very large unsaved draft
    // exceeds browser storage quota.
    const withoutDrafts = { ...saved, tabs: saved.tabs.map((tab) => ({ ...tab, draft: undefined, dirty: false })) };
    try { window.localStorage.setItem(FILE_WORKBENCH_STORAGE_KEY, JSON.stringify(withoutDrafts)); } catch { /* Storage is unavailable. */ }
  }
}

/** A remote file explorer with movable, split editor groups. */
export default function DualPaneSftp({ connections }: Props) {
  const [storedWorkbench] = useState(loadPersistedWorkbench);
  const [selectedConnId, setSelectedConnId] = useState<number | null>(storedWorkbench?.connectionId || connections[0]?.id || null);
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [tabs, setTabs] = useState<EditorTab[]>(storedWorkbench?.tabs || []);
  const [active, setActive] = useState<Record<EditorGroup, string | null>>(storedWorkbench?.active || { primary: null, secondary: null });
  const [focusedGroup, setFocusedGroup] = useState<EditorGroup>(storedWorkbench?.focusedGroup || "primary");
  const [split, setSplit] = useState(Boolean(storedWorkbench?.split));
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [dropGroup, setDropGroup] = useState<EditorGroup | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const persistedRef = useRef<PersistedWorkbench | null>(storedWorkbench);

  const connId = connections.some((connection) => connection.id === selectedConnId)
    ? selectedConnId : connections[0]?.id || null;

  useLayoutEffect(() => {
    if (!connId || selectedConnId !== connId) return;
    const saved: PersistedWorkbench = { version: 1, connectionId: connId, tabs, active, focusedGroup, split };
    persistedRef.current = saved;
    writePersistedWorkbench(saved);
  }, [active, connId, focusedGroup, selectedConnId, split, tabs]);

  useEffect(() => {
    const persistBeforeUnload = () => {
      if (persistedRef.current) writePersistedWorkbench(persistedRef.current);
    };
    window.addEventListener("pagehide", persistBeforeUnload);
    window.addEventListener("beforeunload", persistBeforeUnload);
    return () => {
      window.removeEventListener("pagehide", persistBeforeUnload);
      window.removeEventListener("beforeunload", persistBeforeUnload);
    };
  }, []);

  const tabsFor = useCallback((group: EditorGroup, source = tabs) => source.filter((tab) => tab.group === group), [tabs]);
  const replaceGroup = (source: EditorTab[], group: EditorGroup, nextGroup: EditorTab[]) => {
    const other = source.filter((tab) => tab.group !== group);
    return group === "primary" ? [...nextGroup, ...other] : [...other, ...nextGroup];
  };

  const activate = useCallback((group: EditorGroup, id: string) => {
    setFocusedGroup(group);
    setActive((current) => ({ ...current, [group]: id }));
    requestAnimationFrame(() => tabElement(id)?.scrollIntoView?.({ block: "nearest", inline: "nearest" }));
  }, []);

  const openFile = useCallback((file: OpenRemoteFile) => {
    const id = tabIdFor(file.path);
    setTabs((current) => {
      const existing = current.find((tab) => tab.id === id);
      if (existing) return current.map((tab) => tab.id === id ? { ...tab, group: focusedGroup, revision: file.revision || tab.revision } : tab);
      const created: EditorTab = { ...file, id, group: focusedGroup, refreshMode: null, dirty: false };
      return replaceGroup(current, focusedGroup, [...current.filter((tab) => tab.group === focusedGroup), created]);
    });
    activate(focusedGroup, id);
  }, [activate, focusedGroup]);

  const closeTab = useCallback((id: string) => {
    setTabs((current) => {
      const target = current.find((tab) => tab.id === id);
      if (!target || (target.dirty && !window.confirm(t("file_close_unsaved")))) return current;
      const remaining = current.filter((tab) => tab.id !== id);
      setActive((selected) => selected[target.group] === id
        ? { ...selected, [target.group]: remaining.filter((tab) => tab.group === target.group).at(-1)?.id || null }
        : selected);
      return remaining;
    });
  }, []);

  const moveTab = useCallback((id: string, destination: EditorGroup, beforeId?: string) => {
    setTabs((current) => {
      const moving = current.find((tab) => tab.id === id);
      if (!moving) return current;
      const without = current.filter((tab) => tab.id !== id);
      const destinationTabs = without.filter((tab) => tab.group === destination);
      const insertAt = beforeId ? Math.max(0, destinationTabs.findIndex((tab) => tab.id === beforeId)) : destinationTabs.length;
      const nextDestination = [...destinationTabs];
      nextDestination.splice(insertAt < 0 ? nextDestination.length : insertAt, 0, { ...moving, group: destination });
      const next = replaceGroup(without, destination, nextDestination);
      setActive((selected) => ({
        ...selected,
        [moving.group]: moving.group === destination ? selected[moving.group] : without.filter((tab) => tab.group === moving.group).at(-1)?.id || null,
        [destination]: id,
      }));
      return next;
    });
    setFocusedGroup(destination);
  }, []);

  const createSplit = () => {
    setSplit(true);
    setFocusedGroup("secondary");
  };
  const mergeSplit = () => {
    setTabs((current) => current.map((tab) => tab.group === "secondary" ? { ...tab, group: "primary" } : tab));
    setActive((current) => ({ primary: current.primary || current.secondary, secondary: null }));
    setFocusedGroup("primary");
    setSplit(false);
  };
  const scrollTabs = (group: EditorGroup, direction: number) => document
    .querySelector<HTMLElement>(`[data-editor-group="${group}"] .file-editor-tabs`)
    ?.scrollBy?.({ left: direction * 180, behavior: "smooth" });
  const onTabKeys = (event: React.KeyboardEvent<HTMLButtonElement>, group: EditorGroup, tabId: string) => {
    const groupTabs = tabsFor(group);
    const index = groupTabs.findIndex((tab) => tab.id === tabId);
    let next = -1;
    if (event.key === "ArrowRight") next = (index + 1) % groupTabs.length;
    if (event.key === "ArrowLeft") next = (index - 1 + groupTabs.length) % groupTabs.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = groupTabs.length - 1;
    if (next >= 0) {
      event.preventDefault();
      activate(group, groupTabs[next].id);
      requestAnimationFrame(() => tabElement(groupTabs[next].id)?.querySelector<HTMLButtonElement>("button")?.focus());
    }
  };

  const renderGroup = (group: EditorGroup) => {
    const groupTabs = tabsFor(group);
    const activeId = active[group];
    const moveTo = otherGroup(group);
    const moveDroppedTab = (event: React.DragEvent<HTMLElement>, beforeId?: string) => {
      event.preventDefault();
      event.stopPropagation();
      moveTab(event.dataTransfer.getData("text/plain") || draggedTabId || "", group, beforeId);
      setDraggedTabId(null);
      setDropTarget(null);
      setDropGroup(null);
    };
    return (
      <section className={`file-editor-group${focusedGroup === group ? " is-focused" : ""}${dropGroup === group ? " is-drop-target" : ""}`} data-editor-group={group} onMouseDown={() => setFocusedGroup(group)}
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropGroup(group); }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropGroup(null); }}
        onDrop={(event) => moveDroppedTab(event)}>
        <div className="file-editor-tab-strip">
          <button className="file-editor-scroll" aria-label={t("file_scroll_tabs_left")} title={t("file_scroll_tabs_left")} onClick={() => scrollTabs(group, -1)}><Icon name="chevron-left" size={15} /></button>
          <div className="file-editor-tabs" role="tablist" aria-label={t("file_open_files")}
            onWheel={(event) => { if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) { event.preventDefault(); event.currentTarget.scrollLeft += event.deltaY; } }}
            onDrop={(event) => moveDroppedTab(event)}>
            {groupTabs.map((tab) => (
              <div key={tab.id} data-editor-tab-id={tab.id} draggable className={`file-editor-tab${tab.id === activeId ? " is-active" : ""}${draggedTabId === tab.id ? " is-dragging" : ""}${dropTarget === tab.id ? " is-drop-target" : ""}`}
                onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", tab.id); setDraggedTabId(tab.id); }}
                onDragEnd={() => { setDraggedTabId(null); setDropTarget(null); setDropGroup(null); }}
                onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropTarget(tab.id); }}
                onDragLeave={() => setDropTarget(null)}
                onDrop={(event) => moveDroppedTab(event, tab.id)}>
                <button role="tab" tabIndex={tab.id === activeId ? 0 : -1} aria-selected={tab.id === activeId} onKeyDown={(event) => onTabKeys(event, group, tab.id)} onClick={() => activate(group, tab.id)}>
                  <Icon name="file" size={14} /><span title={tab.path}>{tab.name}</span>{tab.dirty && <i aria-label={t("file_unsaved")} />}
                </button>
                <button className="file-editor-tab-close" aria-label={`${t("tab_close")} ${tab.name}`} onClick={() => closeTab(tab.id)}><Icon name="x" size={13} /></button>
              </div>
            ))}
          </div>
          <button className="file-editor-scroll" aria-label={t("file_scroll_tabs_right")} title={t("file_scroll_tabs_right")} onClick={() => scrollTabs(group, 1)}><Icon name="chevron-right" size={15} /></button>
          <div className="file-editor-group-actions">
            {split && activeId && <button className="file-editor-tool" aria-label={t("file_move_to_other_editor")} title={t("file_move_to_other_editor")} onClick={() => moveTab(activeId, moveTo)}><Icon name="panel-right-open" size={15} /></button>}
            {group === "primary" && <button className="file-editor-tool" aria-label={split ? t("file_close_split") : t("file_split_editor")} title={split ? t("file_close_split") : t("file_split_editor")} onClick={() => split ? mergeSplit() : createSplit()}><Icon name={split ? "panel-right-close" : "columns-2"} size={15} /></button>}
          </div>
        </div>
        <div className="file-editor-stack">
          {!groupTabs.length && <div className="file-editor-empty"><Icon name="file" size={30} /><strong>{t("file_editor_empty_title")}</strong><span>{split ? t("file_editor_split_hint") : t("file_editor_empty_hint")}</span></div>}
          {groupTabs.map((tab) => (
            <div key={tab.id} className="file-editor-page" hidden={tab.id !== activeId}>
              <Suspense fallback={<div className="sftp-state">Loading…</div>}>
                <FileEditor embedded filePath={tab.path} fileName={tab.name} revision={tab.revision} ws={socket} refreshMode={tab.refreshMode}
                  onRefreshModeChange={(refreshMode) => setTabs((current) => current.map((item) => item.id === tab.id ? { ...item, refreshMode } : item))}
                  onDirtyChange={(dirty) => setTabs((current) => current.map((item) => item.id === tab.id ? { ...item, dirty } : item))}
                  initialDraft={tab.draft}
                  onDraftChange={(draft) => setTabs((current) => current.map((item) => item.id === tab.id ? { ...item, dirty: Boolean(draft), draft: draft || undefined } : item))}
                  onClose={() => closeTab(tab.id)} onSaved={() => setRefreshNonce((value) => value + 1)} />
              </Suspense>
            </div>
          ))}
        </div>
      </section>
    );
  };

  const selectedConnectionName = useMemo(() => connections.find((connection) => connection.id === connId)?.name || "", [connId, connections]);
  return (
    <div className={`file-workbench${split ? " is-split" : ""}`}>
      <aside className="file-explorer" aria-label={t("file_browser")}>
        <div className="file-explorer-head"><Icon name="monitor" size={15} /><span>{t("file_remote_files")}</span>
          <CustomSelect value={String(connId || "")} onChange={(value) => setSelectedConnId(Number(value) || null)}>{connections.map((connection) => <option key={connection.id} value={String(connection.id)}>{connection.name}</option>)}</CustomSelect>
        </div>
        {connId ? <SftpPanel key={connId} connId={connId} endpointId={`remote:${connId}`} refreshNonce={refreshNonce} onSocketChange={setSocket} onOpenFile={openFile} /> : <div className="sftp-endpoint-empty">{t("sftp_select_conn")}</div>}
      </aside>
      <main className="file-editor-workspace" aria-label={selectedConnectionName || t("file_remote_files")}>{renderGroup("primary")}{split && renderGroup("secondary")}</main>
    </div>
  );
}
