import { lazy, Suspense, useCallback, useMemo, useState } from "react";
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
type EditorTab = OpenRemoteFile & {
  id: string;
  group: EditorGroup;
  refreshMode: "auto" | "manual" | null;
  dirty: boolean;
};

const tabIdFor = (path: string) => `file:${path}`;

/** One remote endpoint and a durable editor workbench. */
export default function DualPaneSftp({ connections }: Props) {
  const [selectedConnId, setSelectedConnId] = useState<number | null>(connections[0]?.id || null);
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [active, setActive] = useState<Record<EditorGroup, string | null>>({ primary: null, secondary: null });
  const [focusedGroup, setFocusedGroup] = useState<EditorGroup>("primary");
  const [split, setSplit] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const connId = connections.some((connection) => connection.id === selectedConnId)
    ? selectedConnId : connections[0]?.id || null;

  const openFile = useCallback((file: OpenRemoteFile) => {
    const id = tabIdFor(file.path);
    setTabs((current) => {
      const existing = current.find((tab) => tab.id === id);
      if (existing) return current.map((tab) => tab.id === id ? { ...tab, group: focusedGroup, revision: file.revision || tab.revision } : tab);
      return [...current, { ...file, id, group: focusedGroup, refreshMode: null, dirty: false }];
    });
    setActive((current) => ({ ...current, [focusedGroup]: id }));
  }, [focusedGroup]);

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

  const mergeSplit = () => {
    setTabs((current) => current.map((tab) => tab.group === "secondary" ? { ...tab, group: "primary" } : tab));
    setActive((current) => ({ primary: current.primary || current.secondary, secondary: null }));
    setFocusedGroup("primary");
    setSplit(false);
  };

  const renderGroup = (group: EditorGroup) => {
    const groupTabs = tabs.filter((tab) => tab.group === group);
    const activeId = active[group];
    return (
      <section className="file-editor-group" data-editor-group={group} onMouseDown={() => setFocusedGroup(group)}>
        <div className="file-editor-tabs" role="tablist" aria-label={t("file_open_files")}>
          {groupTabs.map((tab) => (
            <div key={tab.id} className={`file-editor-tab${tab.id === activeId ? " is-active" : ""}`}>
              <button role="tab" aria-selected={tab.id === activeId} onClick={() => setActive((current) => ({ ...current, [group]: tab.id }))}>
                <Icon name="file" size={14} /><span>{tab.name}</span>{tab.dirty && <i aria-label={t("file_unsaved")} />}
              </button>
              <button className="file-editor-tab-close" aria-label={`${t("tab_close")} ${tab.name}`} onClick={() => closeTab(tab.id)}><Icon name="x" size={13} /></button>
            </div>
          ))}
          {group === "primary" && <button className="file-editor-split" title={split ? t("file_close_split") : t("file_split_editor")} aria-label={split ? t("file_close_split") : t("file_split_editor")} onClick={() => split ? mergeSplit() : setSplit(true)}><Icon name={split ? "panel-left-close" : "table"} size={15} /></button>}
        </div>
        <div className="file-editor-stack">
          {!groupTabs.length && <div className="file-editor-empty"><Icon name="file" size={30} /><strong>{t("file_editor_empty_title")}</strong><span>{t("file_editor_empty_hint")}</span></div>}
          {groupTabs.map((tab) => (
            <div key={tab.id} className="file-editor-page" hidden={tab.id !== activeId}>
              <Suspense fallback={<div className="sftp-state">Loading…</div>}>
                <FileEditor embedded filePath={tab.path} fileName={tab.name} revision={tab.revision} ws={socket} refreshMode={tab.refreshMode}
                  onRefreshModeChange={(refreshMode) => setTabs((current) => current.map((item) => item.id === tab.id ? { ...item, refreshMode } : item))}
                  onDirtyChange={(dirty) => setTabs((current) => current.map((item) => item.id === tab.id ? { ...item, dirty } : item))}
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
          <CustomSelect value={String(connId || "")} onChange={(value) => setSelectedConnId(Number(value) || null)}>
            {connections.map((connection) => <option key={connection.id} value={String(connection.id)}>{connection.name}</option>)}
          </CustomSelect>
        </div>
        {connId ? <SftpPanel key={connId} connId={connId} endpointId={`remote:${connId}`} refreshNonce={refreshNonce} onSocketChange={setSocket} onOpenFile={openFile} /> : <div className="sftp-endpoint-empty">{t("sftp_select_conn")}</div>}
      </aside>
      <main className="file-editor-workspace" aria-label={selectedConnectionName || t("file_remote_files")}>
        {renderGroup("primary")}{split && renderGroup("secondary")}
      </main>
    </div>
  );
}
