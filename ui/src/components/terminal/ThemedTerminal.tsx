import { t } from '../../i18n';
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebglAddon } from '@xterm/addon-webgl';
import { websocketTicketURL, webSocketClientID } from '../../api/wsTicket';
import { useHighlightRules } from '../../hooks/useTerminalTheme';
import type { HighlightRule } from '../../hooks/useTerminalTheme';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useLayoutStore } from '../../store/layout';
import { useConnectionStore } from '../../store/connections';
import { usePreferencesStore } from '../../store/preferences';
import '@xterm/xterm/css/xterm.css';
import { getTheme } from '../../themes/presets';
import ContextMenu from '../common/ContextMenu';
import { colors } from '../../theme/tokens';
import Zmodem from 'zmodem.js/src/zmodem_browser.js';
import { deliverTerminalBytes } from './terminalOutput';
import TerminalHistoryHelp from './TerminalHistoryHelp';
import MobileTerminalReader from './MobileTerminalReader';
import { terminalModeAfterPrivateControl } from './terminalMode';
import { localViewportFont, localViewportRevealRow } from './localViewport';
import { observeTerminalRenderer } from './terminalRendererMetrics';
import { takeTerminalOutput } from './terminalOutputQueue';
import { cancelTerminalOutput, scheduleTerminalOutput } from './terminalOutputScheduler';
import {
  createTerminalWheelState,
  createLatestTerminalWheelSender,
  followTerminalInputAction,
  launchCodexScrollableAction,
  resumeTerminalInputAction,
  openClaudeTranscriptAction,
  routeTerminalWheel,
  terminalActionMessage,
  terminalScrollbackLines,
} from './terminalCliSupport';
import {
  clearTerminalHistory,
  copyTerminalText,
  createTerminalMouseState,
  getTerminalGridPosition,
  getTerminalSelectionRange,
  isForwardedTerminalPointerEvent,
  isTerminalSelectionDrag,
  pasteTerminalText,
  replayTerminalLeftClick,
  routeTerminalClipboardShortcut,
  routeTerminalControlShortcut,
  routeTerminalContextMenu,
  routeTerminalMouseDown,
  routeTerminalMouseMove,
  routeTerminalMouseUp,
  shouldAutoFocusTerminal,
  shouldRevealTerminalInputCursor,
} from './terminalInteractions';
import { calculateTerminalScale, constrainTerminalHeight, defaultSharedTerminalGrid, desktopRequestedGrid, mobileSharedTerminalGrid, parseSharedTerminalGridTitle, sharedGridForViewport, smallViewportWidth, type TerminalGrid } from './terminalScaling';
import { fitTerminalColumns } from './terminalWidth';
import { getSharedTerminalGrid, setSharedTerminalGrid } from './terminalGridCache';
import { isMobileBrowserEnvironment } from '../layout/mobileLayout';
import { clearShellHistoryViewport, loadShellHistoryViewport, restoredHistoryLine, saveShellHistoryViewport, shellHistoryViewportKey, type ShellHistoryViewport } from './shellHistoryViewport';

interface Props {
  connId: number;
  themeName?: string;
  onStatus?: (connected: boolean) => void;
  onResizeDim?: (cols: number, rows: number) => void;
  extraMenuItems?: { label: string; action: () => void }[];
  myTabId?: string;
  workspaceIndex?: number;
  panelNumber?: number;
}

function safeSessionStorage(): Storage | null {
  try { return window.sessionStorage; } catch { return null; }
}

function shellHistoryViewport(term: Terminal): ShellHistoryViewport | null {
  const buffer = term.buffer.active;
  if (buffer.type !== 'normal' || buffer.baseY < 1 || buffer.viewportY >= buffer.baseY) return null;
  const start = buffer.viewportY;
  let anchor = '';
  let anchorOffset = 0;
  for (let row = start; row <= Math.min(buffer.baseY, start + term.rows - 1); row++) {
    const text = buffer.getLine(row)?.translateToString(true) || '';
    if (text) { anchor = text; anchorOffset = row - start; break; }
  }
  return { anchor, anchorOffset, fromBottom: buffer.baseY - start, savedAt: Date.now() };
}

function restoreShellHistoryViewport(term: Terminal, snapshot: ShellHistoryViewport) {
  const buffer = term.buffer.active;
  const lines: string[] = [];
  for (let row = 0; row <= buffer.baseY; row++) lines.push(buffer.getLine(row)?.translateToString(true) || '');
  term.scrollToLine(restoredHistoryLine(snapshot, lines, buffer.baseY));
}

type Octets = Uint8Array | ArrayBuffer;
interface ZSentry { consume: (octets: Uint8Array) => void; }
interface ZTransfer { accept: () => Promise<void>; get_payloads: () => unknown; get_details: () => { name: string }; }
interface ZSession { type: 'send' | 'receive'; on: (event: string, callback: (value?: ZTransfer) => void) => void; start: () => void; abort: () => void; }
interface ZDetection { deny: () => void; confirm: () => ZSession; }
interface PendingLeftGesture {
  anchor: { col: number; row: number };
  clientX: number;
  clientY: number;
  detail: number;
  target: EventTarget;
  selecting: boolean;
}

function isTerminalScreenSnapshot(bytes: Uint8Array): boolean {
  const prefix = '\x1b]2;webterm-grid:';
  if (bytes.length < prefix.length) return false;
  for (let index = 0; index < prefix.length; index++) {
    if (bytes[index] !== prefix.charCodeAt(index)) return false;
  }
  return new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 256))).includes('\x1b[2J');
}

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r};${g};${b}`;
}

function highlightText(text: string, rules: HighlightRule[]): string {
  for (const rule of rules) {
    if (!rule.keyword) continue;
    try {
      const pattern = rule.regex ? rule.keyword : rule.keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(${pattern})`, 'g');
      if (!re.test(text)) continue;
      re.lastIndex = 0;
      text = text.replace(re, `\x1b[1m\x1b[38;2;${hexToRgb(rule.color)}m$1\x1b[0m`);
    } catch { /* invalid regex - skip rule */ }
  }
  return text;
}

