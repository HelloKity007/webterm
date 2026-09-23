import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentLoadingTask } from "pdfjs-dist";
import { t } from "../../i18n";
import Icon from "../common/Icon";
import { previewTicketURL } from "../../api/wsTicket";
import "./sftp.css";

type Props = {
  connId: number | null;
  filePath: string;
  fileName: string;
  size?: number;
  onClose: () => void;
  onEdit?: () => void;
};

type Sheet = { name: string; rows: unknown[][] };
const maxDocumentBytes = 25 * 1024 * 1024;
const maxSheetRows = 500;
const maxSheetColumns = 80;

function extension(name: string) {
  return name.toLowerCase().split(".").pop() || "";
}

function kindFor(name: string) {
  const ext = extension(name);
  if (["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg"].includes(ext)) return "image";
  if (["mp3", "wav", "ogg", "m4a", "aac", "flac", "opus"].includes(ext)) return "audio";
  if (["mp4", "webm", "ogv", "mov", "m4v"].includes(ext)) return "video";
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (["xlsx", "xls", "xlsm", "xlsb", "csv", "tsv"].includes(ext)) return "sheet";
  return "unknown";
}

function PdfPreview({ source }: { source: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pageCount, setPageCount] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.25);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | undefined;
    const render = async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        const worker = await import("pdfjs-dist/build/pdf.worker.mjs?url");
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        task = pdfjs.getDocument({ url: source, rangeChunkSize: 64 * 1024 });
        const document = await task.promise;
        if (cancelled) return;
        setPageCount(document.numPages);
        const safePage = Math.min(pageNumber, document.numPages);
        if (safePage !== pageNumber) setPageNumber(safePage);
        const page = await document.getPage(safePage);
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context || cancelled) return;
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvas, canvasContext: context, viewport }).promise;
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : t("file_preview_failed"));
      }
    };
    void render();
    return () => { cancelled = true; task?.destroy(); };
  }, [pageNumber, scale, source]);

  if (error) return <div className="file-preview-error">{error}</div>;
  return <div className="file-preview-pdf"><div className="file-preview-toolbar">
    <button className="file-editor-button" disabled={pageNumber <= 1} onClick={() => setPageNumber((value) => value - 1)}>‹</button>
    <span>{pageCount ? `${pageNumber} / ${pageCount}` : t("file_loading")}</span>
    <button className="file-editor-button" disabled={!pageCount || pageNumber >= pageCount} onClick={() => setPageNumber((value) => value + 1)}>›</button>
    <span className="sftp-status-spacer" />
    <button className="file-editor-button" onClick={() => setScale((value) => Math.max(.5, value - .25))}>−</button>
    <span>{Math.round(scale * 100)}%</span>
    <button className="file-editor-button" onClick={() => setScale((value) => Math.min(2.5, value + .25))}>+</button>
  </div><div className="file-preview-canvas"><canvas ref={canvasRef} /></div></div>;
}

function DocxPreview({ source }: { source: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const render = async () => {
      try {
        const [response, renderer] = await Promise.all([fetch(source, { signal: controller.signal }), import("docx-preview")]);
        if (!response.ok) throw new Error(`${response.status}`);
        const blob = await response.blob();
        if (controller.signal.aborted || !root.current) return;
        root.current.replaceChildren();
        await renderer.renderAsync(blob, root.current, undefined, { renderAltChunks: false, renderComments: false });
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("file_preview_failed"));
      }
    };
    void render();
    return () => controller.abort();
  }, [source]);
  return error ? <div className="file-preview-error">{error}</div> : <div ref={root} className="file-preview-docx" />;
}

function SheetPreview({ source }: { source: string }) {
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const [response, workbookLib] = await Promise.all([fetch(source, { signal: controller.signal }), import("@stackline/xlsx")]);
        if (!response.ok) throw new Error(`${response.status}`);
        const workbook = workbookLib.read(await response.arrayBuffer(), { type: "array" });
        if (controller.signal.aborted) return;
        setSheets(workbook.SheetNames.map((name: string) => ({ name, rows: workbookLib.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: "", blankrows: false }) as unknown[][] })));
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("file_preview_failed"));
      }
    };
    void load();
    return () => controller.abort();
  }, [source]);
  const sheet = sheets[activeSheet];
  const rows = sheet?.rows.slice(0, maxSheetRows) || [];
  const columns = Math.min(maxSheetColumns, Math.max(0, ...rows.map((row) => row.length)));
  if (error) return <div className="file-preview-error">{error}</div>;
  return <div className="file-preview-sheet">{sheets.length > 1 && <label>{t("file_preview_sheet")} <select value={activeSheet} onChange={(event) => setActiveSheet(Number(event.target.value))}>{sheets.map((item, index) => <option key={item.name} value={index}>{item.name}</option>)}</select></label>}
    {!sheet ? <div className="sftp-state">{t("file_loading")}</div> : <><div className="file-preview-sheet-grid"><table><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}><th>{rowIndex + 1}</th>{Array.from({ length: columns }, (_, column) => <td key={column}>{String(row[column] ?? "")}</td>)}</tr>)}</tbody></table></div>{(sheet.rows.length > maxSheetRows || columns >= maxSheetColumns) && <div className="file-preview-limit">{t("file_preview_sheet_limited")}</div>}</>}
  </div>;
}

export default function FilePreview({ connId, filePath, fileName, size, onClose, onEdit }: Props) {
  const [source, setSource] = useState("");
  const [sourcePath, setSourcePath] = useState("");
  const [error, setError] = useState("");
  const previewKind = kindFor(fileName);
  const refresh = useCallback(() => {
    if (!connId) return;
    setError("");
    void previewTicketURL(connId, filePath).then((value) => {
      setSource(value);
      setSourcePath(filePath);
    }, () => setError(t("file_preview_failed")));
  }, [connId, filePath]);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!connId) return;
      try {
        const value = await previewTicketURL(connId, filePath);
        if (!cancelled) {
          setSource(value);
          setSourcePath(filePath);
        }
      } catch {
        if (!cancelled) setError(t("file_preview_failed"));
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [connId, filePath]);
  const browserDocument = previewKind === "docx" || previewKind === "sheet";
  const tooLarge = browserDocument && typeof size === "number" && size > maxDocumentBytes;
  let body: React.ReactNode;
  if (error) body = <div className="file-preview-error">{error}</div>;
  else if (tooLarge) body = <div className="file-preview-error">{t("file_preview_too_large")}</div>;
  else if (!source || sourcePath !== filePath) body = <div className="sftp-state">{t("file_loading")}</div>;
  else if (previewKind === "image") body = <div className="file-preview-media"><img src={source} alt={fileName} /></div>;
  else if (previewKind === "audio") body = <div className="file-preview-media"><audio controls src={source} /></div>;
  else if (previewKind === "video") body = <div className="file-preview-media"><video controls src={source} /></div>;
  else if (previewKind === "pdf") body = <PdfPreview source={source} />;
  else if (previewKind === "docx") body = <DocxPreview source={source} />;
  else if (previewKind === "sheet") body = <SheetPreview source={source} />;
  else body = <div className="file-preview-error">{t("file_preview_unsupported")}</div>;
  return <div className="file-preview"><header className="file-preview-head"><span><Icon name="file" size={15} />{t("file_preview")}</span><span className="sftp-status-spacer" /><button className="file-editor-button" onClick={refresh}>{t("file_refresh")}</button>{onEdit && <button className="file-editor-button" onClick={onEdit}>{t("file_edit")}</button>}<button className="file-editor-button" onClick={onClose}>{t("tab_close")}</button></header>{body}</div>;
}
