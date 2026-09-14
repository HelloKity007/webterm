import { useState } from "react";
import SftpPanel from "./SftpPanel";
import CustomSelect from "../common/CustomSelect";
import Icon from "../common/Icon";
import { t } from "../../i18n";
import type { FileClipboard } from "./FileList";

interface Props {
  connections: Array<{ id: number; name: string }>;
}

export default function DualPaneSftp({ connections }: Props) {
  const [leftConnId, setLeftConnId] = useState<number | null>(
    connections[0]?.id || null,
  );
  const [rightConnId, setRightConnId] = useState<number | null>(null);
  const [clipboard, setClipboard] = useState<FileClipboard | null>(null);
  const [leftPath, setLeftPath] = useState("/");
  const [rightPath, setRightPath] = useState("/home");
  const [leftSelection, setLeftSelection] = useState<string[]>([]);
  const [rightSelection, setRightSelection] = useState<string[]>([]);
  const [transfer, setTransfer] = useState<{
    status: "running" | "failed";
    message?: string;
  } | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [retry, setRetry] = useState<{
    from: "left" | "right";
    paths: string[];
  } | null>(null);
  const leftEndpoint = `remote:${leftConnId ?? "none"}`;
  const rightEndpoint = rightConnId == null ? "local" : `remote:${rightConnId}`;

  const endpoint = (side: "left" | "right", path: string) =>
    side === "left"
      ? { kind: "sftp", conn_id: leftConnId, path }
      : rightConnId == null
        ? { kind: "local", path }
        : { kind: "sftp", conn_id: rightConnId, path };
  const transferFiles = async (from: "left" | "right", paths: string[]) => {
    if (!paths.length) return;
    setRetry({ from, paths });
    setTransfer({ status: "running" });
    const to = from === "left" ? "right" : "left";
    const destinationDir = to === "left" ? leftPath : rightPath;
    const token = localStorage.getItem("token") || "";
    const failures: string[] = [];
    for (const sourcePath of paths) {
      const name = sourcePath.split("/").filter(Boolean).at(-1) || "item";
      const destinationPath = `${destinationDir.replace(/\/$/, "")}/${name}`;
      try {
        const response = await fetch("/api/files/transfer", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            source: endpoint(from, sourcePath),
            destination: endpoint(to, destinationPath),
            move: false,
            request_id: `ui-${Date.now()}-${name}`,
          }),
        });
        const result = await response.json();
        if (!response.ok || result.failed?.length)
          failures.push(
            ...(result.failed?.map(
              (item: { path: string; error: string }) =>
                `${item.path}: ${item.error}`,
            ) || [result.error || String(response.status)]),
          );
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (failures.length)
      setTransfer({ status: "failed", message: failures.join("; ") });
    else {
      setTransfer(null);
      setRefreshNonce((value) => value + 1);
    }
  };

  return (
    <div className="sftp-shell sftp-dual">
      {/* Left pane: Remote */}
      <div className="sftp-endpoint">
        <div className="sftp-endpoint-head">
          <Icon name="monitor" size={15} />
          <span className="sftp-endpoint-label">{t("sftp_remote")}</span>
          <CustomSelect
            value={String(leftConnId || "")}
            onChange={(v) => setLeftConnId(Number(v) || null)}
            style={{}}
          >
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </CustomSelect>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          {leftConnId ? (
            <SftpPanel
              connId={leftConnId}
              endpointId={leftEndpoint}
              clipboard={clipboard}
              onClipboardChange={setClipboard}
              onPathChange={setLeftPath}
              onSelectionChange={setLeftSelection}
              refreshNonce={refreshNonce}
            />
          ) : (
            <div className="sftp-endpoint-empty">{t("sftp_select_conn")}</div>
          )}
        </div>
      </div>

      {/* Divider */}
      <div className="sftp-divider" role="separator">
        <div
          className="sftp-direction-actions"
          aria-label={t("file_cross_endpoint_unavailable")}
        >
          <button
            disabled={!leftSelection.length || transfer?.status === "running"}
            title={t("file_transfer_right")}
            aria-label={t("file_transfer_right")}
            onClick={() => void transferFiles("left", leftSelection)}
          >
            ›
          </button>
          <button
            disabled={!rightSelection.length || transfer?.status === "running"}
            title={t("file_transfer_left")}
            aria-label={t("file_transfer_left")}
            onClick={() => void transferFiles("right", rightSelection)}
          >
            ‹
          </button>
        </div>
      </div>

      {/* Right pane: Local (default) or another remote */}
      <div className="sftp-endpoint">
        <div className="sftp-endpoint-head">
          <Icon name={rightConnId === null ? "laptop" : "monitor"} size={15} />
          <span className="sftp-endpoint-label">
            {rightConnId === null ? t("sftp_local") : t("sftp_remote")}
          </span>
          <CustomSelect
            value={rightConnId === null ? "local" : String(rightConnId)}
            onChange={(v) => setRightConnId(v === "local" ? null : Number(v))}
            style={{}}
          >
            <option value="local">{t("sftp_local_option")}</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </CustomSelect>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          {rightConnId ? (
            <SftpPanel
              connId={rightConnId}
              endpointId={rightEndpoint}
              clipboard={clipboard}
              onClipboardChange={setClipboard}
              onPathChange={setRightPath}
              onSelectionChange={setRightSelection}
              refreshNonce={refreshNonce}
            />
          ) : (
            <SftpPanel
              localMode
              endpointId={rightEndpoint}
              clipboard={clipboard}
              onClipboardChange={setClipboard}
              onPathChange={setRightPath}
              onSelectionChange={setRightSelection}
              refreshNonce={refreshNonce}
            />
          )}
        </div>
      </div>
      {transfer && (
        <div
          className={`sftp-cross-status${transfer.status === "failed" ? " is-error" : ""}`}
          role={transfer.status === "failed" ? "alert" : "status"}
        >
          <span>
            {transfer.status === "running"
              ? t("file_operation_running")
              : transfer.message || t("file_operation_failed")}
          </span>
          {transfer.status === "failed" && retry && (
            <button onClick={() => void transferFiles(retry.from, retry.paths)}>
              {t("file_retry")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