export default function ThemedTerminal({ connId, onStatus, onResizeDim, extraMenuItems, myTabId, workspaceIndex, panelNumber }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const [termKey, setTermKey] = useState(0);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [clipboardNotice, setClipboardNotice] = useState('');
  const [historyHelpOpen, setHistoryHelpOpen] = useState(false);
  const [, setSelectionCopyArmed] = useState(false);
  const contextSelectionRef = useRef('');
  const mouseStateRef = useRef(createTerminalMouseState());
  const wheelStateRef = useRef(createTerminalWheelState());
  const terminalModeRef = useRef<'unknown' | 'shell' | 'cli'>('unknown');
  const alternateScreenRef = useRef(false);
  const selectionCopyArmedRef = useRef(false);
  const selectionAnchorRef = useRef<{ col: number; row: number } | null>(null);
  const pendingLeftGestureRef = useRef<PendingLeftGesture | null>(null);
  const globalSelectionCleanupRef = useRef<(() => void) | null>(null);
  const globalSelectionMoveRef = useRef<(event: MouseEvent) => void>(() => {});
  const globalSelectionUpRef = useRef<(event: MouseEvent) => void>(() => {});
  const selectionSnapshotRef = useRef('');
  const clipboardNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rules = useHighlightRules();
  const rulesRef = useRef(rules);
  const zsentryRef = useRef<ZSentry | null>(null);
  const zsessionRef = useRef<ZSession | null>(null);
  const zmodemActiveRef = useRef(false);
  const outputQueueRef = useRef<Uint8Array[]>([]);
  const outputFrameRef = useRef<number | null>(null);
  const outputTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const outputWritePendingRef = useRef(false);
  const outputPumpRef = useRef<() => void>(() => {});
  const sendRef = useRef<(data: string) => void>(() => {});
  const requestedGridRef = useRef<TerminalGrid | null>(null);
  const inputViewportFollowedRef = useRef(false);
  const pendingCursorRevealRef = useRef(false);
  const shellHistoryLoadedRef = useRef(false);
  const shellHistoryLoadingRef = useRef(false);
  const pendingShellHistoryScrollRef = useRef(0);
  const suppressLateScreenSnapshotRef = useRef(false);
  const shellHistoryRestoreRef = useRef<ShellHistoryViewport | null>(null);
  const shellHistoryStorageRef = useRef<Storage | null>(null);
  const shellHistoryStorageKeyRef = useRef<string | null>(null);
  const shellHistoryReaderActiveRef = useRef(false);
  const shellHistoryRestoreInFlightRef = useRef(false);
  const onStatusRef = useRef(onStatus);
  const onResizeDimRef = useRef(onResizeDim);
  const themeName = usePreferencesStore((s) => s.themeName);
  const fontSize = usePreferencesStore((s) => s.fontSize);
  const setSftpCdPath = useLayoutStore((s) => s.setSftpCdPath);
  const setStatusConn = useLayoutStore((s) => s.setStatusConn);
  const focusedPaneId = useLayoutStore((s) => s.focusedPaneId);

  const enqueueTerminalOutput = useCallback((bytes: Uint8Array) => {
    outputQueueRef.current.push(bytes);
    outputPumpRef.current();
  }, []);

  useEffect(() => {
    rulesRef.current = rules;
    onStatusRef.current = onStatus;
    onResizeDimRef.current = onResizeDim;
  }, [onResizeDim, onStatus, rules]);

  const showClipboardNotice = useCallback((message: string) => {
    if (clipboardNoticeTimerRef.current) clearTimeout(clipboardNoticeTimerRef.current);
    setClipboardNotice(message);
    clipboardNoticeTimerRef.current = setTimeout(() => setClipboardNotice(''), 2500);
  }, []);

  const copySelectionText = useCallback(async (text: string) => {
    const result = await copyTerminalText(text, navigator.clipboard);
    showClipboardNotice(result === 'ok' ? `${t('term_copied')} (${text.length})` : result === 'empty' ? t('term_copy_empty') : t('term_copy_failed'));
  }, [showClipboardNotice]);

  const copyCurrentSelection = useCallback(async () => {
    const text = termRef.current?.getSelection() || selectionSnapshotRef.current;
    await copySelectionText(text);
  }, [copySelectionText]);

  const pasteFromClipboard = useCallback(async () => {
    const result = await pasteTerminalText(navigator.clipboard, (text) => termRef.current?.paste(text));
    if (result === 'ok') termRef.current?.focus();
    else showClipboardNotice(result === 'empty' ? t('term_paste_empty') : t('term_paste_failed'));
  }, [showClipboardNotice]);

  const setSelectionCopyMode = useCallback((armed: boolean) => {
    selectionCopyArmedRef.current = armed;
    selectionAnchorRef.current = null;
    setSelectionCopyArmed(armed);
    if (armed) {
      selectionSnapshotRef.current = '';
      termRef.current?.clearSelection();
      showClipboardNotice(t('term_select_copy_hint'));
    } else {
      termRef.current?.focus();
    }
  }, [showClipboardNotice]);

  const terminalCellAt = useCallback((clientX: number, clientY: number) => {
    const term = termRef.current;
    const screen = term?.element?.querySelector('.xterm-screen');
    if (!term || !screen || term.cols < 1 || term.rows < 1) return null;
    const bounds = screen.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return null;
    const position = getTerminalGridPosition({ x: clientX, y: clientY }, bounds, term.cols, term.rows);
    return {
      col: position.col - 1,
      row: term.buffer.active.viewportY + position.row - 1,
    };
  }, []);

  const extendSelectionCopy = useCallback((clientX: number, clientY: number) => {
    const term = termRef.current;
    const anchor = selectionAnchorRef.current;
    const focus = terminalCellAt(clientX, clientY);
    if (!term || !anchor || !focus) return null;
    const range = getTerminalSelectionRange(anchor, focus, term.cols);
    term.select(range.startColumn, range.startRow, range.length);
    const text = term.getSelection();
    if (text) selectionSnapshotRef.current = text;
    return { focus, text: text || selectionSnapshotRef.current };
  }, [terminalCellAt]);

  const sendTmuxMenuPointer = useCallback((position: { x: number; y: number }, code: number, suffix: 'M' | 'm') => {
    const term = termRef.current;
    const screen = term?.element?.querySelector('.xterm-screen');
    if (!term || !screen) return;
    const bounds = screen.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0 || term.cols <= 0 || term.rows <= 0) return;
    const { col, row } = getTerminalGridPosition(position, bounds, term.cols, term.rows);
    sendRef.current(JSON.stringify({ data: `\x1b[<${code};${col};${row}${suffix}` }));
    term.focus();
  }, []);

  const moveTmuxMenuAt = useCallback((position: { x: number; y: number }) => {
    sendTmuxMenuPointer(position, 42, 'M');
  }, [sendTmuxMenuPointer]);

  const releaseTmuxMenuAt = useCallback((position: { x: number; y: number }) => {
    sendTmuxMenuPointer(position, 10, 'm');
  }, [sendTmuxMenuPointer]);

  const focusTerminalAfterPointer = useCallback(() => {
    requestAnimationFrame(() => termRef.current?.focus());
  }, []);

  // Copying should not leave a translucent visual selection behind. xterm can
  // repaint its native selection after React's mouse-up handler, so clear it
  // again on the next paints and task turn.
  const clearVisualSelection = useCallback(() => {
    const clear = () => termRef.current?.clearSelection();
    clear();
    requestAnimationFrame(() => {
      clear();
      requestAnimationFrame(clear);
    });
    setTimeout(clear, 0);
  }, []);

  const trackSelectionOutsideSurface = useCallback(() => {
    globalSelectionCleanupRef.current?.();
    const onMove = (event: MouseEvent) => globalSelectionMoveRef.current(event);
    const onUp = (event: MouseEvent) => globalSelectionUpRef.current(event);
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mouseup', onUp, true);
    globalSelectionCleanupRef.current = () => {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseup', onUp, true);
      globalSelectionCleanupRef.current = null;
    };
  }, []);

  const handleSurfaceMouseDown = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (selectionCopyArmedRef.current && event.button === 0) {
      event.preventDefault();
      event.stopPropagation();
      const cell = terminalCellAt(event.clientX, event.clientY);
      if (!cell) return;
      selectionAnchorRef.current = cell;
      termRef.current?.select(cell.col, cell.row, 1);
      selectionSnapshotRef.current = termRef.current?.getSelection() || '';
      return;
    }
    if (
      event.button === 0
      && !event.ctrlKey
      && !event.shiftKey
      && !event.altKey
      && !mouseStateRef.current.tmuxMenuActive
      && !isForwardedTerminalPointerEvent(event.nativeEvent)
    ) {
      const anchor = terminalCellAt(event.clientX, event.clientY);
      if (anchor && event.target) {
        event.preventDefault();
        event.stopPropagation();
        pendingLeftGestureRef.current = {
          anchor,
          clientX: event.clientX,
          clientY: event.clientY,
          detail: event.detail || 1,
          target: event.target,
          selecting: false,
        };
        selectionAnchorRef.current = anchor;
        selectionSnapshotRef.current = '';
        termRef.current?.clearSelection();
        termRef.current?.focus();
        trackSelectionOutsideSurface();
        return;
      }
    }
    routeTerminalMouseDown(event, mouseStateRef.current, {
      focusTerminal: focusTerminalAfterPointer,
      releaseTmuxMenuAt,
    });
  }, [focusTerminalAfterPointer, releaseTmuxMenuAt, terminalCellAt, trackSelectionOutsideSurface]);

  const handleSurfaceMouseMove = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (selectionCopyArmedRef.current && selectionAnchorRef.current && (event.buttons & 1) === 1) {
      event.preventDefault();
      event.stopPropagation();
      extendSelectionCopy(event.clientX, event.clientY);
      return;
    }
    const pending = pendingLeftGestureRef.current;
    if (pending && !isForwardedTerminalPointerEvent(event.nativeEvent)) {
      if ((event.buttons & 1) !== 1) {
        pendingLeftGestureRef.current = null;
        selectionAnchorRef.current = null;
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (!pending.selecting && isTerminalSelectionDrag(
        { x: pending.clientX, y: pending.clientY },
        { x: event.clientX, y: event.clientY },
      )) {
        pending.selecting = true;
        termRef.current?.select(pending.anchor.col, pending.anchor.row, 1);
        selectionSnapshotRef.current = termRef.current?.getSelection() || '';
      }
      if (pending.selecting) extendSelectionCopy(event.clientX, event.clientY);
      return;
    }
    routeTerminalMouseMove(event, mouseStateRef.current, { moveTmuxMenuAt });
  }, [extendSelectionCopy, moveTmuxMenuAt]);

  const handleSurfaceMouseUp = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (selectionCopyArmedRef.current && selectionAnchorRef.current && event.button === 0) {
      event.preventDefault();
      event.stopPropagation();
      const term = termRef.current;
      const selected = extendSelectionCopy(event.clientX, event.clientY);
      if (term && selected) {
        clearVisualSelection();
      }
      selectionAnchorRef.current = null;
      selectionCopyArmedRef.current = false;
      setSelectionCopyArmed(false);
      void copySelectionText(selected?.text || selectionSnapshotRef.current);
      return;
    }
    const pending = pendingLeftGestureRef.current;
    if (pending && event.button === 0 && !isForwardedTerminalPointerEvent(event.nativeEvent)) {
      event.preventDefault();
      event.stopPropagation();
      const selecting = pending.selecting || isTerminalSelectionDrag(
        { x: pending.clientX, y: pending.clientY },
        { x: event.clientX, y: event.clientY },
      );
      const selected = selecting ? extendSelectionCopy(event.clientX, event.clientY) : null;
      if (selecting && selected && termRef.current) clearVisualSelection();
      pendingLeftGestureRef.current = null;
      selectionAnchorRef.current = null;
      globalSelectionCleanupRef.current?.();
      if (selecting) {
        void copySelectionText(selected?.text || selectionSnapshotRef.current);
      } else {
        replayTerminalLeftClick(
          pending.target,
          { x: pending.clientX, y: pending.clientY, detail: pending.detail },
          { x: event.clientX, y: event.clientY },
        );
      }
      return;
    }
    routeTerminalMouseUp(event, mouseStateRef.current, { focusTerminal: focusTerminalAfterPointer });
  }, [clearVisualSelection, copySelectionText, extendSelectionCopy, focusTerminalAfterPointer]);

  useEffect(() => {
    globalSelectionMoveRef.current = (event) => {
      const pending = pendingLeftGestureRef.current;
      if (!pending || (event.buttons & 1) !== 1) return;
      event.preventDefault();
      const current = { x: event.clientX, y: event.clientY };
      if (!pending.selecting && isTerminalSelectionDrag(
        { x: pending.clientX, y: pending.clientY }, current,
      )) {
        pending.selecting = true;
        termRef.current?.select(pending.anchor.col, pending.anchor.row, 1);
        selectionSnapshotRef.current = termRef.current?.getSelection() || '';
      }
      if (pending.selecting) extendSelectionCopy(event.clientX, event.clientY);
    };
    globalSelectionUpRef.current = (event) => {
      const pending = pendingLeftGestureRef.current;
      if (!pending || event.button !== 0) return;
      const selecting = pending.selecting || isTerminalSelectionDrag(
        { x: pending.clientX, y: pending.clientY }, { x: event.clientX, y: event.clientY },
      );
      const selected = selecting ? extendSelectionCopy(event.clientX, event.clientY) : null;
      pendingLeftGestureRef.current = null;
      selectionAnchorRef.current = null;
      globalSelectionCleanupRef.current?.();
      if (selecting) {
        clearVisualSelection();
        void copySelectionText(selected?.text || selectionSnapshotRef.current);
      } else {
        replayTerminalLeftClick(
          pending.target,
          { x: pending.clientX, y: pending.clientY, detail: pending.detail },
          { x: event.clientX, y: event.clientY },
        );
      }
    };
  }, [clearVisualSelection, copySelectionText, extendSelectionCopy]);

  useEffect(() => () => {
    if (clipboardNoticeTimerRef.current) clearTimeout(clipboardNoticeTimerRef.current);
    globalSelectionCleanupRef.current?.();
  }, []);

  const sendBinary = useCallback((octets: Octets) => {
    const bytes = octets instanceof Uint8Array ? octets : new Uint8Array(octets);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    sendRef.current(JSON.stringify({ data: btoa(bin), b64: true }));
  }, []);

  const sendTextAsBinary = useCallback((text: string) => {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    sendRef.current(JSON.stringify({ data: btoa(bin), b64: true }));
  }, []);

  const terminalID = myTabId || '';
  const loadShellHistoryForScroll = useCallback((lines: number) => {
    const term = termRef.current;
    if (!term) return;
    const restore = shellHistoryRestoreRef.current;
    // A reload may already have received one visible screen. That is not a
    // complete history buffer, so a saved reader position must still fetch
    // the explicit bounded capture instead of accepting that screen as final.
    if (restore && shellHistoryLoadedRef.current) {
      restoreShellHistoryViewport(term, restore);
      shellHistoryRestoreRef.current = null;
      shellHistoryReaderActiveRef.current = true;
      // Keep the scroll listener guarded until after this current paint. A
      // scrollToLine emits xterm's scroll event synchronously.
      requestAnimationFrame(() => {
        if (termRef.current === term && shellHistoryRestoreRef.current === null) {
          restoreShellHistoryViewport(term, restore);
          shellHistoryRestoreInFlightRef.current = false;
        }
      });
      return;
    }
    // A buffer with a scrollback base is already complete for this client.
    // Do not make a control-plane request on every ordinary wheel event.
    if (!restore && (shellHistoryLoadedRef.current || term.buffer.active.baseY > 0)) {
      term.scrollLines(lines);
      // A peer can own a taller shared tmux grid than this panel. Once a
      // downward wheel has genuinely returned xterm to its live bottom, make
      // that local input row visible without using the outer blank tail while
      // the user is reading upward history.
      if (lines > 0) {
        requestAnimationFrame(() => {
          const surface = ref.current;
          const screen = term.element?.querySelector<HTMLElement>('.xterm-screen');
          if (!surface || !screen || term.buffer.active.viewportY < term.buffer.active.baseY) return;
          // This is a deliberate wheel-down back to the live prompt. Unlike
          // xterm's generic scroll event it cannot be produced by a reload,
          // a reconnect snapshot, or a resize, so it is safe to discard the
          // saved reader position here.
          shellHistoryReaderActiveRef.current = false;
          const storage = shellHistoryStorageRef.current;
          const key = shellHistoryStorageKeyRef.current;
          if (storage && key) clearShellHistoryViewport(storage, key);
          surface.scrollTop = localViewportRevealRow(surface.scrollTop, surface.clientHeight, surface.scrollHeight,
            screen.getBoundingClientRect().height / term.rows, term.buffer.active.cursorY);
        });
      }
      return;
    }
    pendingShellHistoryScrollRef.current += lines;
    if (shellHistoryLoadingRef.current || !terminalID) return;
    shellHistoryLoadingRef.current = true;
    // The websocket's bounded attach snapshot and this explicit tmux capture
    // race on a newly restored panel. The capture already contains its latest
    // screen, so a late attach snapshot must not append one more screen and
    // force an intentional history reader back to the live bottom.
    suppressLateScreenSnapshotRef.current = true;
    const query = new URLSearchParams({ terminal_id: terminalID });
    if (workspaceIndex && panelNumber) {
      query.set('workspace_index', String(workspaceIndex));
      query.set('panel_number', String(panelNumber));
    }
    void (async () => {
      try {
        const response = await fetch(`/api/terminal-history/${encodeURIComponent(connId)}?${query.toString()}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
        });
        if (!response.ok) throw new Error(`history capture failed (${response.status})`);
        const payload = await response.json() as { data?: string };
        if (!payload.data) return;
        const binary = atob(payload.data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        // This path follows an intentional wheel-up. It is never called by a
        // tab switch, so even a busy 20,000-line pane cannot visually replay
        // while the user is merely changing tabs.
        term.reset();
        // Use the same bounded write size as the live socket pump. A tmux
        // history capture can be megabytes long; one giant xterm write causes
        // renderer starvation and makes the first visible history frame look
        // like overlapping text on some WebGL paths.
        for (let offset = 0; offset < bytes.length; offset += 16 * 1024) {
          await new Promise<void>((resolve) => term.write(bytes.subarray(offset, offset + 16 * 1024), resolve));
        }
        shellHistoryLoadedRef.current = true;
        term.scrollToBottom();
        const requestedScroll = pendingShellHistoryScrollRef.current;
        const pendingRestore = shellHistoryRestoreRef.current;
        if (pendingRestore) {
          restoreShellHistoryViewport(term, pendingRestore);
          shellHistoryRestoreRef.current = null;
          shellHistoryReaderActiveRef.current = true;
        } else {
          term.scrollLines(requestedScroll);
        }
        // The initial, bounded screen capture races this explicit HTTP
        // capture on a fresh attachment. If it arrives just afterwards, its
        // live-screen write correctly follows the prompt and would otherwise
        // cancel the user's very first wheel-up. Reapply the same intent once
        // that attach burst has settled; later normal wheels use xterm alone.
        setTimeout(() => {
          if (!shellHistoryLoadedRef.current || termRef.current !== term) return;
          if (pendingRestore) {
            // A hard reload can receive its WebSocket screen snapshot just
            // after the HTTP history capture. Reapply the exact reader anchor
            // after that attach burst, rather than leaving the user at bottom.
            restoreShellHistoryViewport(term, pendingRestore);
            shellHistoryRestoreInFlightRef.current = false;
          } else if (!shellHistoryReaderActiveRef.current) {
            term.scrollLines(requestedScroll);
          }
        }, 350);
      } catch (error) {
        suppressLateScreenSnapshotRef.current = false;
        console.warn('terminal history capture:', error);
      } finally {
        pendingShellHistoryScrollRef.current = 0;
        shellHistoryLoadingRef.current = false;
      }
    })();
  }, [connId, panelNumber, terminalID, workspaceIndex]);

  useEffect(() => {
    const themeConfig = getTheme(themeName || 'XTerminal Green');
    // A recreated xterm starts from the visible remote screen again. Treat
    // that as a fresh client viewport so a later wheel can request tmux
    // history instead of assuming a discarded local buffer still exists.
    shellHistoryLoadedRef.current = false;
    shellHistoryLoadingRef.current = false;
    pendingShellHistoryScrollRef.current = 0;
    suppressLateScreenSnapshotRef.current = false;
    shellHistoryReaderActiveRef.current = false;
    shellHistoryStorageRef.current = safeSessionStorage();
    const userID = (() => {
      try { return String(JSON.parse(localStorage.getItem('webterm-user') || '{}').id || 'anonymous'); } catch { return 'anonymous'; }
    })();
    shellHistoryStorageKeyRef.current = shellHistoryViewportKey(userID, connId, terminalID, workspaceIndex, panelNumber);
    shellHistoryRestoreRef.current = shellHistoryStorageRef.current && shellHistoryStorageKeyRef.current
      ? loadShellHistoryViewport(shellHistoryStorageRef.current, shellHistoryStorageKeyRef.current)
      : null;
    shellHistoryRestoreInFlightRef.current = shellHistoryRestoreRef.current !== null;
    const term = new Terminal({
      cursorBlink: true, fontSize: isMobileBrowserEnvironment() ? Math.max(11, fontSize - 4) : fontSize, fontFamily: '"JetBrains Mono", "JetBrains Maple Mono", Consolas, monospace',
      scrollback: terminalScrollbackLines,
      scrollOnUserInput: true,
      // Match native terminal applications: one wheel notch should advance
      // several rows instead of appearing to crawl through long scrollback.
      scrollSensitivity: 3,
      fastScrollSensitivity: 3,
      overviewRuler: { width: isMobileBrowserEnvironment() ? 0 : 5 },
      theme: {
        // xterm rejects the named transparent color and falls back to white.
        overviewRulerBorder: '#00000000',
        scrollbarSliderBackground: '#8fbd9180',
        scrollbarSliderHoverBackground: '#8fbd9199',
        scrollbarSliderActiveBackground: '#8fbd91b3',
        background: themeConfig.background,
        foreground: themeConfig.foreground,
        cursor: themeConfig.cursor,
        cursorAccent: themeConfig.cursorAccent,
        selectionBackground: themeConfig.selectionBackground,
        black: themeConfig.black,
        red: themeConfig.red,
        green: themeConfig.green,
        yellow: themeConfig.yellow,
        blue: themeConfig.blue,
        magenta: themeConfig.magenta,
        cyan: themeConfig.cyan,
        white: themeConfig.white,
        brightBlack: themeConfig.brightBlack,
        brightRed: themeConfig.brightRed,
        brightGreen: themeConfig.brightGreen,
        brightYellow: themeConfig.brightYellow,
        brightBlue: themeConfig.brightBlue,
        brightMagenta: themeConfig.brightMagenta,
        brightCyan: themeConfig.brightCyan,
        brightWhite: themeConfig.brightWhite,
      },
    });
    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(searchAddon);
    // Protocol beats printed words: a Claude response may contain shell
    // prompts, "bash", "context" or even an entire shell script.
    const applyTerminalMode = (mode: 'unknown' | 'shell' | 'cli') => {
      terminalModeRef.current = mode;
      if (ref.current) ref.current.dataset.terminalMode = mode;
    };
    const modeDisposables = (['h', 'l'] as const).map(final =>
      term.parser.registerCsiHandler({ prefix: '?', final }, params => {
        applyTerminalMode(terminalModeAfterPrivateControl(terminalModeRef.current, params, final === 'h'));
        if (params.some(value => typeof value === 'number' && [47, 1047, 1049].includes(value))) {
          alternateScreenRef.current = final === 'h';
          if (final === 'h' && !mobileBrowser && announcedGrid) {
            resizingForSharedGrid = true;
            term.resize(announcedGrid.cols, announcedGrid.rows);
            resizingForSharedGrid = false;
            scheduleFit();
          }
        }
        return false; // Continue xterm's own buffer switch.
      }),
    );
    const mobileBrowser = isMobileBrowserEnvironment();
    const wheelSender = createLatestTerminalWheelSender((data) => sendRef.current(JSON.stringify({ data })));
    let initialOutputFollow = true;
    let initialOutputFollowTimer: ReturnType<typeof setTimeout> | null = null;
    let cliViewportFollowTimer: ReturnType<typeof setTimeout> | null = null;
    let shellHistoryRestoreTimer: ReturnType<typeof setTimeout> | null = null;
    let userOwnsViewport = false;
    const handleTerminalWheel = (event: WheelEvent) => {
      userOwnsViewport = true;
      initialOutputFollow = false;
      if (initialOutputFollowTimer) clearTimeout(initialOutputFollowTimer);
      initialOutputFollowTimer = null;
      pendingCursorRevealRef.current = false;
      if (event.deltaY < 0) inputViewportFollowedRef.current = false;
      // A normal shell has a local xterm scrollback. Do not let tmux's mouse
      // protocol reach readline, where wheel reports become history-up/down.
      const alternate = terminalModeRef.current === 'cli' ||
        (terminalModeRef.current === 'unknown' && (alternateScreenRef.current || term.buffer.active.type === 'alternate'));
      return routeTerminalWheel(event, {
        scrollNotch: (lines) => {
          if (!alternate) {
            shellHistoryReaderActiveRef.current = true;
            // A peer can enlarge tmux beyond this panel's local height. That
            // makes the outer surface scrollable, but it is only blank grid
            // tail — using it for a Bash wheel scroll hides the local prompt.
            // Shell history belongs to xterm's normal buffer and its native
            // right-side scrollbar, never to the peer-grid overflow wrapper.
            loadShellHistoryForScroll(lines);
            return;
          }
          // Each report is a native mouse notch, not one text line. Repeating
          // it multiplies Claude's own scroll step and triggers acceleration.
          // Route footer wheels to the history region too.
          const bounds = term.element?.querySelector('.xterm-screen')?.getBoundingClientRect();
          if (!bounds) return;
          const { col, row } = getTerminalGridPosition(
            { x: event.clientX, y: bounds.top + bounds.height / 2 }, bounds, term.cols, term.rows,
          );
          wheelSender.notch(`\x1b[<${lines < 0 ? 64 : 65};${col};${row}M`);
          // A downwards CLI wheel returns toward the composer. Its shared grid
          // may be taller than this display, so reveal the actual xterm cursor
          // after the CLI has processed that page command. Do not do this for
          // upward history browsing: that would snap the user back to bottom.
          if (lines > 0 && !mobileBrowser) {
            const revealCliCursor = () => {
              const surface = ref.current;
              const screen = term.element?.querySelector<HTMLElement>('.xterm-screen');
              if (!surface || !screen || terminalModeRef.current !== 'cli') return;
              surface.scrollTop = localViewportRevealRow(surface.scrollTop, surface.clientHeight, surface.scrollHeight,
                screen.getBoundingClientRect().height / term.rows, term.buffer.active.cursorY);
            };
            requestAnimationFrame(revealCliCursor);
            if (cliViewportFollowTimer) clearTimeout(cliViewportFollowTimer);
            cliViewportFollowTimer = setTimeout(() => {
              cliViewportFollowTimer = null;
              revealCliCursor();
            }, 160);
          }
        },
      });
    };
    term.attachCustomWheelEventHandler(handleTerminalWheel);
    // Handle wheels on the complete panel, including the area below xterm's
    // last integral character row. Do not replay into another coordinate space.
    const handleSurfaceWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      if (!handleTerminalWheel(event)) event.stopImmediatePropagation();
    };
    const shellHistoryScrollDisposable = term.onScroll(() => {
      if (shellHistoryRestoreInFlightRef.current || terminalModeRef.current === 'cli') return;
      const storage = shellHistoryStorageRef.current;
      const key = shellHistoryStorageKeyRef.current;
      if (!storage || !key) return;
      const viewport = shellHistoryViewport(term);
      if (viewport) {
        shellHistoryReaderActiveRef.current = true;
        saveShellHistoryViewport(storage, key, viewport);
      }
    });

    // xterm's default touch handler emits key-like gestures, which makes a
    // phone swipe change the bash command history instead of scrolling. Map a
    // vertical swipe to local scrollback, or to the same rate-limited page
    // path used by Claude's alternate screen.
    let touchLastY: number | null = null;
    let touchRemainder = 0;
    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length === 1) {
        touchLastY = event.touches[0].clientY;
        touchRemainder = 0;
      }
    };
    const handleTouchMove = (event: TouchEvent) => {
      if (touchLastY === null || event.touches.length !== 1) return;
      const deltaY = touchLastY - event.touches[0].clientY;
      if (Math.abs(deltaY) < 4) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      touchRemainder += deltaY;
      touchLastY = event.touches[0].clientY;
      const alternate = terminalModeRef.current === 'cli' ||
        (terminalModeRef.current === 'unknown' && (alternateScreenRef.current || term.buffer.active.type === 'alternate'));
      while (Math.abs(touchRemainder) >= 24) {
        const direction = touchRemainder > 0 ? 1 : -1;
        touchRemainder -= direction * 24;
        if (alternate) {
          routeTerminalWheel(new WheelEvent('wheel', { cancelable: true, deltaY: direction * 120 }), {
            alternateScreen: true, state: wheelStateRef.current,
            sendPage: (page) => sendRef.current(JSON.stringify({ data: page === 'up' ? '\x1b[5~' : '\x1b[6~' })),
          });
        } else if (terminalModeRef.current === 'shell') {
          // Re-enter xterm's mouse protocol from a touch gesture; tmux then
          // applies the same copy-mode binding as a physical wheel.
          term.element?.dispatchEvent(new WheelEvent('wheel', {
            bubbles: true, cancelable: true, deltaY: direction * 120,
          }));
        } else {
          loadShellHistoryForScroll(direction * 3);
        }
      }
    };
    const handleTouchEnd = () => { touchLastY = null; touchRemainder = 0; };

    // Ctrl+C: send SIGINT (0x03)
    term.attachCustomKeyEventHandler((e) => {
      const passToTerminal = routeTerminalClipboardShortcut(e, {
        copy: () => { void copyCurrentSelection(); },
      });
      if (!passToTerminal) return false;

      const passControlToTerminal = routeTerminalControlShortcut(e, (data) => {
        sendRef.current(JSON.stringify({ data }));
      });
      if (!passControlToTerminal) return false;

      // Ctrl+F: search (existing behavior)
      if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        const searchInput = document.getElementById('xterm-search-input');
        if (searchInput) {
          searchInput.focus();
        } else {
          // Create a simple search bar overlay
          const container = term.element?.parentElement;
          if (!container) return true;
          const bar = document.createElement('div');
          bar.id = 'xterm-search-bar';
          bar.style.cssText = 'position:absolute;top:0;right:0;z-index:10;display:flex;gap:4px;padding:4px 8px;background:var(--c-bg-bar);border-radius:0 0 0 6px;';
          const input = document.createElement('input');
          input.id = 'xterm-search-input';
          input.style.cssText = 'width:160px;padding:2px 6px;border:1px solid var(--c-border);border-radius:3px;background:var(--c-bg-deep);color:var(--c-white);font-size:12px;outline:none;';
          input.placeholder = t('term_find_placeholder');

          input.onkeydown = (ke) => {
            if (ke.key === 'Escape') { bar.remove(); term.focus(); }
            if (ke.key === 'Enter') {
              if (ke.shiftKey) searchAddon.findPrevious(input.value);
              else searchAddon.findNext(input.value);
            }
          };

          input.oninput = () => {
            if (input.value) searchAddon.findNext(input.value);
          };

          bar.appendChild(input);
          container.appendChild(bar);
          input.focus();
        }
        return false;
      }
      return true;
    });

    // OSC 7 handler: track shell directory changes for SFTP sync
    term.parser.registerOscHandler(7, (data) => {
      // Format: file://hostname/path
      const match = /file:\/\/[^/]+(.+)/.exec(data);
      if (match && myTabId) {
        const decoded = (() => { try { return decodeURIComponent(match[1]); } catch { return match[1]; } })();
        setSftpCdPath(myTabId, decoded);
      }
      return false; // don't display in terminal
    });

    let resizingForSharedGrid = false;
    let sharedGrid: TerminalGrid | null = mobileBrowser ? null : (myTabId ? getSharedTerminalGrid(myTabId) : null);
    let pendingFitFrame: number | null = null;
    let widthFitFrame: number | null = null;
    let historyScrollbarFrame: number | null = null;
    let localWidthSettled = false;
    let announcedGrid: TerminalGrid | null = null;
    let fittedGridKey = '';
    let requestedGeometryKey = '';
    let viewportInitialized = false;
    let fittedTerminalMode: 'unknown' | 'shell' | 'cli' = 'unknown';
    let viewportFollowFrame: number | null = null;
    let viewportFollowTimer: ReturnType<typeof setTimeout> | null = null;
    const fontMeasure = document.createElement('canvas').getContext('2d');

    // xterm's scrollable element spans the whole panel, while a shared grid
    // can deliberately end before that panel does. Keep Bash's history rail
    // attached to the final rendered column instead of to the panel edge.
    // This must be an inline important rule: xterm may refresh its own rail
    // position after it paints a batch of output.
    const alignHistoryScrollbar = () => {
      if (mobileBrowser) return;
      const screen = term.element?.querySelector<HTMLElement>('.xterm-screen');
      const scrollbar = term.element?.querySelector<HTMLElement>('.scrollbar.vertical');
      const scrollable = scrollbar?.parentElement;
      if (!screen || !scrollbar || !scrollable) return;
      const screenRect = screen.getBoundingClientRect();
      const scrollableRect = scrollable.getBoundingClientRect();
      if (!screenRect.width || !scrollableRect.width) return;
      const left = `${Math.round(screenRect.right - scrollableRect.left + 2)}px`;
      if (scrollbar.style.left !== left) scrollbar.style.setProperty('left', left, 'important');
      if (scrollbar.style.right !== 'auto') scrollbar.style.setProperty('right', 'auto', 'important');
    };
    const scheduleHistoryScrollbarAlignment = () => {
      if (mobileBrowser || historyScrollbarFrame !== null) return;
      historyScrollbarFrame = requestAnimationFrame(() => {
        historyScrollbarFrame = null;
        alignHistoryScrollbar();
      });
    };
    const historyScrollbarDisposable = term.onRender(scheduleHistoryScrollbarAlignment);

    term.onResize(({ cols, rows }) => {
      if (cols < 2 || rows < 1) return; // ignore zero-size (hidden terminal)
      if (resizingForSharedGrid) return;
      if (!mobileBrowser) return; // Desktop geometry is negotiated explicitly below.
      // Changing font metrics can emit a delayed native-grid resize after the
      // adaptive fit has completed. Never let that transient event shrink the
      // PTY below the grid already announced by tmux.
      if (sharedGrid && (cols < sharedGrid.cols || rows < sharedGrid.rows)) return;
      sendRef.current(JSON.stringify({ cols, rows }));
      onResizeDimRef.current?.(cols, rows);
      inputViewportFollowedRef.current = false;
    });

    const fitWhenVisible = () => {
      if (!ref.current || ref.current.offsetWidth <= 0 || ref.current.offsetHeight <= 0) return;
      resizingForSharedGrid = true;
      try {
        if (!mobileBrowser && fontMeasure) {
          ref.current.classList.add('desktop-local-viewport');
          ref.current.style.overflow = 'auto';
          const style = getComputedStyle(ref.current);
          const width = ref.current.clientWidth - parseFloat(style.paddingLeft || '0') - parseFloat(style.paddingRight || '0');
          const height = ref.current.clientHeight - parseFloat(style.paddingTop || '0') - parseFloat(style.paddingBottom || '0');
          const dpr = window.devicePixelRatio || 1;
          const measure = (size: number) => {
            fontMeasure.font = `${size}px ${term.options.fontFamily}`;
            const metric = fontMeasure.measureText('W');
            return { width: metric.width, height: metric.fontBoundingBoxAscent + metric.fontBoundingBoxDescent };
          };
          const geometryKey = [width, height, dpr, fontSize, term.options.fontFamily, !!webglAddon, window.innerWidth].join(':');
          const fittedFont = localViewportFont(fontSize, width, dpr, measure, !!webglAddon);
          if (geometryKey !== requestedGeometryKey) {
            const metric = measure(fittedFont);
            const cellWidth = (webglAddon ? Math.floor(metric.width * dpr) : metric.width * dpr) / dpr;
            const cellHeight = Math.ceil(metric.height * dpr) / dpr;
            if (cellWidth > 0 && cellHeight > 0) {
              requestedGridRef.current = desktopRequestedGrid({ cols: Math.max(2, Math.min(1000, Math.floor((width - 2) / cellWidth))), rows: Math.max(1, Math.min(499, Math.floor((height - 1) / cellHeight))) });
              requestedGeometryKey = geometryKey;
              sendRef.current(JSON.stringify(requestedGridRef.current));
            }
          }
          const exactGrid = announcedGrid || requestedGridRef.current;
          if (!exactGrid) return;
          const key = [width, height, dpr, exactGrid.cols, exactGrid.rows, term.options.fontFamily, !!webglAddon, terminalModeRef.current, window.innerWidth < smallViewportWidth].join(':');
          // Re-entering the viewport or receiving the same title is not a
          // geometry change. Keep the already painted metrics untouched.
          if (key === fittedGridKey) return;
          // A local xterm scrollback has no outer-surface overflow, so an
          // outer scroll-position check would incorrectly classify an active
          // history reader as being at the input bottom. Once the user has
          // wheeled, never let a later fit/title callback snap the xterm
          // viewport back to its live prompt.
          const following = (!userOwnsViewport && !shellHistoryReaderActiveRef.current) || !viewportInitialized ||
            (terminalModeRef.current === 'cli' && fittedTerminalMode !== 'cli');
          term.resize(exactGrid.cols, exactGrid.rows);
          term.options.fontSize = fittedFont;
          term.options.letterSpacing = 0;
          term.options.lineHeight = 1;
          const metric = measure(fittedFont);
          const contentHeight = Math.round(exactGrid.rows * Math.ceil(metric.height * dpr) / dpr);
          const contentWidth = Math.round(exactGrid.cols * (webglAddon ? Math.floor(metric.width * dpr) : metric.width * dpr) / dpr);
          ref.current.classList.add('desktop-local-viewport');
          ref.current.style.overflow = 'auto';
          if (term.element) {
            const scrollableShell = terminalModeRef.current !== 'cli';
            term.element.style.height = `${scrollableShell ? Math.max(height, contentHeight) : height}px`;
            // xterm's internal viewport is absolutely positioned, so a height
            // alone can fail to contribute to the surface's scroll height.
            // Keep a Bash grid enlarged by a peer in the local scroll flow;
            // that preserves this display's font and exposes its history bar.
            term.element.style.minHeight = scrollableShell ? `${contentHeight}px` : '';
            term.element.style.width = `${Math.max(width, contentWidth)}px`;
          }
          viewportInitialized = true;
          fittedTerminalMode = terminalModeRef.current;
          if (following) {
            const follow = () => {
              const surface = ref.current;
              if (!surface) return;
              // Bash scrollback lives in xterm's normal buffer. The outer
              // surface may not gain height when a peer enlarges the shared
              // grid, so returning only that element to its old scrollTop can
              // still leave the prompt below xterm's internal viewport.
              if (terminalModeRef.current !== 'cli') term.scrollToBottom();
              surface.scrollTop = terminalModeRef.current === 'cli' ? surface.scrollHeight :
                localViewportRevealRow(surface.scrollTop, surface.clientHeight, surface.scrollHeight,
                  contentHeight / exactGrid.rows, term.buffer.active.cursorY);
            };
            follow();
            if (viewportFollowFrame !== null) cancelAnimationFrame(viewportFollowFrame);
            viewportFollowFrame = requestAnimationFrame(() => {
              viewportFollowFrame = null;
              follow();
            });
            // xterm commits the resized screen and its scroll height after the
            // resize callback. A peer display can increase this pane's shared
            // row count, so repeat after that commit before declaring an idle
            // Bash prompt visible in the local viewport.
            if (viewportFollowTimer !== null) clearTimeout(viewportFollowTimer);
            viewportFollowTimer = setTimeout(() => {
              viewportFollowTimer = null;
              follow();
            }, 80);
          }
          sharedGrid = exactGrid;
          if (myTabId) setSharedTerminalGrid(myTabId, sharedGrid);
          Object.assign(ref.current.dataset, { sharedCols: String(sharedGrid.cols), sharedRows: String(sharedGrid.rows), gridAuthority: 'server', fittedFontSize: String(fittedFont), fittedLineHeight: String(term.options.lineHeight) });
          fittedGridKey = key;
          return;
        }
        const currentScreen = term.element?.querySelector<HTMLElement>('.xterm-screen');
        if (currentScreen) currentScreen.style.transform = '';

        // Adapt to the browser viewport, not the largest attached monitor.
        const displayWidth = window.innerWidth;
        const useCappedViewportGrid = displayWidth < smallViewportWidth;
        const useSmallViewportBaseline = !mobileBrowser && useCappedViewportGrid;
        // Increase only the small client's base glyph size. Large displays
        // retain the production-native font metrics and scroll behavior.
        // Phones have a much shorter portrait width; keep a compact native
        // glyph while avoiding any transform/stretch of the terminal canvas.
        const responsiveFontSize = mobileBrowser ? Math.max(11, fontSize - 4) : useSmallViewportBaseline ? Math.max(fontSize, 16) : fontSize;
        // First measure how many cells this browser can show at the configured
        // font. Never accept a title smaller than that native grid: this lets a
        // newly attached larger browser grow the shared tmux window.
        term.options.fontSize = responsiveFontSize;
        term.options.letterSpacing = 0;
        term.options.lineHeight = 1;
        // fit() would temporarily shrink the alternate buffer and discard
        // bottom rows (including the CLI composer). Only measure here.
        const nativeGrid = fitAddon.proposeDimensions();
        if (!nativeGrid) return;
        // Raw pane ANSI coordinates must use the server's exact grid, even
        // on a large display with many small split panels.
        const targetGrid = useCappedViewportGrid
          ? (mobileBrowser ? mobileSharedTerminalGrid : sharedGridForViewport(sharedGrid || defaultSharedTerminalGrid, displayWidth))
          : (sharedGrid || nativeGrid);
        const screen = term.element?.querySelector<HTMLElement>('.xterm-screen');
        const nativeCellWidth = screen && term.cols > 0
          ? screen.getBoundingClientRect().width / term.cols
          : 1;
        let scaleOptions = calculateTerminalScale(nativeGrid, targetGrid, responsiveFontSize, nativeCellWidth);

        term.options.fontSize = scaleOptions.fontSize;
        term.options.letterSpacing = scaleOptions.letterSpacing;
        term.options.lineHeight = scaleOptions.lineHeight;

        // Font rasterisation can differ by a fraction of a pixel across DPRs.
        // Add a small correction only when xterm says the target would overflow.
        const proposed = fitAddon.proposeDimensions();
        if (proposed && (proposed.cols < targetGrid.cols || proposed.rows < targetGrid.rows)) {
          const correction = Math.min(proposed.cols / targetGrid.cols, proposed.rows / targetGrid.rows) * 0.995;
          scaleOptions = {
            ...scaleOptions,
            fontSize: Math.max(4, scaleOptions.fontSize * correction),
            letterSpacing: Math.max(0, scaleOptions.letterSpacing * correction),
            scale: scaleOptions.scale * correction,
          };
          term.options.fontSize = scaleOptions.fontSize;
          term.options.letterSpacing = scaleOptions.letterSpacing;
        }

        term.resize(targetGrid.cols, targetGrid.rows);
        if (useCappedViewportGrid) {
          // Width fitting above may reduce the font after lineHeight was
          // calculated. Re-measure the final native cell height; otherwise a
          // tall, narrow pane keeps only half its vertical character area.
          const fitted = fitAddon.proposeDimensions();
          if (fitted && fitted.rows > targetGrid.rows) {
            term.options.lineHeight *= fitted.rows / targetGrid.rows;
            // Keep the final row within the panel despite device-pixel rounding.
            const checked = fitAddon.proposeDimensions();
            if (checked && checked.rows < targetGrid.rows) {
              term.options.lineHeight *= checked.rows / targetGrid.rows;
            }
          }
          // proposeDimensions works in whole rows, while a compact three-row
          // layout can overflow by only a few device pixels. Correct against
          // the rendered screen rectangle so the last row/composer remains
          // above the panel boundary.
          const renderedHeight = screen?.getBoundingClientRect().height || 0;
          const availableHeight = ref.current.getBoundingClientRect().height;
          const constrained = constrainTerminalHeight(term.options.fontSize, term.options.lineHeight, renderedHeight, availableHeight);
          if (constrained.fontSize !== term.options.fontSize || constrained.lineHeight !== term.options.lineHeight) {
            const pixelCorrection = constrained.fontSize / term.options.fontSize;
            scaleOptions = { ...scaleOptions, fontSize: constrained.fontSize, lineHeight: constrained.lineHeight, scale: scaleOptions.scale * pixelCorrection };
            term.options.fontSize = constrained.fontSize;
            term.options.lineHeight = constrained.lineHeight;
          }
        }
        ref.current.dataset.nativeCols = String(nativeGrid.cols);
        ref.current.dataset.nativeRows = String(nativeGrid.rows);
        ref.current.dataset.sharedCols = String(targetGrid.cols);
        ref.current.dataset.sharedRows = String(targetGrid.rows);
        ref.current.dataset.terminalScale = scaleOptions.scale.toFixed(3);
        ref.current.dataset.screenScaleX = '1.000';
        ref.current.dataset.screenScaleY = '1.000';
        sharedGrid = targetGrid;
        if (myTabId) setSharedTerminalGrid(myTabId, targetGrid);

        sendRef.current(JSON.stringify({ cols: targetGrid.cols, rows: targetGrid.rows }));
        onResizeDimRef.current?.(targetGrid.cols, targetGrid.rows);
        inputViewportFollowedRef.current = false;

        if (!mobileBrowser) {
          if (widthFitFrame !== null) cancelAnimationFrame(widthFitFrame);
          // Wait for xterm's render frame before measuring the final glyphs.
          let passes = 0;
          const settleWidth = () => {
            widthFitFrame = requestAnimationFrame(() => {
              widthFitFrame = null;
              const screenRect = screen?.getBoundingClientRect();
              const scrollbar = term.element?.querySelector<HTMLElement>('.scrollbar.vertical')?.getBoundingClientRect();
              if (!screenRect || !scrollbar || !screenRect.width || !scrollbar.width) return;
              scheduleHistoryScrollbarAlignment();
              // xterm suspends painting offscreen panes. Their rectangle may
              // describe an old grid even though term.cols already changed.
              if (screenRect.top >= window.innerHeight || screenRect.bottom <= 0) return;
              const available = scrollbar.left - screenRect.left;
              const fit = fitTerminalColumns(available, screenRect.width, term.cols, term.options.letterSpacing || 0, window.devicePixelRatio);
              if (!fit) return;
              if (fit.cols === term.cols && fit.letterSpacing === term.options.letterSpacing) return;
              resizingForSharedGrid = true;
              try {
                term.options.letterSpacing = fit.letterSpacing;
                term.resize(fit.cols, targetGrid.rows);
                sharedGrid = { cols: fit.cols, rows: targetGrid.rows };
                localWidthSettled = true;
                if (myTabId) setSharedTerminalGrid(myTabId, sharedGrid);
                if (ref.current) ref.current.dataset.sharedCols = String(fit.cols);
                sendRef.current(JSON.stringify(sharedGrid));
                onResizeDimRef.current?.(fit.cols, targetGrid.rows);
              } finally { resizingForSharedGrid = false; }
              // Scrollbar geometry may change after resize (especially panes
              // returning from below the fold). Recheck the painted boundary.
              if (++passes < 4) widthFitFrame = requestAnimationFrame(settleWidth);
            });
          };
          widthFitFrame = requestAnimationFrame(settleWidth);
        }

      } finally {
        resizingForSharedGrid = false;
      }
    };

    const scheduleFit = () => {
      if (document.documentElement.dataset.layoutDragging === 'true') return;
      if (pendingFitFrame !== null) cancelAnimationFrame(pendingFitFrame);
      if (widthFitFrame !== null) cancelAnimationFrame(widthFitFrame);
      if (viewportFollowTimer !== null) clearTimeout(viewportFollowTimer);
      pendingFitFrame = requestAnimationFrame(() => {
        pendingFitFrame = null;
        fitWhenVisible();
      });
    };

    const titleDisposable = term.onTitleChange((title) => {
      const receivedGrid = parseSharedTerminalGridTitle(title);
      if (!receivedGrid) return;
      announcedGrid = receivedGrid;
      if (!mobileBrowser) {
        sharedGrid = receivedGrid;
        if (ref.current && ref.current.offsetWidth > 0 && ref.current.offsetHeight > 0) fitWhenVisible();
        else {
          resizingForSharedGrid = true;
          term.resize(receivedGrid.cols, receivedGrid.rows);
          resizingForSharedGrid = false;
        }
        return;
      }
      // This control client publishes its measured local grid. A title from
      // another display must not undo it and restart a resize feedback loop.
      if (!mobileBrowser && localWidthSettled) return;
      // The title is authoritative on roomy screens. A dense desktop layout
      // must retain its readable local cap when tmux echoes a grid announced
      // earlier by a larger client; fitWhenVisible sends the capped complete
      // grid back to this control client instead of silently restoring tiny
      // glyphs. Mobile uses the same grid for its native input canvas while
      // retaining the separately sized 12px wrapped reader.
      const nextGrid = mobileBrowser ? mobileSharedTerminalGrid : sharedGridForViewport(receivedGrid, window.innerWidth);
      if (sharedGrid?.cols === nextGrid.cols && sharedGrid.rows === nextGrid.rows) return;
      sharedGrid = nextGrid;
      // Resize during the OSC callback, before parsing the following snapshot.
      resizingForSharedGrid = true;
      term.resize(nextGrid.cols, nextGrid.rows);
      resizingForSharedGrid = false;
      if (myTabId) setSharedTerminalGrid(myTabId, nextGrid);
      scheduleFit();
    });

    const surfaceElement = ref.current;
    let webglAddon: WebglAddon | null = null;
    let webglSetupTimer: number | null = null;
    const rendererObservation = surfaceElement ? observeTerminalRenderer(surfaceElement) : null;
    if (surfaceElement) {
      surfaceElement.style.backgroundColor = themeConfig.background;
      term.open(surfaceElement);
      // Full-screen CLIs repaint the alternate buffer heavily. Prefer GPU
      // rendering, but install it only after the first paint. Constructing a
      // WebGL renderer can synchronously block the browser for hundreds of
      // milliseconds; doing that in the tab/panel click commit is what makes
      // an unrelated panel appear frozen or briefly white. The DOM renderer
      // is fully functional while the browser is busy and remains the
      // fallback when WebGL is unavailable.
      const installWebgl = () => {
        webglSetupTimer = null;
        if (!termRef.current || termRef.current !== term || webglAddon) return;
        try {
          webglAddon = new WebglAddon();
          term.loadAddon(webglAddon);
          rendererObservation?.webgl();
          webglAddon.onContextLoss(() => {
            webglAddon?.dispose();
            webglAddon = null;
            rendererObservation?.contextLost();
            scheduleFit();
          });
          scheduleFit();
        } catch (error) {
          console.warn('WebGL renderer unavailable; using xterm DOM renderer', error);
          webglAddon = null;
        }
      };
      if (typeof window.requestIdleCallback === 'function') {
        webglSetupTimer = window.requestIdleCallback(installWebgl, { timeout: 1200 });
      } else {
        webglSetupTimer = window.setTimeout(installWebgl, 80);
      }
      surfaceElement.addEventListener('touchstart', handleTouchStart, { passive: true, capture: true });
      surfaceElement.addEventListener('touchmove', handleTouchMove, { passive: false, capture: true });
      surfaceElement.addEventListener('touchend', handleTouchEnd, { passive: true, capture: true });
      surfaceElement.addEventListener('wheel', handleSurfaceWheel, { passive: false, capture: true });
      // xterm sizes its canvas to integral character cells.  Keep its viewport
      // itself stretched to the pane so the few remaining pixels (or a
      // transient pre-resize canvas) cannot reveal the page behind it.
      if (term.element) {
        term.element.style.width = '100%';
        term.element.style.height = '100%';
        term.element.style.backgroundColor = themeConfig.background;
      }
      termRef.current = term;
      const settleInitialOutputViewport = () => {
        initialOutputFollowTimer = null;
        if (!initialOutputFollow) return;
        if (!surfaceElement.classList.contains('desktop-local-viewport')) {
          initialOutputFollowTimer = setTimeout(settleInitialOutputViewport, 120);
          return;
        }
        const screen = term.element?.querySelector<HTMLElement>('.xterm-screen');
        if (screen) {
          surfaceElement.scrollTop = terminalModeRef.current === 'cli' ? surfaceElement.scrollHeight :
            localViewportRevealRow(surfaceElement.scrollTop, surfaceElement.clientHeight, surfaceElement.scrollHeight,
              screen.getBoundingClientRect().height / term.rows, term.buffer.active.cursorY);
        }
        initialOutputFollow = false;
      };
      const recordOutputBatch = (bytes: number) => {
        if (!surfaceElement) return;
        surfaceElement.dataset.outputBatches = String(Number(surfaceElement.dataset.outputBatches || 0) + 1);
        surfaceElement.dataset.lastOutputBytes = String(bytes);
        surfaceElement.dataset.lastOutputAt = performance.now().toFixed(3);
        // A bounded initial snapshot can finish after the first geometry fit.
        // Follow its final cursor once the burst settles, unless the user has
        // already taken ownership of history scrolling.
        if (initialOutputFollow && !mobileBrowser) {
          if (initialOutputFollowTimer) clearTimeout(initialOutputFollowTimer);
          initialOutputFollowTimer = setTimeout(settleInitialOutputViewport, 120);
        }
      };
      const pumpTerminalOutput = () => {
        if (outputWritePendingRef.current || outputQueueRef.current.length === 0) return;
        scheduleTerminalOutput(writeNextOutput);
      };
      const writeNextOutput = () => {
          const merged = takeTerminalOutput(outputQueueRef.current, 8 * 1024);
        if (merged.byteLength === 0) return;
        try {
          if (zsentryRef.current) {
            deliverTerminalBytes(term, zsentryRef.current, merged);
            recordOutputBatch(merged.byteLength);
            pumpTerminalOutput();
          } else {
            outputWritePendingRef.current = true;
            term.write(merged, () => {
              outputWritePendingRef.current = false;
              recordOutputBatch(merged.byteLength);
              pumpTerminalOutput();
            });
          }
        } catch (error) {
          outputWritePendingRef.current = false;
          console.warn('terminal output delivery:', error);
          pumpTerminalOutput();
        }
      };
      outputPumpRef.current = pumpTerminalOutput;
      pumpTerminalOutput();
      setTermKey((k) => k + 1);

      // Restore only a deliberate Bash history reader. A normal reload stays
      // cheap and receives the bounded visible screen as before; a saved
      // reader explicitly requests history and returns to its content anchor.
      if (shellHistoryRestoreRef.current) {
        shellHistoryRestoreTimer = setTimeout(() => {
          shellHistoryRestoreTimer = null;
          if (termRef.current !== term || terminalModeRef.current === 'cli' || term.buffer.active.type === 'alternate') return;
          loadShellHistoryForScroll(0);
        }, 350);
      }

      requestAnimationFrame(() => {
        scheduleFit();
        if (shouldAutoFocusTerminal(document.activeElement)) term.focus();
        // Retry focus after layout settles (important for split panes)
        setTimeout(() => {
          if (shouldAutoFocusTerminal(document.activeElement)) term.focus();
        }, 100);
      });
    }

    const resizeObserver = new ResizeObserver(() => {
      scheduleFit();
    });
    if (ref.current) resizeObserver.observe(ref.current);

    const visibilityObserver = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) scheduleFit();
    });
    if (ref.current) visibilityObserver.observe(ref.current);

    const handleResize = () => scheduleFit();
    window.addEventListener('resize', handleResize);
    window.addEventListener('webterm-layout-drag-end', handleResize);

    return () => {
      if (pendingFitFrame !== null) cancelAnimationFrame(pendingFitFrame);
      if (viewportFollowFrame !== null) cancelAnimationFrame(viewportFollowFrame);
      if (viewportFollowTimer !== null) clearTimeout(viewportFollowTimer);
      if (widthFitFrame !== null) cancelAnimationFrame(widthFitFrame);
      if (historyScrollbarFrame !== null) cancelAnimationFrame(historyScrollbarFrame);
      if (outputFrameRef.current !== null) cancelAnimationFrame(outputFrameRef.current);
      if (outputTimerRef.current !== null) clearTimeout(outputTimerRef.current);
      cancelTerminalOutput(outputPumpRef.current);
      if (webglSetupTimer !== null) {
        if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(webglSetupTimer);
        else clearTimeout(webglSetupTimer);
        webglSetupTimer = null;
      }
      if (initialOutputFollowTimer) clearTimeout(initialOutputFollowTimer);
      if (cliViewportFollowTimer) clearTimeout(cliViewportFollowTimer);
      if (shellHistoryRestoreTimer) clearTimeout(shellHistoryRestoreTimer);
      outputFrameRef.current = null;
      outputTimerRef.current = null;
      outputWritePendingRef.current = false;
      outputPumpRef.current = () => {};
      outputQueueRef.current = [];
      titleDisposable.dispose();
      historyScrollbarDisposable.dispose();
      shellHistoryScrollDisposable.dispose();
      modeDisposables.forEach(disposable => disposable.dispose());
      surfaceElement?.removeEventListener('touchstart', handleTouchStart, true);
      surfaceElement?.removeEventListener('touchmove', handleTouchMove, true);
      surfaceElement?.removeEventListener('touchend', handleTouchEnd, true);
      surfaceElement?.removeEventListener('wheel', handleSurfaceWheel, true);
      wheelSender.dispose();
      rendererObservation?.dispose();
      if (webglAddon) {
        try { webglAddon.dispose(); } catch { /* ignore */ }
        webglAddon = null;
      }
      term.dispose();
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('webterm-layout-drag-end', handleResize);
    };
  }, [connId, copyCurrentSelection, fontSize, loadShellHistoryForScroll, myTabId, panelNumber, pasteFromClipboard, setSftpCdPath, terminalID, themeName, workspaceIndex]);
  // Control Mode remains an opt-in diagnostic until the remote tmux stream is
  // proven to emit a complete redraw on every supported SSH implementation.
  // Control Mode provides per-client viewport state and deterministic replay
  // for both desktop and mobile. Keep an emergency opt-out for operators
  // during rollout, but make the tested transport the normal data plane.
  const terminalClientID = webSocketClientID();
  const createWsUrl = useCallback(() => websocketTicketURL(`/ws/ssh/${connId}`,
    { endpoint: 'ssh', connId, terminalId: terminalID, clientId: terminalClientID }, {
      terminal_id: terminalID,
      client_id: terminalClientID,
      ...(workspaceIndex && panelNumber ? { workspace_index: String(workspaceIndex), panel_number: String(panelNumber) } : {}),
      ...(localStorage.getItem('webterm-control-mode') === '0' ? {} : { control: '1' }),
    }), [connId, panelNumber, terminalClientID, terminalID, workspaceIndex]);

  const { send } = useWebSocket({
    createUrl: createWsUrl,
    onMessage: (data) => {
      const term = termRef.current;
      if (!term) return;
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'terminal_mode' && ['shell', 'cli', 'unknown'].includes(msg.mode)) {
          terminalModeRef.current = msg.mode;
          if (ref.current) ref.current.dataset.terminalMode = msg.mode;
          alternateScreenRef.current = msg.mode === 'cli';
        }
        if (msg.data) {
          let bytes: Uint8Array;
          if (msg.b64) {
            const bin = atob(msg.data);
            bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          } else {
            bytes = new TextEncoder().encode(msg.data);
          }
          if (suppressLateScreenSnapshotRef.current && isTerminalScreenSnapshot(bytes)) {
            suppressLateScreenSnapshotRef.current = false;
            return;
          }
          enqueueTerminalOutput(bytes);
        }
        if (msg.error) term.write(`\r\n\x1b[31m${msg.error}\x1b[0m\r\n`);
      } catch {
        enqueueTerminalOutput(new TextEncoder().encode(data));
      }
    },
    onClose: (final) => {
      onStatusRef.current?.(false);
      const currentStatus = useLayoutStore.getState().statusConn;
      if (currentStatus) setStatusConn({ ...currentStatus, connected: false });
      if (final) {
        termRef.current?.write('\r\n\x1b[33m[' + t('term_disconnected') + ']\x1b[0m\r\n');
      }
    },
    onOpen: (sendNow) => {
      // fit() may run before the socket is open. Always make the first frame
      // carry the real xterm grid so the backend never leaves tmux at the
      // fallback PTY size (especially after a layout or tab-title update).
      const term = termRef.current;
      if (term && term.cols > 1 && term.rows > 0) {
        sendNow(JSON.stringify(requestedGridRef.current || { cols: term.cols, rows: term.rows }));
      }
      sendNow(terminalActionMessage(followTerminalInputAction));
      inputViewportFollowedRef.current = true;
      onStatusRef.current?.(true);
      const conns = useConnectionStore.getState().connections;
      const conn = conns.find((connection) => connection.id === connId);
      if (conn && focusedPaneId) {
        setStatusConn({ name: conn.name, host: conn.host, connected: true });
      }
    },
  });

  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  const launchCodexScrollable = useCallback(() => {
    sendRef.current(terminalActionMessage(launchCodexScrollableAction));
    showClipboardNotice(t('term_history_codex_sent'));
    setHistoryHelpOpen(false);
    termRef.current?.focus();
  }, [showClipboardNotice]);

  const resumeTerminalInput = useCallback(() => {
    sendRef.current(terminalActionMessage(resumeTerminalInputAction));
    showClipboardNotice(t('term_history_resume_sent'));
    setHistoryHelpOpen(false);
    termRef.current?.focus();
  }, [showClipboardNotice]);

  const replayTerminalHistory = useCallback(async () => {
    const term = termRef.current;
    if (!term || !terminalID) return;
    try {
      const response = await fetch(`/api/terminal-history/${encodeURIComponent(connId)}?terminal_id=${encodeURIComponent(terminalID)}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
      });
      if (!response.ok) throw new Error(`history replay failed (${response.status})`);
      const payload = await response.json() as { data?: string; b64?: boolean };
      if (!payload.data) return;
      const binary = atob(payload.data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      term.reset();
      term.write(bytes);
      showClipboardNotice(t('term_history_replay_sent'));
      term.focus();
    } catch (error) {
      console.warn('terminal history replay:', error);
    }
  }, [connId, showClipboardNotice, terminalID]);

  const openClaudeTranscript = useCallback(() => {
    sendRef.current(terminalActionMessage(openClaudeTranscriptAction));
    showClipboardNotice(t('term_history_claude_transcript_sent'));
    setHistoryHelpOpen(false);
    termRef.current?.focus();
  }, [showClipboardNotice]);

  // ZMODEM (sz/rz) support
  useEffect(() => {
    const makeSentry = (): ZSentry => {
      const sentry = new Zmodem.Sentry({
        to_terminal: (octets: Octets) => {
          const term = termRef.current;
          if (!term) return;
          const bytes = octets instanceof Uint8Array ? octets : new Uint8Array(octets);
          try {
            const str = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
            term.write(highlightText(str, rulesRef.current));
          } catch {
            term.write(bytes);
          }
        },
        sender: (octets: Octets) => sendBinary(octets),
        on_detect: (detection: ZDetection) => {
          if (zsessionRef.current) {
            try { detection.deny(); } catch { /* remote session already ended */ }
            return;
          }
          try {
            const session = detection.confirm();
            zsessionRef.current = session;
            zmodemActiveRef.current = true;
            if (session.type === 'send') {
              // Upload is deliberately unavailable until the rz path has a real
              // SSH+lrzsz end-to-end gate. Abort instead of leaving rz hung.
              session.on('session_end', () => {
                zmodemActiveRef.current = false;
                zsessionRef.current = null;
                zsentryRef.current = makeSentry();
              });
              termRef.current?.write('\r\n\x1b[33m[ZMODEM] 上传暂不可用，请使用 SFTP / upload unavailable; use SFTP\x1b[0m\r\n');
              session.abort();
            } else {
              // Remote ran sz: download offered files
              session.on('offer', (transfer) => {
                if (!transfer) return;
                const xfer = transfer;
                xfer.accept()
                  .then(() => {
                    Zmodem.Browser.save_to_disk(xfer.get_payloads(), xfer.get_details().name);
                  })
                  .catch(() => { /* browser rejected download */ });
              });
              session.on('session_end', () => {
                zmodemActiveRef.current = false;
                zsessionRef.current = null;
                zsentryRef.current = makeSentry();
              });
              session.start();
            }
          } catch (e) {
            zmodemActiveRef.current = false;
            zsessionRef.current = null;
            termRef.current?.write(`\r\n\x1b[31mZMODEM: ${e}\x1b[0m\r\n`);
            zsentryRef.current = makeSentry();
          }
        },
        on_retract: () => {},
      });
      const typedSentry = sentry as ZSentry;
      zsentryRef.current = typedSentry;
      return typedSentry;
    };
    makeSentry();
    return () => {
      zsentryRef.current = null;
      zsessionRef.current = null;
      zmodemActiveRef.current = false;
    };
  }, [sendBinary]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    const disposable = term.onData((data) => {
      if (zmodemActiveRef.current) {
        sendTextAsBinary(data);
        return;
      }
      if (!inputViewportFollowedRef.current) {
        send(terminalActionMessage(followTerminalInputAction));
        inputViewportFollowedRef.current = true;
      }
      selectionSnapshotRef.current = '';
      send(JSON.stringify({ data }));
    });
    return () => disposable.dispose();
  }, [send, sendTextAsBinary, termKey]);

  const revealInputCursor = useCallback(() => {
    const surface = ref.current;
    const term = termRef.current;
    if (!surface?.classList.contains('desktop-local-viewport') || !term) return;
    term.scrollToBottom();
    const screen = term.element?.querySelector<HTMLElement>('.xterm-screen');
    if (!screen) return;
    surface.scrollTop = localViewportRevealRow(surface.scrollTop, surface.clientHeight, surface.scrollHeight,
      screen.getBoundingClientRect().height / term.rows, term.buffer.active.cursorY);
  }, []);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    let frame: number | undefined;
    const publishCursor = () => {
      const surface = ref.current;
      if (!surface) return;
      // A shared tmux grid can include tail rows that this client has not
      // painted yet. Publish xterm's own cursor for visual acceptance, rather
      // than conflating that server coordinate with the locally rendered one.
      surface.dataset.cursorRow = String(term.buffer.active.cursorY);
      surface.dataset.cursorBuffer = term.buffer.active.type;
    };
    publishCursor();
    const listener = term.onCursorMove(() => {
      publishCursor();
      if (!pendingCursorRevealRef.current || document.activeElement !== term.textarea || frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        if (pendingCursorRevealRef.current) revealInputCursor();
        pendingCursorRevealRef.current = false;
      });
    });
    return () => { listener.dispose(); if (frame !== undefined) cancelAnimationFrame(frame); };
  }, [termKey, revealInputCursor]);

  return (
    <div className="terminal-root" style={{ position: 'relative', flex: 1, display: 'flex', minWidth: 0, minHeight: 0, overflow: 'hidden', background: getTheme(themeName || 'XTerminal Green').background }}>
      <div ref={ref} className="terminal-surface" style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden', padding: '0 0 0 6px', background: getTheme(themeName || 'XTerminal Green').background }}
        onMouseDownCapture={handleSurfaceMouseDown}
        onMouseMoveCapture={handleSurfaceMouseMove}
        onMouseUpCapture={handleSurfaceMouseUp}
        onKeyDownCapture={(event) => {
          mouseStateRef.current.tmuxMenuActive = false;
          if (!shouldRevealTerminalInputCursor(event)) return;
          pendingCursorRevealRef.current = true;
          revealInputCursor();
        }}
        onContextMenuCapture={(e) => routeTerminalContextMenu(e, (position) => {
          contextSelectionRef.current = termRef.current?.getSelection() || selectionSnapshotRef.current;
          setContextMenu(position);
        })}
      />
      <MobileTerminalReader terminalRef={termRef} revision={termKey} fontSize={Math.max(11, fontSize - 4)}
        onHistory={(direction) => {
          const terminal = termRef.current;
          if (!terminal || terminal.buffer.active.type !== 'alternate') return;
          // Same native mouse protocol as desktop; never inject shell keys.
          const row = Math.max(1, Math.floor(terminal.rows / 2));
          sendRef.current(JSON.stringify({ data: `\x1b[<${direction === 'up' ? 64 : 65};1;${row}M` }));
        }} />
      <button type="button" aria-label={t('term_history_title')} title={t('term_history_title')}
        onClick={() => setHistoryHelpOpen((open) => !open)} style={{
          position: 'absolute', top: 5, right: 11, zIndex: 12,
          padding: '2px 6px', border: '1px solid var(--c-border)', borderRadius: 4,
          background: colors.bgInput, color: colors.textMuted, cursor: 'pointer',
          fontSize: 10, lineHeight: 1.4, opacity: historyHelpOpen ? 1 : 0.72,
        }}>{t('term_history')}</button>
      {historyHelpOpen && (
        <TerminalHistoryHelp onClose={() => {
          setHistoryHelpOpen(false);
          termRef.current?.focus();
        }} onLaunchCodexScrollable={launchCodexScrollable}
          onResumeInput={resumeTerminalInput}
          onReplayHistory={() => { void replayTerminalHistory(); }}
          onOpenClaudeTranscript={openClaudeTranscript}
          onSelectCopy={() => {
            setHistoryHelpOpen(false);
            setSelectionCopyMode(true);
          }}
          onCopySelection={() => { void copyCurrentSelection(); }}
          onPaste={() => { void pasteFromClipboard(); }} />
      )}
      {clipboardNotice && (
        <div role="status" style={{
          position: 'absolute', right: 14, bottom: 14, zIndex: 1001,
          padding: '7px 11px', borderRadius: 5, border: '1px solid var(--c-border)',
          background: colors.bgInput, color: colors.text, fontSize: 12,
          boxShadow: '0 4px 18px rgba(0,0,0,0.45)', pointerEvents: 'none',
        }}>{clipboardNotice}</div>
      )}
      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y}
          items={[
            {
              label: t('term_copy'),
              action: async () => {
                const result = await copyTerminalText(contextSelectionRef.current, navigator.clipboard);
                showClipboardNotice(result === 'ok' ? t('term_copied') : result === 'empty' ? t('term_copy_empty') : t('term_copy_failed'));
                termRef.current?.focus();
              },
            },
            {
              label: t('term_paste'),
              action: pasteFromClipboard,
            },
            {
              label: t('term_find'),
              action: () => {
                const input = document.getElementById('xterm-search-input') as HTMLInputElement;
                if (input) {
                  input.focus();
                  input.select();
                } else {
                  termRef.current?.focus();
                  const ctrlF = new KeyboardEvent('keydown', { ctrlKey: true, key: 'f', code: 'KeyF', bubbles: true });
                  termRef.current?.element?.dispatchEvent(ctrlF);
                }
              },
            },
            {
              label: t('term_clear'),
              action: () => {
                const term = termRef.current;
                if (!term) return;
                clearTerminalHistory(() => term.clear(), sendRef.current);
                term.focus();
              },
            },
            {
              label: t('term_history_title'),
              action: () => setHistoryHelpOpen(true),
            },
            {
              label: t('term_history_resume_input'),
              action: resumeTerminalInput,
            },
            {
              label: t('term_history_codex_launch'),
              action: launchCodexScrollable,
            },
            ...(extraMenuItems || []),
          ]}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
