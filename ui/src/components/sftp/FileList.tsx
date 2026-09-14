import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SftpFile } from "./SftpPanel";
import { t } from "../../i18n";
import ContextMenu from "../common/ContextMenu";
import Icon from "../common/Icon";
import { downloadTicketURL } from "../../api/wsTicket";
import "./sftp.css";
import { sizeFormat, timeFormat } from "./fileFormat";

interface Props {
  files: SftpFile[];
  loading: boolean;
  connId?: number;
  currentPath: string;
  onNavigate: (p: string) => void;
  onDelete: (p: string) => void;
  onRename: (p: string, n: string) => void;
  onMkdir: (n: string) => void;
  onUpload: () => void;
  onEdit: (p: string, n: string) => void;
  onChmod: (p: string, m: string) => void;
  onGoParent?: () => void;
  onToggleFollow?: () => void;
  followCd?: boolean;
  localMode?: boolean;
  endpointId: string;
  clipboard: FileClipboard | null;
  onClipboardChange: (clipboard: FileClipboard | null) => void;
  onFileOperation: (
    kind: "copy" | "move",
    paths: string[],
    destination: string,
  ) => void;
  operation?: FileOperationState | null;
  onRetryOperation?: () => void;
  onSelectionChange?: (paths: string[]) => void;
}
export interface FileClipboard {
  kind: "copy" | "move";
  paths: string[];
  endpointId: string;
}
export interface FileOperationState {
  status: "running" | "failed";
  message?: string;
}
type SortKey = "name" | "size" | "time";
type SortDir = "asc" | "desc";
function NameInput({
  value,
  onChange,
  onConfirm,
  onCancel,
  label = t("config_create"),
}: {
  value: string;
  onChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onCancel();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onCancel]);
  return (
    <div ref={ref} className="sftp-inline-editor">
      <input
        aria-label={t("file_folder_name")}
        autoFocus
        value={value}
        placeholder={t("file_folder_name")}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onConfirm();
          if (e.key === "Escape") onCancel();
        }}
      />
      <button className="sftp-action sftp-primary" onClick={onConfirm}>
        {label}
      </button>
      <button className="sftp-action" onClick={onCancel}>
        {t("conn_cancel")}
      </button>
    </div>
  );
}

