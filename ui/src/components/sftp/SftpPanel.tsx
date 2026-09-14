import {
  lazy,
  Suspense,
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react";
import FileList, {
  type FileClipboard,
  type FileOperationState,
} from "./FileList";
import { t } from "../../i18n";
const FileEditor = lazy(() => import("../common/FileEditor"));
import { useLayoutStore } from "../../store/layout";
import Icon from "../common/Icon";
import { websocketTicketURL, WebSocketAuthError } from "../../api/wsTicket";

export interface SftpFile {
  name: string;
  path: string;
  size: number;
  mode: number;
  mod_time: string;
  is_dir: boolean;
  is_link: boolean;
  link_to?: string;
}

interface Props {
  connId?: number;
  tabId?: string;
  localMode?: boolean;
  currentPath?: string;
  onPathChange?: (path: string) => void;
  style?: React.CSSProperties;
  endpointId?: string;
  clipboard?: FileClipboard | null;
  onClipboardChange?: (clipboard: FileClipboard | null) => void;
  onSelectionChange?: (paths: string[]) => void;
  refreshNonce?: number;
}

export default function SftpPanel({
  connId,
  tabId,
  localMode,
  currentPath,
  onPathChange,
  style,
  endpointId: endpointIdProp,
  clipboard: externalClipboard,
  onClipboardChange,
  onSelectionChange,
  refreshNonce,
}: Props) {
  const defaultPath = currentPath || (localMode ? "/home" : "/");
  const [path, setPath] = useState(defaultPath);
  const [files, setFiles] = useState<SftpFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [disconnected, setDisconnected] = useState(false);
  const [followCd, setFollowCd] = useState(true);
  const [internalClipboard, setInternalClipboard] =
    useState<FileClipboard | null>(null);
  const [operation, setOperation] = useState<FileOperationState | null>(null);
  const lastOperationRef = useRef<{
    kind: "copy" | "move";
    paths: string[];
    destination: string;
  } | null>(null);
  const operationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endpointId =
    endpointIdProp || (localMode ? "local" : `remote:${connId}`);
  const clipboard =
    externalClipboard === undefined ? internalClipboard : externalClipboard;
  const changeClipboard = onClipboardChange || setInternalClipboard;
  const [editFile, setEditFile] = useState<{
    path: string;
    name: string;
  } | null>(null);
  const sessionKey = tabId || String(connId);
  const cacheRef = useRef<Map<string, { path: string; files: SftpFile[] }>>(
    new Map(),
  );
  const navRef = useRef({ history: [defaultPath], index: 0 });
  const [navState, setNavState] = useState({
    history: [defaultPath],
    index: 0,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const [editorSocket, setEditorSocket] = useState<WebSocket | null>(null);
  const [wsNonce, setWsNonce] = useState(0);
  const reconnectAttemptsRef = useRef(0);
  const pathRef = useRef(path);
  const prevKeyRef = useRef(sessionKey);
  const listingFilesRef = useRef<SftpFile[]>([]);
  const listingFrameRef = useRef<number | null>(null);

  useEffect(() => {
    pathRef.current = path;
  }, [path]);

  // Save cache for old session before switching to new one.
  useEffect(() => {
    if (prevKeyRef.current !== sessionKey) {
      if (prevKeyRef.current != null) {
        cacheRef.current.set(prevKeyRef.current, { path, files });
      }
      prevKeyRef.current = sessionKey;
    }
  }, [files, path, sessionKey]);

  const fetchDir = useCallback((dirPath: string, force = false) => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (!force && dirPath === pathRef.current) return;
    // Mutations refresh the current directory in the background. Keeping the
    // existing rows mounted preserves the user's virtual-list scroll context.
    if (!force) setLoading(true);
    setError("");
    socket.send(JSON.stringify({ action: "list", path: dirPath }));
  }, []);

  // Pool of SFTP sockets per connId — released only when SSH tabs for that connId are gone
  const poolRef = useRef<Map<number, WebSocket>>(new Map());
  const connKeyRef = useRef<number | null>(null);

  // Helper: check if connId still has active SSH tabs
  const connIsAlive = (cId: number) => {
    const cache = (
      window as unknown as {
        __paneTabsCache?: Map<string, import("../../store/layout").Tab[]>;
      }
    ).__paneTabsCache;
    if (!cache) return false;
    for (const tabs of cache.values()) {
      if (tabs.some((t) => t.connId === cId)) return true;
    }
    return false;
  };

  // Create or reuse WebSocket for current connId
  useEffect(() => {
    if (connId == null && !localMode) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const prevId = connKeyRef.current;
    connKeyRef.current = connId ?? null;
    const retry = () => {
      if (cancelled || !navigator.onLine || retryTimer !== undefined) return;
      const ceiling = Math.min(
        1000 * 2 ** Math.min(reconnectAttemptsRef.current++, 5),
        30000,
      );
      retryTimer = setTimeout(
        () => setWsNonce((value) => value + 1),
        Math.random() * ceiling,
      );
    };
    const startHeartbeat = (socket: WebSocket) => {
      clearInterval(heartbeat);
      heartbeat = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN)
          socket.send(JSON.stringify({ action: "ping" }));
      }, 20000);
    };
    const reconnectOnline = () => {
      clearTimeout(retryTimer);
      retryTimer = undefined;
      reconnectAttemptsRef.current = 0;
      setWsNonce((value) => value + 1);
    };
    const pauseOffline = () => {
      clearTimeout(retryTimer);
      retryTimer = undefined;
      wsRef.current?.close();
    };
    window.addEventListener("online", reconnectOnline);
    window.addEventListener("offline", pauseOffline);

    // If we have a socket for the new connId, reuse it
    const existing = connId == null ? undefined : poolRef.current.get(connId);
    if (existing && existing.readyState !== WebSocket.OPEN) {
      poolRef.current.delete(connId!);
    }
    if (existing && existing.readyState === WebSocket.OPEN) {
      wsRef.current = existing;
      setEditorSocket(existing);
      setDisconnected(false);
      const cached = cacheRef.current.get(sessionKey);
      const cdPaths = useLayoutStore.getState().sftpCdPaths;
      const trackedPath = tabId ? cdPaths[tabId] : undefined;
      const initPath = trackedPath || cached?.path || defaultPath;
      if (cached) setFiles(cached.files);
      setPath(initPath);
      setLoading(!cached);
      startHeartbeat(existing);
      return () => {
        cancelled = true;
        clearInterval(heartbeat);
        window.removeEventListener("online", reconnectOnline);
        window.removeEventListener("offline", pauseOffline);
      };
    }

    // Save old socket to pool if old connId still has SSH tabs; otherwise close it
    if (prevId != null && prevId !== connId) {
      if (connIsAlive(prevId)) {
        poolRef.current.set(prevId, wsRef.current!);
      } else {
        wsRef.current?.close();
        wsRef.current = null;
        setEditorSocket(null);
      }
    }

    setDisconnected(false);
    const cached = cacheRef.current.get(sessionKey);
    const cdPaths = useLayoutStore.getState().sftpCdPaths;
    const trackedPath = tabId ? cdPaths[tabId] : undefined;
    const initPath = trackedPath || cached?.path || defaultPath;
    if (cached) setFiles(cached.files);
    setPath(initPath);
    setLoading(!cached);
    setError("");

    void (async () => {
      const wsUrl = localMode
        ? await websocketTicketURL("/ws/local-fs", { endpoint: "local-fs" })
        : await websocketTicketURL(`/ws/sftp/${connId!}`, {
            endpoint: "sftp",
            connId: connId!,
          });
      if (cancelled) return;
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;
      setEditorSocket(socket);

      socket.onopen = () => {
        reconnectAttemptsRef.current = 0;
        setDisconnected(false);
        startHeartbeat(socket);
        if (cached) {
          socket.send(JSON.stringify({ action: "list", path: initPath }));
        } else {
          socket.send(JSON.stringify({ action: "getwd" }));
        }
      };
      socket.onclose = () => {
        clearInterval(heartbeat);
        if (cancelled) return;
        setDisconnected(true);
        setLoading(false);
        retry();
      };
      socket.onerror = () => socket.close();
      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "pong" || msg.type === "ping") return;
          if (msg.type === "file_list") {
            listingFilesRef.current = msg.files || [];
            setFiles(msg.files || []);
            setPath(msg.path || pathRef.current);
            setLoading(false);
          } else if (msg.type === "file_list_start") {
            if (listingFrameRef.current !== null) {
              cancelAnimationFrame(listingFrameRef.current);
              listingFrameRef.current = null;
            }
            listingFilesRef.current = [];
            setFiles([]);
            setPath(msg.path || pathRef.current);
            setLoading(true);
          } else if (msg.type === "file_list_chunk") {
            listingFilesRef.current.push(...(msg.files || []));
            if (listingFrameRef.current === null) {
              listingFrameRef.current = requestAnimationFrame(() => {
                listingFrameRef.current = null;
                setFiles([...listingFilesRef.current]);
              });
            }
          } else if (msg.type === "file_list_end") {
            if (listingFrameRef.current !== null) {
              cancelAnimationFrame(listingFrameRef.current);
              listingFrameRef.current = null;
            }
            setFiles([...listingFilesRef.current]);
            setLoading(false);
          } else if (msg.type === "error") {
            setError(msg.error);
            if (lastOperationRef.current) {
              if (operationTimerRef.current)
                clearTimeout(operationTimerRef.current);
              setOperation({ status: "failed", message: msg.error });
            }
            setLoading(false);
          } else if (msg.type === "pwd") {
            setPath(msg.path);
            fetchDir(msg.path);
          } else if (
            msg.type === "delete_done" ||
            msg.type === "mkdir_done" ||
            msg.type === "rename_done" ||
            msg.type === "copy_done" ||
            msg.type === "move_done" ||
            msg.type === "operation_done"
          ) {
            if (
              msg.type === "copy_done" ||
              msg.type === "move_done" ||
              msg.type === "operation_done"
            ) {
              if (operationTimerRef.current)
                clearTimeout(operationTimerRef.current);
              const failed = Array.isArray(msg.failed) ? msg.failed : [];
              if (failed.length)
                setOperation({
                  status: "failed",
                  message: failed
                    .map(
                      (item: { path?: string; error?: string }) =>
                        `${item.path || ""}: ${item.error || ""}`,
                    )
                    .join("; "),
                });
              else {
                setOperation(null);
                if (lastOperationRef.current?.kind === "move")
                  changeClipboard(null);
                lastOperationRef.current = null;
              }
            }
            fetchDir(pathRef.current, true);
          }
        } catch {
          /* ignore malformed SFTP responses */
        }
      };
    })().catch((ticketError) => {
      if (cancelled) return;
      setDisconnected(true);
      setLoading(false);
      if (!(ticketError instanceof WebSocketAuthError)) retry();
    });
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      clearInterval(heartbeat);
      if (listingFrameRef.current !== null) {
        cancelAnimationFrame(listingFrameRef.current);
        listingFrameRef.current = null;
      }
      window.removeEventListener("online", reconnectOnline);
      window.removeEventListener("offline", pauseOffline);
    };
  }, [
    changeClipboard,
    connId,
    defaultPath,
    fetchDir,
    localMode,
    sessionKey,
    tabId,
    wsNonce,
  ]);

  // Prune a specific connId from the pool when all its SSH tabs are gone
  const sftpPruneConn = useLayoutStore((s) => s.sftpPruneConn);
  useEffect(() => {
    if (sftpPruneConn == null) return;
    const socket = poolRef.current.get(sftpPruneConn);
    if (socket) {
      socket.close();
      poolRef.current.delete(sftpPruneConn);
    }
    // Also clear caches for this connId
    for (const [key] of cacheRef.current) {
      if (key.startsWith(String(sftpPruneConn))) cacheRef.current.delete(key);
    }
  }, [sftpPruneConn]);

  // Clean up pool on unmount
  useEffect(() => {
    const pool = poolRef.current;
    return () => {
      if (operationTimerRef.current) clearTimeout(operationTimerRef.current);
      try {
        wsRef.current?.close();
      } catch {
        /* already closed */
      }
      wsRef.current = null;
      pool.forEach((socket) => {
        try {
          socket.close();
        } catch {
          /* already closed */
        }
      });
      pool.clear();
    };
  }, []);

  // When tabId changes within same connId, refresh without reconnecting
  const tabInitRef = useRef(false);
  useEffect(() => {
    if (!tabInitRef.current) {
      tabInitRef.current = true;
      return;
    }
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const cached = cacheRef.current.get(sessionKey);
    if (cached) {
      fetchDir(cached.path);
    } else {
      socket.send(JSON.stringify({ action: "getwd" }));
    }
  }, [fetchDir, sessionKey, tabId]);

  // Follow SSH shell cd via OSC 7 (per-tab paths)
  const sftpCdPaths = useLayoutStore((s) => s.sftpCdPaths);
  const cdPath = tabId ? sftpCdPaths[tabId] : undefined;
  useEffect(() => {
    if (!followCd || !cdPath) return;
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (cdPath === path) return;
    const timer = window.setTimeout(() => {
      setPath(cdPath);
      fetchDir(cdPath);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [cdPath, fetchDir, followCd, path]);

  const navigateTo = useCallback(
    (newPath: string, pushHistory = true) => {
      setPath(newPath);
      // Typing updates the controlled path before Enter is handled; navigation
      // is intentional and must not be de-duplicated against that new value.
      fetchDir(newPath, true);
      onPathChange?.(newPath);
      if (pushHistory) {
        const nav = navRef.current;
        const next = nav.history.slice(0, nav.index + 1);
        if (next[next.length - 1] !== newPath) next.push(newPath);
        nav.history = next;
        nav.index = next.length - 1;
        setNavState({ history: [...nav.history], index: nav.index });
      }
    },
    [fetchDir, onPathChange, setNavState],
  );

  const handleNavigate = useCallback(
    (newPath: string) => navigateTo(newPath, true),
    [navigateTo],
  );

  const handleBack = () => {
    const nav = navRef.current;
    if (nav.index > 0) {
      nav.index--;
      navigateTo(nav.history[nav.index], false);
    }
  };
  const handleForward = () => {
    const nav = navRef.current;
    if (nav.index < nav.history.length - 1) {
      nav.index++;
      navigateTo(nav.history[nav.index], false);
    }
  };
  const handleHome = () => navigateTo(defaultPath, true);
  const handleGoParent = () => {
    if (path === "/") return;
    const parent = path.substring(0, path.lastIndexOf("/")) || "/";
    navigateTo(parent, true);
  };
  const canGoBack = navState.index > 0;
  const canGoForward = navState.index < navState.history.length - 1;

  const handleDelete = (filePath: string) => {
    wsRef.current?.send(JSON.stringify({ action: "delete", path: filePath }));
  };
  const handleRename = (filePath: string, newName: string) => {
    const dir = filePath.substring(0, filePath.lastIndexOf("/") + 1);
    wsRef.current?.send(
      JSON.stringify({
        action: "rename",
        path: filePath,
        new_path: dir + newName,
      }),
    );
  };
  const handleMkdir = (name: string) => {
    wsRef.current?.send(
      JSON.stringify({ action: "mkdir", path: path + "/" + name }),
    );
  };
  const handleEditFile = (filePath: string, fileName: string) => {
    setEditFile({ path: filePath, name: fileName });
  };
  const handleChmod = (filePath: string, mode: string) => {
    wsRef.current?.send(
      JSON.stringify({ action: "chmod", path: filePath, mode }),
    );
  };
  const handleFileOperation = useCallback(
    (kind: "copy" | "move", paths: string[], destination: string) => {
      const socket = wsRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        setOperation({ status: "failed", message: t("sftp_disconnected") });
        return;
      }
      lastOperationRef.current = { kind, paths, destination };
      setOperation({ status: "running" });
      socket.send(
        JSON.stringify({
          action: kind,
          paths,
          destination,
          request_id: crypto.randomUUID?.() || String(Date.now()),
        }),
      );
      if (operationTimerRef.current) clearTimeout(operationTimerRef.current);
      operationTimerRef.current = setTimeout(
        () =>
          setOperation({
            status: "failed",
            message: t("file_operation_failed"),
          }),
        15000,
      );
    },
    [],
  );
  const retryOperation = useCallback(() => {
    const last = lastOperationRef.current;
    if (last) handleFileOperation(last.kind, last.paths, last.destination);
  }, [handleFileOperation]);
  useEffect(() => {
    if (refreshNonce) fetchDir(pathRef.current, true);
  }, [fetchDir, refreshNonce]);

  return (
    <div className="sftp-shell" style={style}>
      <nav className="sftp-nav" aria-label={t("file_path")}>
        <div className="sftp-nav-actions">
          <button
            className="sftp-icon-button"
            onClick={handleBack}
            title={t("sftp_back")}
            aria-label={t("sftp_back")}
            disabled={!canGoBack}
          >
            <Icon name="chevron-left" size={16} />
          </button>
          <button
            className="sftp-icon-button"
            onClick={handleForward}
            title={t("sftp_forward")}
            aria-label={t("sftp_forward")}
            disabled={!canGoForward}
          >
            <Icon name="chevron-right" size={16} />
          </button>
          <button
            className="sftp-icon-button"
            onClick={handleGoParent}
            title={t("sftp_parent")}
            aria-label={t("sftp_parent")}
            disabled={path === "/"}
          >
            <Icon name="corner-left-up" size={15} />
          </button>
          <button
            className="sftp-icon-button"
            onClick={handleHome}
            title={t("sftp_home")}
            aria-label={t("sftp_home")}
          >
            <Icon name="home" size={15} />
          </button>
        </div>
        <label className="sftp-path-shell">
          <span className="sftp-path-icon">
            <Icon name="folder-open" size={14} />
          </span>
          <span className="sr-only">{t("file_path")}</span>
          <input
            className="sftp-path"
            value={path}
            onChange={(event) => setPath(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") handleNavigate(event.currentTarget.value);
            }}
            spellCheck={false}
          />
        </label>
        <button
          className="sftp-icon-button"
          onClick={() => fetchDir(path, true)}
          title={t("sftp_refresh")}
          aria-label={t("sftp_refresh")}
        >
          <Icon name="refresh-cw" size={15} />
        </button>
      </nav>
      {error && (
        <div className="sftp-panel-error" role="alert">
          <span>{error}</span>
          <button onClick={() => fetchDir(path, true)}>
            {t("sftp_refresh")}
          </button>
        </div>
      )}
      {disconnected ? (
        <div className="sftp-disconnected">
          <Icon name="link" size={30} />
          <strong>{t("sftp_disconnected")}</strong>
          <span>{t("file_connection_hint")}</span>
          <button
            className="sftp-action sftp-primary"
            onClick={() => {
              setError("");
              setFiles([]);
              setDisconnected(false);
              setWsNonce((n) => n + 1);
            }}
          >
            {t("sftp_reconnect")}
          </button>
        </div>
      ) : (
        <>
          <FileList
            key={path}
            files={files}
            loading={loading}
            onNavigate={handleNavigate}
            onDelete={handleDelete}
            onRename={handleRename}
            connId={connId}
            currentPath={path}
            onUpload={() => fetchDir(path, true)}
            onEdit={handleEditFile}
            onChmod={handleChmod}
            onMkdir={(name) => handleMkdir(name)}
            onGoParent={handleGoParent}
            onToggleFollow={() => setFollowCd(!followCd)}
            followCd={followCd}
            localMode={localMode}
            endpointId={endpointId}
            clipboard={clipboard}
            onClipboardChange={changeClipboard}
            onFileOperation={handleFileOperation}
            operation={operation}
            onRetryOperation={retryOperation}
            onSelectionChange={onSelectionChange}
          />
          {editFile && (
            <Suspense fallback={<div className="sftp-state">Loading…</div>}>
              <FileEditor
                filePath={editFile.path}
                fileName={editFile.name}
                ws={editorSocket}
                onClose={() => setEditFile(null)}
                onSaved={() => fetchDir(path, true)}
              />
            </Suspense>
          )}
        </>
      )}
    </div>
  );
}
