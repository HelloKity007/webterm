import { lazy, Suspense, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
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
const FILE_TAB_TRANSFER_MIME = "application/x-webterm-file-tab+json";
const FILE_TAB_TRANSFER_CHANNEL = "webterm:file-tab-transfer:v1";
const FILE_WORKBENCH_WINDOW_PREFIX = "webterm-file-workbench:";
const otherGroup = (group: EditorGroup): EditorGroup => group === "primary" ? "secondary" : "primary";
const tabElement = (id: string) => [...document.querySelectorAll<HTMLElement>("[data-editor-tab-id]")]
  .find((element) => element.dataset.editorTabId === id) || null;
const isEditorGroup = (value: unknown): value is EditorGroup => value === "primary" || value === "secondary";
const isRefreshMode = (value: unknown): value is "auto" | "manual" | null => value === "auto" || value === "manual" || value === null;

type ExternalFileTab = Pick<EditorTab, "path" | "name" | "revision" | "refreshMode" | "dirty" | "draft">;
type ExternalFileTabTransfer = { version: 1; transferId: string; sourceWindowId: string; connectionId: number; tab: ExternalFileTab };

function newOpaqueId() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function workbenchWindowId() {
  if (typeof window === "undefined") return "server";
  // sessionStorage is per top-level browser tab. A window.open child can clone
  // it, so a window name created by this component is the stable tie-breaker.
  const named = window.name.startsWith(FILE_WORKBENCH_WINDOW_PREFIX)
    ? window.name.slice(FILE_WORKBENCH_WINDOW_PREFIX.length) : "";
  if (named) return named;
  // A caller may deliberately name a popup. That name identifies the browsing
  // context, while its sessionStorage may have been cloned from the opener.
  // Use it rather than the inherited value so source and target remain distinct.
  if (window.name) return `named-${window.name}`;
  const stored = window.sessionStorage.getItem("webterm:file-workbench-window-id");
  const id = stored || newOpaqueId();
  window.sessionStorage.setItem("webterm:file-workbench-window-id", id);
  if (!window.name) window.name = FILE_WORKBENCH_WINDOW_PREFIX + id;
  return id;
}

const storageKeyFor = (windowId: string) => `${FILE_WORKBENCH_STORAGE_KEY}:${windowId}`;

function parseExternalFileTab(raw: string): ExternalFileTabTransfer | null {
  try {
    const value = JSON.parse(raw) as Partial<ExternalFileTabTransfer>;
    const tab = value.tab;
    if (value.version !== 1 || typeof value.transferId !== "string" || !value.transferId ||
      typeof value.sourceWindowId !== "string" || !value.sourceWindowId ||
      typeof value.connectionId !== "number" || !Number.isInteger(value.connectionId) || !tab ||
      typeof tab.path !== "string" || !tab.path || typeof tab.name !== "string" || !tab.name ||
      !isRefreshMode(tab.refreshMode) || typeof tab.dirty !== "boolean") return null;
    const draft = tab.draft && typeof tab.draft.content === "string"
      ? { content: tab.draft.content, baseRevision: typeof tab.draft.baseRevision === "string" ? tab.draft.baseRevision : undefined } : undefined;
    if (tab.dirty && !draft) return null;
    return { version: 1, transferId: value.transferId, sourceWindowId: value.sourceWindowId, connectionId: value.connectionId,
      tab: { path: tab.path, name: tab.name, revision: typeof tab.revision === "string" ? tab.revision : undefined, refreshMode: tab.refreshMode, dirty: tab.dirty, draft } };
  } catch { return null; }
}

function loadPersistedWorkbench(windowId: string): PersistedWorkbench | null {
  if (typeof window === "undefined") return null;
  try {
    // The old unscoped key is read once for migration. Per-window saves avoid
    // one browser window overwriting another after a native cross-window move.
    const encoded = window.localStorage.getItem(storageKeyFor(windowId)) || window.localStorage.getItem(FILE_WORKBENCH_STORAGE_KEY);
    const saved = JSON.parse(encoded || "null") as Partial<PersistedWorkbench> | null;
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

function writePersistedWorkbench(windowId: string, saved: PersistedWorkbench) {
  try {
    window.localStorage.setItem(storageKeyFor(windowId), JSON.stringify(saved));
  } catch {
    // Preserve layout and opened files even if a very large unsaved draft
    // exceeds browser storage quota.
    const withoutDrafts = { ...saved, tabs: saved.tabs.map((tab) => ({ ...tab, draft: undefined, dirty: false })) };
    try { window.localStorage.setItem(storageKeyFor(windowId), JSON.stringify(withoutDrafts)); } catch { /* Storage is unavailable. */ }
  }
}

/** A remote file explorer with movable, split editor groups. */
export default function DualPaneSftp({ connections }: Props) {
  const [windowId] = useState(workbenchWindowId);
  const accessibilityId = useId();
  const tabDomId = (group: EditorGroup, id: string) => `${accessibilityId}-${group}-${encodeURIComponent(id)}`;
  const [storedWorkbench] = useState(() => loadPersistedWorkbench(windowId));
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
  const [transferNotice, setTransferNotice] = useState("");
  const persistedRef = useRef<PersistedWorkbench | null>(storedWorkbench);
  const transferChannelRef = useRef<BroadcastChannel | null>(null);

  const connId = connections.some((connection) => connection.id === selectedConnId)
    ? selectedConnId : connections[0]?.id || null;

  useLayoutEffect(() => {
    // Connections arrive asynchronously after the workspace is mounted. In
    // that first render selectedConnId is null while connId correctly falls
    // back to the first connection; that valid workspace must be persisted.
    if (!connId) return;
    const saved: PersistedWorkbench = { version: 1, connectionId: connId, tabs, active, focusedGroup, split };
    persistedRef.current = saved;
    writePersistedWorkbench(windowId, saved);
  }, [active, connId, focusedGroup, split, tabs, windowId]);

  useEffect(() => {
    const persistBeforeUnload = () => {
      if (persistedRef.current) writePersistedWorkbench(windowId, persistedRef.current);
    };
    window.addEventListener("pagehide", persistBeforeUnload);
    window.addEventListener("beforeunload", persistBeforeUnload);
    return () => {
      window.removeEventListener("pagehide", persistBeforeUnload);
      window.removeEventListener("beforeunload", persistBeforeUnload);
    };
  }, [windowId]);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(FILE_TAB_TRANSFER_CHANNEL);
    transferChannelRef.current = channel;
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const message = event.data as { type?: string; sourceWindowId?: string; transferId?: string } | null;
      if (!message || message.type !== "accepted" || message.sourceWindowId !== windowId || typeof message.transferId !== "string") return;
      setTabs((current) => {
        const removed = current.filter((tab) => tab.id !== message.transferId);
        if (removed.length === current.length) return current;
        setActive((selected) => ({
          primary: selected.primary === message.transferId ? removed.filter((tab) => tab.group === "primary").at(-1)?.id || null : selected.primary,
          secondary: selected.secondary === message.transferId ? removed.filter((tab) => tab.group === "secondary").at(-1)?.id || null : selected.secondary,
        }));
        return removed;
      });
    };
    return () => { channel.close(); transferChannelRef.current = null; };
  }, [windowId]);

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

  const receiveExternalTab = useCallback((transfer: ExternalFileTabTransfer, destination: EditorGroup, beforeId?: string) => {
    if (transfer.connectionId !== connId) {
      setTransferNotice(t("file_tab_transfer_connection_mismatch"));
      return;
    }
    const id = tabIdFor(transfer.tab.path);
    const alreadyOpen = tabs.find((tab) => tab.id === id);
    if (alreadyOpen?.dirty || (alreadyOpen && transfer.tab.dirty)) {
      setTransferNotice(t("file_tab_transfer_dirty_conflict"));
      return;
    }
    setTabs((current) => {
      const existing = current.find((tab) => tab.id === id);
      // Never discard either window's unsaved draft merely because two windows
      // happen to have the same remote path open.
      if (existing?.dirty || (existing && transfer.tab.dirty)) return current;
      const moving: EditorTab = existing || { ...transfer.tab, id, group: destination };
      const without = current.filter((tab) => tab.id !== id);
      const destinationTabs = without.filter((tab) => tab.group === destination);
      const found = beforeId ? destinationTabs.findIndex((tab) => tab.id === beforeId) : -1;
      const nextDestination = [...destinationTabs];
      nextDestination.splice(found < 0 ? nextDestination.length : found, 0, { ...moving, group: destination });
      return replaceGroup(without, destination, nextDestination);
    });
    setTransferNotice("");
    setActive((selected) => ({
      ...selected,
      [destination]: id,
    }));
    setFocusedGroup(destination);
    transferChannelRef.current?.postMessage({ type: "accepted", sourceWindowId: transfer.sourceWindowId, transferId: transfer.transferId });
  }, [connId, tabs]);

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
  const onTabKeys = (event: React.KeyboardEvent<HTMLElement>, group: EditorGroup, tabId: string) => {
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
      requestAnimationFrame(() => tabElement(groupTabs[next].id)?.querySelector<HTMLElement>('[role="tab"]')?.focus());
    }
  };

  const renderGroup = (group: EditorGroup) => {
    const groupTabs = tabsFor(group);
    const activeId = active[group];
    const moveTo = otherGroup(group);
    const moveDroppedTab = (event: React.DragEvent<HTMLElement>, beforeId?: string) => {
      event.preventDefault();
      event.stopPropagation();
      const external = parseExternalFileTab(event.dataTransfer.getData(FILE_TAB_TRANSFER_MIME));
      if (external && external.sourceWindowId !== windowId) receiveExternalTab(external, group, beforeId);
      else moveTab(event.dataTransfer.getData("text/plain") || draggedTabId || "", group, beforeId);
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
          {/* Own only tabs, not their sibling close buttons. Keeping close
              controls outside the tablist's accessibility tree preserves both
              valid tab semantics and independently accessible close actions. */}
          {groupTabs.length > 0 && <div role="tablist" aria-label={t("file_open_files")} aria-owns={groupTabs.map((tab) => tabDomId(group, tab.id)).join(" ")} />}
          <button className="file-editor-scroll" aria-label={t("file_scroll_tabs_left")} title={t("file_scroll_tabs_left")} onClick={() => scrollTabs(group, -1)}><Icon name="chevron-left" size={15} /></button>
          <div className="file-editor-tabs"
            onWheel={(event) => { if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) { event.preventDefault(); event.currentTarget.scrollLeft += event.deltaY; } }}
            onDrop={(event) => moveDroppedTab(event)}>
            {groupTabs.map((tab) => (
              <div key={tab.id} data-editor-tab-id={tab.id} className={`file-editor-tab${tab.id === activeId ? " is-active" : ""}${draggedTabId === tab.id ? " is-dragging" : ""}${dropTarget === tab.id ? " is-drop-target" : ""}`}
                onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropTarget(tab.id); }}
                onDragLeave={() => setDropTarget(null)}
                onDrop={(event) => moveDroppedTab(event, tab.id)}>
                <div id={tabDomId(group, tab.id)} role="tab" draggable aria-controls={`${tabDomId(group, tab.id)}-panel`} tabIndex={tab.id === activeId ? 0 : -1} aria-selected={tab.id === activeId}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", tab.id);
                    event.dataTransfer.setData(FILE_TAB_TRANSFER_MIME, JSON.stringify({ version: 1, transferId: tab.id, sourceWindowId: windowId, connectionId: connId, tab: {
                      path: tab.path, name: tab.name, revision: tab.revision, refreshMode: tab.refreshMode, dirty: tab.dirty, draft: tab.draft,
                    } satisfies ExternalFileTab }));
                    setDraggedTabId(tab.id);
                  }}
                  onDragEnd={() => { setDraggedTabId(null); setDropTarget(null); setDropGroup(null); }}
                  onKeyDown={(event) => onTabKeys(event, group, tab.id)} onClick={() => activate(group, tab.id)}>
                  <Icon name="file" size={14} /><span title={tab.path}>{tab.name}</span>{tab.dirty && <i aria-label={t("file_unsaved")} />}
                </div>
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
            <div key={tab.id} id={`${tabDomId(group, tab.id)}-panel`} role="tabpanel" aria-labelledby={tabDomId(group, tab.id)} className="file-editor-page" hidden={tab.id !== activeId}>
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
          <CustomSelect label={t("file_remote_files")} value={String(connId || "")} onChange={(value) => setSelectedConnId(Number(value) || null)}>{connections.map((connection) => <option key={connection.id} value={String(connection.id)}>{connection.name}</option>)}</CustomSelect>
        </div>
        {connId ? <SftpPanel key={connId} connId={connId} endpointId={`remote:${connId}`} refreshNonce={refreshNonce} onSocketChange={setSocket} onOpenFile={openFile} /> : <div className="sftp-endpoint-empty">{t("sftp_select_conn")}</div>}
      </aside>
      <main className="file-editor-workspace" aria-label={selectedConnectionName || t("file_remote_files")}>
        {transferNotice && <div className="sftp-state" role="status">{transferNotice}</div>}
        {renderGroup("primary")}{split && renderGroup("secondary")}
      </main>
    </div>
  );
}