export default function FileList(p: Props) {
  const {
    files,
    loading,
    connId,
    currentPath,
    onNavigate,
    onDelete,
    onRename,
    onMkdir,
    onUpload,
    onEdit,
    onChmod,
    onGoParent,
    onToggleFollow,
    followCd,
    localMode,
    endpointId,
    clipboard,
    onClipboardChange,
    onFileOperation,
    operation,
    onRetryOperation,
    onSelectionChange,
  } = p;
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState<Set<string>>(new Set()),
    [anchor, setAnchor] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("name"),
    [sortDir, setSortDir] = useState<SortDir>("asc");
  const [newFolder, setNewFolder] = useState(false),
    [folderName, setFolderName] = useState(""),
    [renaming, setRenaming] = useState<{ path: string; name: string } | null>(
      null,
    );
  const [menu, setMenu] = useState<{
      x: number;
      y: number;
      file: SftpFile;
    } | null>(null),
    [blankMenu, setBlankMenu] = useState<{ x: number; y: number } | null>(null);
  const [drag, setDrag] = useState(false),
    [uploading, setUploading] = useState(false),
    [progress, setProgress] = useState(0),
    [uploadName, setUploadName] = useState(""),
    [notice, setNotice] = useState<string | null>(null),
    [scrollTop, setScrollTop] = useState(0),
    [viewportHeight, setViewportHeight] = useState(500);
  const fileInput = useRef<HTMLInputElement>(null),
    uploadTarget = useRef<string | null>(null),
    listRef = useRef<HTMLDivElement>(null);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return files
      .filter((f) => !q || f.name.toLowerCase().includes(q))
      .sort((a, b) => {
        if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
        const c =
          sortKey === "name"
            ? a.name.localeCompare(b.name, undefined, {
                numeric: true,
                sensitivity: "base",
              })
            : sortKey === "size"
              ? a.size - b.size
              : a.mod_time.localeCompare(b.mod_time);
        return sortDir === "asc" ? c : -c;
      });
  }, [files, query, sortKey, sortDir]);
  useEffect(() => {
    const node = listRef.current;
    if (!node) return;
    const measure = () => setViewportHeight(node.clientHeight || 500);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(
    () => onSelectionChange?.([...selected]),
    [onSelectionChange, selected],
  );
  const flash = useCallback((s: string) => {
    setNotice(s);
    window.setTimeout(() => setNotice(null), 5000);
  }, []);
  const upload = useCallback(
    (items: FileList | File[]) => {
      if ((!connId && !localMode) || !items.length) return;
      const dest = uploadTarget.current || currentPath;
      uploadTarget.current = null;
      setUploading(true);
      setProgress(0);
      const token = localStorage.getItem("token") || "";
      const next = (i: number) => {
        if (i >= items.length) {
          setUploading(false);
          setUploadName("");
          onUpload();
          return;
        }
        const f = items[i];
        setUploadName(f.name);
        const form = new FormData();
        if (!localMode) form.append("conn_id", String(connId));
        form.append("path", `${dest.replace(/\/$/, "")}/${f.name}`);
        form.append("file", f);
        const x = new XMLHttpRequest();
        x.upload.onprogress = (e) => {
          if (e.lengthComputable)
            setProgress(Math.round((e.loaded / e.total) * 100));
        };
        x.onload = () => {
          if (x.status >= 200 && x.status < 300) next(i + 1);
          else {
            setUploading(false);
            let m = `${t("file_upload_failed")} (${x.status})`;
            try {
              m = JSON.parse(x.responseText).error || m;
            } catch {
              /*plain*/
            }
            flash(m);
          }
        };
        x.onerror = () => {
          setUploading(false);
          flash(t("file_upload_error"));
        };
        if (localMode) x.open("POST", "/api/local-files/upload");
        else x.open("POST", "/api/sftp/upload");
        x.setRequestHeader("Authorization", `Bearer ${token}`);
        x.send(form);
      };
      next(0);
    },
    [connId, currentPath, localMode, onUpload, flash],
  );
  const download = async (path: string, name: string) => {
    if (!connId && !localMode) return;
    const a = document.createElement("a");
    try {
      a.href = localMode
        ? await downloadTicketURL(
            "/api/local-files/download",
            { endpoint: "local-download" },
            { path },
          )
        : await downloadTicketURL(
            `/api/sftp/download/${connId}`,
            { endpoint: "sftp-download", connId },
            { path },
          );
    } catch {
      flash(`${t("file_download_failed")}: ${name}`);
      return;
    }
    a.download = name;
    a.hidden = true;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  const select = (f: SftpFile, e: React.MouseEvent) => {
    const add = e.ctrlKey || e.metaKey;
    if (e.shiftKey && anchor) {
      const a = visible.findIndex((x) => x.path === anchor),
        b = visible.findIndex((x) => x.path === f.path);
      if (a >= 0 && b >= 0) {
        const range = visible
          .slice(Math.min(a, b), Math.max(a, b) + 1)
          .map((x) => x.path);
        setSelected(new Set(add ? [...selected, ...range] : range));
        return;
      }
    }
    setAnchor(f.path);
    if (add) {
      const n = new Set(selected);
      if (n.has(f.path)) n.delete(f.path);
      else n.add(f.path);
      setSelected(n);
    } else setSelected(new Set([f.path]));
  };
  const focus = (i: number) => {
    const n = Math.max(0, Math.min(visible.length - 1, i)),
      f = visible[n];
    if (!f) return;
    setSelected(new Set([f.path]));
    setAnchor(f.path);
    const node = listRef.current;
    if (node) {
      const itemTop = n * 32;
      if (
        itemTop < node.scrollTop ||
        itemTop + 32 > node.scrollTop + node.clientHeight
      ) {
        node.scrollTop = Math.max(
          0,
          itemTop - Math.max(0, node.clientHeight - 32) / 2,
        );
        setScrollTop(node.scrollTop);
      }
    }
    requestAnimationFrame(() =>
      listRef.current
        ?.querySelector<HTMLElement>(`[data-index="${n}"]`)
        ?.focus(),
    );
  };
  const deletePaths = (paths: string[]) => {
    if (paths.length && window.confirm(t("file_delete_confirm")))
      paths.forEach(onDelete);
  };
  const keys = (e: React.KeyboardEvent) => {
    const path = [...selected].at(-1),
      i = visible.findIndex((f) => f.path === path),
      f = visible[i];
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setSelected(new Set(visible.map((x) => x.path)));
    } else if (e.key === "Escape") {
      setSelected(new Set());
      setQuery("");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      focus(i + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focus(i < 1 ? 0 : i - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      focus(0);
    } else if (e.key === "End") {
      e.preventDefault();
      focus(visible.length - 1);
    } else if (e.key === "Enter" && f) {
      if (f.is_dir) onNavigate(f.path);
      else onEdit(f.path, f.name);
    } else if (e.key === "F2" && f) {
      e.preventDefault();
      setRenaming({ path: f.path, name: f.name });
    } else if (e.key === "Delete" && f) {
      e.preventDefault();
      deletePaths([...selected]);
    }
  };
  const toggleSort = (k: SortKey) => {
    setScrollTop(0);
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("asc");
    }
  };
  const arrow = (k: SortKey) =>
    k === sortKey ? (
      <Icon name={sortDir === "asc" ? "arrow-up" : "arrow-down"} size={11} />
    ) : null;
  const rowHeight = 32;
  const overscan = 8;
  const windowStart = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const windowEnd = Math.min(
    visible.length,
    Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan,
  );
  const windowedFiles = visible.slice(windowStart, windowEnd);
  return (
    <section
      className={`sftp-browser${drag ? " is-dragging" : ""}`}
      aria-label={t("file_browser")}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrag(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        upload(e.dataTransfer.files);
      }}
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest("[data-file-row]")) return;
        e.preventDefault();
        setBlankMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) upload(e.target.files);
          e.target.value = "";
        }}
      />
      <div className="sftp-commandbar">
        <label className="sftp-filter">
          <Icon name="search" size={14} />
          <span className="sr-only">{t("file_filter")}</span>
          <input
            aria-label={t("file_filter")}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setScrollTop(0);
            }}
            placeholder={`${t("file_name")}…`}
          />
          {query && (
            <button
              aria-label={t("file_filter_clear")}
              onClick={() => setQuery("")}
            >
              <Icon name="x" size={12} />
            </button>
          )}
        </label>
        <div className="sftp-command-actions">
          <button className="sftp-action" onClick={() => setNewFolder(true)}>
            <Icon name="folder" size={14} />
            <span>{t("sftp_new_folder")}</span>
          </button>
          <button
            className="sftp-action sftp-primary"
            disabled={!connId && !localMode}
            onClick={() => fileInput.current?.click()}
          >
            <Icon name="arrow-up" size={14} />
            <span>{t("sftp_upload")}</span>
          </button>
          <button
            className={`sftp-action${followCd ? " is-active" : ""}`}
            aria-pressed={followCd}
            onClick={onToggleFollow}
          >
            <Icon name="radio" size={13} />
            <span>{followCd ? t("sftp_follow") : t("sftp_fixed")}</span>
          </button>
        </div>
      </div>
      {(selected.size > 0 || clipboard || operation) && (
        <div
          className="sftp-selectionbar"
          role="toolbar"
          aria-label={t("multi_mode")}
        >
          {selected.size > 0 && (
            <>
              <strong>
                {selected.size} {t("file_selected_count")}
              </strong>
              <button
                className="sftp-action"
                onClick={() =>
                  onClipboardChange({
                    kind: "copy",
                    paths: [...selected],
                    endpointId,
                  })
                }
              >
                {t("file_copy")}
              </button>
              <button
                className="sftp-action"
                onClick={() =>
                  onClipboardChange({
                    kind: "move",
                    paths: [...selected],
                    endpointId,
                  })
                }
              >
                {t("file_cut")}
              </button>
            </>
          )}
          {clipboard && (
            <button
              className="sftp-action sftp-primary"
              disabled={
                clipboard.endpointId !== endpointId ||
                operation?.status === "running"
              }
              title={
                clipboard.endpointId !== endpointId
                  ? t("file_cross_endpoint_unavailable")
                  : undefined
              }
              onClick={() =>
                onFileOperation(clipboard.kind, clipboard.paths, currentPath)
              }
            >
              {t("file_paste")} · {clipboard.paths.length}
            </button>
          )}
          {operation?.status === "running" && (
            <span className="sftp-operation-state">
              {t("file_operation_running")}
            </span>
          )}
          {operation?.status === "failed" && (
            <>
              <span className="sftp-operation-state is-error">
                {operation.message || t("file_operation_failed")}
              </span>
              <button className="sftp-action" onClick={onRetryOperation}>
                {t("file_retry")}
              </button>
            </>
          )}
          <span className="sftp-status-spacer" />
          {clipboard && (
            <button
              className="sftp-icon-button"
              aria-label={t("multi_cancel")}
              onClick={() => onClipboardChange(null)}
            >
              <Icon name="x" size={13} />
            </button>
          )}
        </div>
      )}
      {uploading && (
        <div className="sftp-transfer" role="status">
          <div>
            <span>{t("sftp_uploading")}</span>
            <strong>{uploadName}</strong>
            <span>{progress}%</span>
          </div>
          <progress max="100" value={progress} />
        </div>
      )}
      <div className="sftp-table-head" role="row">
        <span className="sftp-check">{selected.size || ""}</span>
        <button role="columnheader" onClick={() => toggleSort("name")}>
          {t("file_name")}
          {arrow("name")}
        </button>
        <button
          className="sftp-col-size"
          role="columnheader"
          onClick={() => toggleSort("size")}
        >
          {t("file_size")}
          {arrow("size")}
        </button>
        <button
          className="sftp-col-time"
          role="columnheader"
          onClick={() => toggleSort("time")}
        >
          {t("file_time")}
          {arrow("time")}
        </button>
      </div>
      <div
        ref={listRef}
        className="sftp-file-list"
        role="listbox"
        aria-multiselectable="true"
        aria-busy={loading}
        onKeyDown={keys}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        onDoubleClick={(e) => {
          if (!(e.target as HTMLElement).closest("[data-file-row]"))
            onGoParent?.();
        }}
      >
        {loading && (
          <div className="sftp-state" role="status">
            <span className="sftp-loader" />
            {t("file_loading")}
          </div>
        )}
        {!loading && currentPath !== "/" && (
          <div
            data-file-row
            className="sftp-file-row sftp-parent-row"
            role="option"
            aria-selected="false"
            tabIndex={0}
            onDoubleClick={onGoParent}
          >
            <span className="sftp-check" />
            <span className="sftp-file-name">
              <Icon name="corner-left-up" size={15} />
              <span>..</span>
            </span>
            <span className="sftp-col-size" />
            <span className="sftp-col-time" />
          </div>
        )}
        {!loading && (
          <div aria-hidden="true" style={{ height: windowStart * rowHeight }} />
        )}
        {!loading &&
          windowedFiles.map((f, windowIndex) => {
            const i = windowStart + windowIndex;
            return (
              <div
                key={f.path}
                data-file-row
                data-index={i}
                className={`sftp-file-row${selected.has(f.path) ? " is-selected" : ""}`}
                role="option"
                aria-selected={selected.has(f.path)}
                tabIndex={
                  selected.has(f.path) || (!selected.size && i === 0) ? 0 : -1
                }
                onClick={(e) => select(f, e)}
                onDoubleClick={() =>
                  f.is_dir ? onNavigate(f.path) : onEdit(f.path, f.name)
                }
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (!selected.has(f.path)) setSelected(new Set([f.path]));
                  setMenu({ x: e.clientX, y: e.clientY, file: f });
                }}
              >
                <span className="sftp-check">
                  {selected.has(f.path) && <Icon name="check" size={12} />}
                </span>
                <span className="sftp-file-name" title={f.path}>
                  {f.is_dir ? (
                    <Icon name="folder" size={16} />
                  ) : f.is_link ? (
                    <Icon name="link" size={15} />
                  ) : (
                    <Icon name="file" size={15} />
                  )}
                  <span>{f.name}</span>
                </span>
                <span className="sftp-col-size">
                  {f.is_dir ? "—" : sizeFormat(f.size)}
                </span>
                <span className="sftp-col-time">{timeFormat(f.mod_time)}</span>
              </div>
            );
          })}
        {!loading && (
          <div
            aria-hidden="true"
            style={{ height: (visible.length - windowEnd) * rowHeight }}
          />
        )}
        {!loading && !files.length && (
          <div className="sftp-state">
            <Icon name="folder-open" size={28} />
            <strong>{t("file_empty")}</strong>
            <span>{t("file_empty_hint")}</span>
          </div>
        )}
        {!loading && !!files.length && !visible.length && (
          <div className="sftp-state">
            <Icon name="search" size={25} />
            <strong>{t("file_no_matches")}</strong>
            <button className="sftp-text-button" onClick={() => setQuery("")}>
              {t("file_filter_clear")}
            </button>
          </div>
        )}
        {newFolder && (
          <NameInput
            value={folderName}
            onChange={setFolderName}
            onConfirm={() => {
              if (folderName.trim()) {
                onMkdir(folderName.trim());
                setNewFolder(false);
                setFolderName("");
              }
            }}
            onCancel={() => setNewFolder(false)}
          />
        )}{" "}
        {renaming && (
          <NameInput
            value={renaming.name}
            onChange={(name) => setRenaming({ ...renaming, name })}
            label={t("config_confirm")}
            onConfirm={() => {
              if (renaming.name.trim())
                onRename(renaming.path, renaming.name.trim());
              setRenaming(null);
            }}
            onCancel={() => setRenaming(null)}
          />
        )}
      </div>
      <footer className="sftp-statusbar" aria-live="polite">
        <span>
          {selected.size
            ? `${selected.size} ${t("file_selected_count")}`
            : `${visible.length} ${t("file_item_count")}`}
        </span>
        {query && (
          <span>
            {files.length - visible.length} {t("file_hidden_count")}
          </span>
        )}
        <span className="sftp-status-spacer" />
        <span>{followCd ? t("file_shell_linked") : t("file_path_pinned")}</span>
      </footer>
      {drag && (
        <div className="sftp-drop-overlay">
          <Icon name="arrow-up" size={28} />
          <strong>{t("file_drop_upload")}</strong>
          <span>{currentPath}</span>
        </div>
      )}
      {notice && (
        <div className="sftp-toast" role="alert">
          <span>{notice}</span>
          <button
            aria-label={t("file_dismiss")}
            onClick={() => setNotice(null)}
          >
            <Icon name="x" size={13} />
          </button>
        </div>
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            ...(menu.file.is_dir
              ? [
                  {
                    label: t("file_upload_to"),
                    action: () => {
                      uploadTarget.current = menu.file.path;
                      fileInput.current?.click();
                      setMenu(null);
                    },
                  },
                ]
              : [
                  {
                    label: t("file_download"),
                    action: () => {
                    void download(menu.file.path, menu.file.name);
                      setMenu(null);
                    },
                  },
                  {
                    label: t("file_edit"),
                    action: () => {
                      onEdit(menu.file.path, menu.file.name);
                      setMenu(null);
                    },
                  },
                ]),
            {
              label: t("file_chmod"),
              action: () => {
                const m = window.prompt(
                  `${t("file_chmod_prompt")} (${menu.file.name})`,
                  menu.file.is_dir ? "755" : "644",
                );
                if (m) onChmod(menu.file.path, m.trim());
                setMenu(null);
              },
            },
            {
              label: t("file_rename"),
              action: () => {
                setRenaming({ path: menu.file.path, name: menu.file.name });
                setMenu(null);
              },
            },
            {
              label: t("menu_delete"),
              action: () => {
                deletePaths(selected.size ? [...selected] : [menu.file.path]);
                setMenu(null);
              },
            },
            {
              label: t("sftp_refresh"),
              action: () => {
                onNavigate(currentPath);
                setMenu(null);
              },
            },
          ]}
        />
      )}
      {blankMenu && (
        <ContextMenu
          x={blankMenu.x}
          y={blankMenu.y}
          onClose={() => setBlankMenu(null)}
          items={[
            {
              label: t("sftp_new_folder"),
              action: () => {
                setNewFolder(true);
                setBlankMenu(null);
              },
            },
            {
              label: t("sftp_upload"),
              action: () => {
                fileInput.current?.click();
                setBlankMenu(null);
              },
            },
            {
              label: followCd ? t("sftp_fixed") : t("sftp_follow"),
              action: () => {
                onToggleFollow?.();
                setBlankMenu(null);
              },
            },
            {
              label: t("sftp_refresh"),
              action: () => {
                onNavigate(currentPath);
                setBlankMenu(null);
              },
            },
          ]}
        />
      )}
    </section>
  );
}
