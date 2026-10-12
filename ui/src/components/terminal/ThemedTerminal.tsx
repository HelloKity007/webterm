import { t } from '../../i18n';
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebglAddon } from '@xterm/addon-webgl';
import { websocketTicketURL, webSocketClientID } from '../../api/wsTicket';
import { apiPost } from '../../api/client';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useLayoutStore } from '../../store/layout';
import { useConnectionStore } from '../../store/connections';
import { usePreferencesStore } from '../../store/preferences';
import '@xterm/xterm/css/xterm.css';
import { getTheme } from '../../themes/presets';
import ContextMenu from '../common/ContextMenu';
import { colors } from '../../theme/tokens';
import TerminalHistoryHelp from './TerminalHistoryHelp';
import CliHistoryResume from './CliHistoryResume';
import { useCliHistoryResume } from './useCliHistoryResume';
import MobileTerminalReader from './MobileTerminalReader';
import { terminalModeAfterPrivateControl } from './terminalMode';
import { localTerminalFont, localViewportRevealRow } from './localViewport';
import { createDesktopTerminalViewport, desktopCapacity, type DesktopTerminalViewport } from './desktopTerminalViewport';
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
  createTerminalWheelNotchGate,
  terminalActionMessage,
  terminalScrollbackLines,
  type TerminalWheelNotchGate,
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
import { calculateTerminalScale, constrainTerminalHeight, desktopRequestedGrid, mobileSharedTerminalGrid, parseSharedTerminalGridTitle, smallViewportWidth, type TerminalGrid } from './terminalScaling';
import { getSharedTerminalGrid, setSharedTerminalGrid } from './terminalGridCache';
import { createAutomaticTerminalGeometry, type AutomaticTerminalGeometry } from './automaticTerminalGeometry';
import { createTerminalReplayGeometry } from './terminalReplayGeometry';
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
  onDismissUnverified?: () => void;
  onCreateSafeTerminal?: () => Promise<void>;
  onReplaceUnrecoverableTerminal?: () => Promise<void>;
  onIdentityGuardChange?: (guarded: boolean) => void;
}

function safeSessionStorage(): Storage | null {
  try { return window.sessionStorage; } catch { return null; }
}

function terminalHistoryUserID(): string {
  try { return String(JSON.parse(localStorage.getItem('webterm-user') || '{}').id || 'anonymous'); } catch { return 'anonymous'; }
}

function shellHistoryViewport(term: Terminal, outerTop?: number): ShellHistoryViewport | null {
  const buffer = term.buffer.active;
  if (buffer.type !== 'normal' || buffer.baseY < 1 || buffer.viewportY >= buffer.baseY) return null;
  const start = buffer.viewportY;
  let anchor = '';
  let anchorOffset = 0;
  for (let row = start; row <= Math.min(buffer.baseY, start + term.rows - 1); row++) {
    const text = buffer.getLine(row)?.translateToString(true) || '';
    if (text) { anchor = text; anchorOffset = row - start; break; }
  }
  // Start at the viewport's exact first row rather than the first non-empty
  // line. This makes the saved position an unambiguous visible text block
  // even when the first meaningful row is a repeated separator or prompt.
  const anchorContext = Array.from(
    { length: Math.min(6, Math.max(1, term.rows), Math.max(1, buffer.length - start)) },
    (_, offset) => buffer.getLine(start + offset)?.translateToString(true) || '',
  );
  return {
    anchor,
    anchorOffset,
    anchorContext,
    fromBottom: buffer.baseY - start,
    baseY: buffer.baseY,
    rows: term.rows,
    cols: term.cols,
    // Retain the local panel offset as well as xterm's position. A split
    // display can have a taller shared server grid than this particular pane.
    ...(typeof outerTop === 'number' && Number.isFinite(outerTop) && outerTop >= 0 ? { outerTop } : {}),
    savedAt: Date.now(),
  };
}

function restoreShellHistoryViewport(term: Terminal, snapshot: ShellHistoryViewport, surface?: HTMLElement | null) {
  const buffer = term.buffer.active;
  const lines: string[] = [];
  for (let row = 0; row <= buffer.baseY; row++) lines.push(buffer.getLine(row)?.translateToString(true) || '');
  term.scrollToLine(restoredHistoryLine(snapshot, lines, buffer.baseY));
  if (surface && surface.dataset.scrollOwner !== 'surface' && typeof snapshot.outerTop === 'number') {
    // Clamp only after the current layout has a measurable scroll height.
    // Reapplying at the normal restore checkpoints handles a delayed shared
    // grid resize without snapping a history reader to the local top.
    const max = Math.max(0, surface.scrollHeight - surface.clientHeight);
    surface.scrollTop = Math.min(snapshot.outerTop, max);
  }
}

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

function terminalGridAnnouncement(bytes: Uint8Array): Uint8Array | null {
  const prefix = '\x1b]2;webterm-grid:';
  if (bytes.length < prefix.length) return null;
  for (let index = 0; index < prefix.length; index++) {
    if (bytes[index] !== prefix.charCodeAt(index)) return null;
  }
  const terminator = bytes.indexOf(0x07, prefix.length);
  return terminator < 0 ? null : bytes.subarray(0, terminator + 1);
}

export default function ThemedTerminal({ connId, onStatus, onResizeDim, extraMenuItems, myTabId, workspaceIndex, panelNumber, onDismissUnverified, onCreateSafeTerminal, onReplaceUnrecoverableTerminal, onIdentityGuardChange }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const desktopViewportRef = useRef<DesktopTerminalViewport | null>(null);
  const [termKey, setTermKey] = useState(0);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [clipboardNotice, setClipboardNotice] = useState('');
  const [identityFault, setIdentityFault] = useState<string | null>(null);
  const [faultDetail, setFaultDetail] = useState<{ message: string; observedAt?: string; environment?: string } | null>(null);
  const [identityRevision, setIdentityRevision] = useState(0);
  const [recoveryPhase, setRecoveryPhase] = useState<'idle' | 'recovering' | 'replacing' | 'failed'>('idle');
  const [historyHelpOpen, setHistoryHelpOpen] = useState(false);
  const recoveryAttemptRef = useRef(0);
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recoveryReplaceFiredRef = useRef(false);
  const identityGuardChangeRef = useRef(onIdentityGuardChange);
  useEffect(() => { identityGuardChangeRef.current = onIdentityGuardChange; }, [onIdentityGuardChange]);
  useEffect(() => {
    const notify = identityGuardChangeRef.current;
    notify?.(identityFault !== null);
    return () => { notify?.(false); };
  }, [identityFault]);
  const [showHistoryResume, setShowHistoryResume] = useCliHistoryResume(
    JSON.stringify([terminalHistoryUserID(), connId, myTabId || '', workspaceIndex || 0, panelNumber || 0]),
  );
  const [, setSelectionCopyArmed] = useState(false);
  const contextSelectionRef = useRef('');
  const mouseStateRef = useRef(createTerminalMouseState());
  const wheelStateRef = useRef(createTerminalWheelState());
  const wheelNotchGateRef = useRef<TerminalWheelNotchGate | null>(null);
  const terminalModeRef = useRef<'unknown' | 'shell' | 'cli'>('unknown');
  const modeFitRef = useRef<() => void>(() => {});
  const alternateScreenRef = useRef(false);
  const selectionCopyArmedRef = useRef(false);
  const selectionAnchorRef = useRef<{ col: number; row: number } | null>(null);
  const pendingLeftGestureRef = useRef<PendingLeftGesture | null>(null);
  const globalSelectionCleanupRef = useRef<(() => void) | null>(null);
  const globalSelectionMoveRef = useRef<(event: MouseEvent) => void>(() => {});
  const globalSelectionUpRef = useRef<(event: MouseEvent) => void>(() => {});
  const selectionSnapshotRef = useRef('');
  const clipboardNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const outputQueueRef = useRef<Uint8Array[]>([]);
  const outputQueueBytesRef = useRef(0);
  const outputQueuePeakRef = useRef(0);
  const outputFrameRef = useRef<number | null>(null);
  const outputTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const outputWritePendingRef = useRef(false);
  const outputPumpRef = useRef<() => void>(() => {});
  const outputScheduledJobRef = useRef<() => void>(() => {});
  const sendRef = useRef<(data: string) => void>(() => {});
  const requestedGridRef = useRef<TerminalGrid | null>(null);
  const automaticGeometryRef = useRef<AutomaticTerminalGeometry | null>(null);
  const geometryConnectedRef = useRef(false);
  const inputViewportFollowedRef = useRef(false);
  const pendingCursorRevealRef = useRef(false);
  const shellHistoryLoadedRef = useRef(false);
  const shellHistoryLoadingRef = useRef(false);
  const pendingShellHistoryScrollRef = useRef(0);
  const pendingShellHistoryUserScrollRef = useRef(false);
  const shellHistoryUserScrollRef = useRef(false);
  const suppressLateScreenSnapshotRef = useRef(false);
  const deferredScreenSnapshotRef = useRef<Uint8Array | null>(null);
  // A reconnect's HTTP capture is the authoritative, atomic shell image. Do
  // not let the control stream's pre-capture prompt or screen redraw write
  // concurrently with its chunked xterm replay. Grid titles remain useful
  // before the replay, but their pixel payload is deliberately discarded.
  const suppressHistoryReplayOutputRef = useRef(false);
  const shellHistoryRestoreRef = useRef<ShellHistoryViewport | null>(null);
  // Keep the reader's content anchor beyond the initial HTTP restore. A
  // reconnect can announce another tmux grid after that restore; xterm then
  // reflows the normal buffer and otherwise preserves only its old distance
  // from the bottom, visibly moving the reader to a different history block.
  const shellHistoryAnchorRef = useRef<ShellHistoryViewport | null>(null);
  const shellHistoryStorageRef = useRef<Storage | null>(null);
  const shellHistoryStorageKeyRef = useRef<string | null>(null);
  const shellHistoryReaderActiveRef = useRef(false);
  const shellHistoryRestoreInFlightRef = useRef(false);
  // History text is logical (tmux -J) and xterm reflows it to the active
  // grid.  Hold the grid recorded with a persisted reader through the replay
  // itself; otherwise a first-paint 103-column measurement followed by the
  // settled 104-column measurement can alter one wrapped row before the
  // restore code gets a chance to anchor it.
  const historyReplayGridLockRef = useRef<TerminalGrid | null>(null);
  const replayGeometryRef = useRef<ReturnType<typeof createTerminalReplayGeometry> | null>(null);
  const onStatusRef = useRef(onStatus);
  const onResizeDimRef = useRef(onResizeDim);
  const themeName = usePreferencesStore((s) => s.themeName);
  const fontSize = usePreferencesStore((s) => s.fontSize);
  const setSftpCdPath = useLayoutStore((s) => s.setSftpCdPath);
  const setStatusConn = useLayoutStore((s) => s.setStatusConn);
  const focusedPaneId = useLayoutStore((s) => s.focusedPaneId);

  const enqueueTerminalOutput = useCallback((bytes: Uint8Array) => {
    outputQueueRef.current.push(bytes);
    outputQueueBytesRef.current += bytes.byteLength;
    outputQueuePeakRef.current = Math.max(outputQueuePeakRef.current, outputQueueBytesRef.current);
    const surface = ref.current;
    if (surface) {
      surface.dataset.outputQueueBytes = String(outputQueueBytesRef.current);
      surface.dataset.outputQueuePeakBytes = String(outputQueuePeakRef.current);
    }
    outputPumpRef.current();
  }, []);

  useEffect(() => {
    const geometry = createTerminalReplayGeometry(enqueueTerminalOutput);
    replayGeometryRef.current = geometry;
    return () => {
      geometry.reset();
      if (replayGeometryRef.current === geometry) replayGeometryRef.current = null;
    };
  }, [enqueueTerminalOutput]);

  const waitForTerminalOutputIdle = useCallback(async () => {
    // The normal output pump writes asynchronously. Draining it before reset
    // prevents a previously queued prompt from completing halfway through a
    // direct history write and corrupting a logical capture line.
    for (let attempt = 0; attempt < 60; attempt++) {
      if (!outputWritePendingRef.current && outputQueueRef.current.length === 0) return;
      outputPumpRef.current();
      await new Promise<void>(resolve => setTimeout(resolve, 8));
    }
  }, []);

  useEffect(() => {
    onStatusRef.current = onStatus;
    onResizeDimRef.current = onResizeDim;
  }, [onResizeDim, onStatus]);

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

  const terminalID = myTabId || '';
  const loadShellHistoryForScroll = useCallback((lines: number, userInitiated = false) => {
    const term = termRef.current;
    if (!term) return;
    if (userInitiated) pendingShellHistoryUserScrollRef.current = true;
    const restore = shellHistoryRestoreRef.current;
    // A reload may already have received one visible screen. That is not a
    // complete history buffer, so a saved reader position must still fetch
    // the explicit bounded capture instead of accepting that screen as final.
    if (restore && shellHistoryLoadedRef.current) {
      restoreShellHistoryViewport(term, restore, ref.current);
      shellHistoryRestoreRef.current = null;
      shellHistoryAnchorRef.current = restore;
      shellHistoryReaderActiveRef.current = true;
      // Keep the scroll listener guarded until after this current paint. A
      // scrollToLine emits xterm's scroll event synchronously.
      requestAnimationFrame(() => {
        if (termRef.current === term && shellHistoryRestoreRef.current === null) {
          restoreShellHistoryViewport(term, restore, ref.current);
          shellHistoryRestoreInFlightRef.current = false;
        }
      });
      return;
    }
    // A buffer with a scrollback base is already complete for this client.
    // Do not make a control-plane request on every ordinary wheel event.
    if (!restore && (shellHistoryLoadedRef.current || term.buffer.active.baseY > 0)) {
      shellHistoryUserScrollRef.current = userInitiated;
      if (desktopViewportRef.current) desktopViewportRef.current.scrollLines(lines);
      else term.scrollLines(lines);
      if (userInitiated) requestAnimationFrame(() => { shellHistoryUserScrollRef.current = false; });
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
          shellHistoryAnchorRef.current = null;
          const storage = shellHistoryStorageRef.current;
          const key = shellHistoryStorageKeyRef.current;
          if (storage && key) clearShellHistoryViewport(storage, key);
          if (desktopViewportRef.current) { desktopViewportRef.current.revealCursor(); return; }
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
        await waitForTerminalOutputIdle();
        const replayRestore = shellHistoryRestoreRef.current;
        const replayGrid = replayRestore?.cols && replayRestore?.rows
          ? { cols: replayRestore.cols, rows: replayRestore.rows }
          : null;
        if (replayGrid) {
          historyReplayGridLockRef.current = replayGrid;
          // A reset is immediately followed by the logical-line replay, so
          // resizing here cannot disturb a visible reader. It makes the
          // parser's width deterministic before the first capture byte.
          if (term.cols !== replayGrid.cols || term.rows !== replayGrid.rows) {
            term.resize(replayGrid.cols, replayGrid.rows);
          }
        }
        // This path follows an intentional wheel-up. It is never called by a
        // tab switch, so even a busy 20,000-line pane cannot visually replay
        // while the user is merely changing tabs.
        // Preserve the actual grid used to parse a history replay in the
        // surface diagnostics.  The grid can be negotiated asynchronously on
        // a reconnect, and a one-row difference at replay time reflows a
        // wrapped capture even when the settled grid looks identical later.
        // These are intentionally metrics only; they never participate in
        // restore decisions.
        if (ref.current) {
          ref.current.dataset.historyReplayGridBefore = `${term.cols}x${term.rows}`;
          ref.current.dataset.historyReplayBaseBefore = String(term.buffer.active.baseY);
        }
        term.reset();
        // Use the same bounded write size as the live socket pump. A tmux
        // history capture can be megabytes long; one giant xterm write causes
        // renderer starvation and makes the first visible history frame look
        // like overlapping text on some WebGL paths.
        for (let offset = 0; offset < bytes.length; offset += 16 * 1024) {
          await new Promise<void>((resolve) => term.write(bytes.subarray(offset, offset + 16 * 1024), resolve));
        }
        if (ref.current) {
          ref.current.dataset.historyReplayGridAfter = `${term.cols}x${term.rows}`;
          ref.current.dataset.historyReplayBaseAfter = String(term.buffer.active.baseY);
        }
        shellHistoryLoadedRef.current = true;
        // The history capture already includes the latest screen. A snapshot
        // held while it was in flight must not be replayed after reset().
        deferredScreenSnapshotRef.current = null;
        term.scrollToBottom();
        const requestedScroll = pendingShellHistoryScrollRef.current;
        const pendingRestore = shellHistoryRestoreRef.current;
        if (pendingRestore) {
          restoreShellHistoryViewport(term, pendingRestore, ref.current);
          shellHistoryRestoreRef.current = null;
          shellHistoryAnchorRef.current = pendingRestore;
          shellHistoryReaderActiveRef.current = true;
        } else {
          shellHistoryUserScrollRef.current = pendingShellHistoryUserScrollRef.current;
          term.scrollLines(requestedScroll);
          requestAnimationFrame(() => { shellHistoryUserScrollRef.current = false; });
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
            restoreShellHistoryViewport(term, pendingRestore, ref.current);
            shellHistoryRestoreInFlightRef.current = false;
          } else if (!shellHistoryReaderActiveRef.current) {
            term.scrollLines(requestedScroll);
          }
          // Replay temporarily held the saved reader grid. Apply the latest
          // received metadata through the normal anchor-preserving resize
          // path, even if the remote pane stays completely quiet afterwards.
          suppressLateScreenSnapshotRef.current = false;
          suppressHistoryReplayOutputRef.current = false;
          deferredScreenSnapshotRef.current = null;
          historyReplayGridLockRef.current = null;
          replayGeometryRef.current?.release();
        }, 350);
      } catch (error) {
        historyReplayGridLockRef.current = null;
        suppressHistoryReplayOutputRef.current = false;
        suppressLateScreenSnapshotRef.current = false;
        const deferred = deferredScreenSnapshotRef.current;
        deferredScreenSnapshotRef.current = null;
        if (deferred) enqueueTerminalOutput(deferred);
        console.warn('terminal history capture:', error);
      } finally {
        pendingShellHistoryScrollRef.current = 0;
        pendingShellHistoryUserScrollRef.current = false;
        shellHistoryLoadingRef.current = false;
        if (!historyReplayGridLockRef.current) replayGeometryRef.current?.release();
      }
    })();
  }, [connId, enqueueTerminalOutput, panelNumber, terminalID, waitForTerminalOutputIdle, workspaceIndex]);

  useEffect(() => {
    const themeConfig = getTheme(themeName || 'XTerminal Green');
    // A recreated xterm starts from the visible remote screen again. Treat
    // that as a fresh client viewport so a later wheel can request tmux
    // history instead of assuming a discarded local buffer still exists.
    shellHistoryLoadedRef.current = false;
    replayGeometryRef.current?.reset();
    shellHistoryLoadingRef.current = false;
    pendingShellHistoryScrollRef.current = 0;
    pendingShellHistoryUserScrollRef.current = false;
    shellHistoryUserScrollRef.current = false;
    suppressLateScreenSnapshotRef.current = false;
    deferredScreenSnapshotRef.current = null;
    shellHistoryReaderActiveRef.current = false;
    shellHistoryStorageRef.current = safeSessionStorage();
    const userID = terminalHistoryUserID();
    shellHistoryStorageKeyRef.current = shellHistoryViewportKey(userID, connId, terminalID, workspaceIndex, panelNumber);
    shellHistoryRestoreRef.current = shellHistoryStorageRef.current && shellHistoryStorageKeyRef.current
      ? loadShellHistoryViewport(shellHistoryStorageRef.current, shellHistoryStorageKeyRef.current)
      : null;
    // Hold the initial bounded screen from the moment a persisted reader is
    // known, rather than waiting for the delayed history request to start.
    suppressLateScreenSnapshotRef.current = shellHistoryRestoreRef.current !== null;
    suppressHistoryReplayOutputRef.current = shellHistoryRestoreRef.current !== null;
    shellHistoryAnchorRef.current = shellHistoryRestoreRef.current;
    shellHistoryRestoreInFlightRef.current = shellHistoryRestoreRef.current !== null;
    historyReplayGridLockRef.current = null;
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
      const changed = terminalModeRef.current !== mode;
      terminalModeRef.current = mode;
      if (ref.current) ref.current.dataset.terminalMode = mode;
      if (changed) modeFitRef.current();
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
    const geometrySurface = ref.current;
    const automaticGeometry = mobileBrowser ? null : createAutomaticTerminalGeometry(
      message => sendRef.current(message),
      () => {
        if (!geometrySurface || !document.hasFocus() || document.visibilityState !== 'visible') return false;
        const rect = geometrySurface.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
      },
    );
    automaticGeometryRef.current = automaticGeometry;
    if (geometryConnectedRef.current) automaticGeometry?.connect();
    const activateGeometry = () => automaticGeometry?.activate();
    const deactivateGeometry = () => automaticGeometry?.deactivate();
    const geometryVisibility = () => {
      if (document.visibilityState === 'visible') activateGeometry();
      else deactivateGeometry();
    };
    const geometryPanel = geometrySurface?.closest('.terminal-grid-cell') || geometrySurface;
    geometryPanel?.addEventListener('pointerdown', activateGeometry, true);
    geometryPanel?.addEventListener('keydown', activateGeometry, true);
    window.addEventListener('focus', activateGeometry);
    window.addEventListener('blur', deactivateGeometry);
    document.addEventListener('visibilitychange', geometryVisibility);
    const wheelSender = createLatestTerminalWheelSender((data) => sendRef.current(JSON.stringify({ data })));
    wheelNotchGateRef.current = createTerminalWheelNotchGate();
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
      // A reconnect snapshot replays pixels without ?1049h, so xterm's own
      // buffer/mouse state can lag the remote truth for a CLI session. The
      // backend terminal_mode probe is authoritative: trust it over xterm's
      // post-snapshot heuristics, or every CLI wheel lands in the local
      // shell-history scrollback instead of the remote program.
      const alternate = terminalModeRef.current === 'cli' ||
        term.buffer.active.type === 'alternate' ||
        (terminalModeRef.current !== 'shell' && term.modes.mouseTrackingMode !== 'none');
      return routeTerminalWheel(event, {
        // Both the CLI SGR path and the shell-history path must share the
        // gesture gate; an ungated momentum stream scrolls a Bash panel
        // straight to the top of its local buffer.
        notchGate: wheelNotchGateRef.current || undefined,
        scrollNotch: (lines) => {
          if (!alternate) {
            shellHistoryReaderActiveRef.current = true;
            // A peer can enlarge tmux beyond this panel's local height. That
            // makes the outer surface scrollable, but it is only blank grid
            // tail — using it for a Bash wheel scroll hides the local prompt.
            // Shell history belongs to xterm's normal buffer and its native
            // right-side scrollbar, never to the peer-grid overflow wrapper.
            loadShellHistoryForScroll(lines, true);
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
          if (lines < 0 && terminalModeRef.current === 'cli') setShowHistoryResume(true);
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
              if (desktopViewportRef.current) { desktopViewportRef.current.revealCursor(); return; }
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
      const viewport = shellHistoryViewport(term, ref.current?.scrollTop);
      if (viewport) {
        shellHistoryReaderActiveRef.current = true;
        // Only a real local scroll may redefine the reader anchor. xterm also
        // emits onScroll for a late output batch, a tmux resize and automatic
        // scroll anchoring; accepting those would replace the saved outer
        // panel offset with a layout artifact (for example 228px) after a
        // native reload.
        if (shellHistoryUserScrollRef.current) {
          shellHistoryAnchorRef.current = viewport;
          saveShellHistoryViewport(storage, key, viewport);
        }
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
          loadShellHistoryForScroll(direction * 3, true);
        }
      }
    };
    const handleTouchEnd = () => { touchLastY = null; touchRemainder = 0; };

    // Ctrl+C: send SIGINT (0x03)
    term.attachCustomKeyEventHandler((e) => {
      // Keep browser reload and modifier-only events out of xterm's key path;
      // returning false leaves the browser's default shortcut intact.
      if (!shouldRevealTerminalInputCursor(e)) {
        pendingCursorRevealRef.current = false;
        return false;
      }
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
    let announcedGrid: TerminalGrid | null = null;
    let fittedGridKey = '';
    let requestedGeometryKey = '';
    let historyAnchorRestoreFrame: number | null = null;
    let historyAnchorRestoreTimer: ReturnType<typeof setTimeout> | null = null;

    const prepareHistoryAnchorForGeometry = () => {
      const anchor = shellHistoryAnchorRef.current;
      if (!anchor || terminalModeRef.current === 'cli' || term.buffer.active.type !== 'normal') return false;
      // term.resize can synchronously emit xterm scroll events. Suppress those
      // reflow positions so they cannot overwrite the content anchor before
      // it has been reapplied.
      shellHistoryRestoreInFlightRef.current = true;
      return true;
    };
    const restoreHistoryAnchorAfterGeometry = () => {
      if (!prepareHistoryAnchorForGeometry()) return;
      const restore = () => {
        const anchor = shellHistoryAnchorRef.current;
        if (!anchor || termRef.current !== term || terminalModeRef.current === 'cli' || term.buffer.active.type !== 'normal') return;
        restoreShellHistoryViewport(term, anchor, ref.current);
      };
      if (historyAnchorRestoreFrame !== null) cancelAnimationFrame(historyAnchorRestoreFrame);
      historyAnchorRestoreFrame = requestAnimationFrame(() => {
        historyAnchorRestoreFrame = null;
        restore();
      });
      // xterm commits its reflowed rows after the resize callback on some
      // renderers. The settled pass keeps a reconnect's late 35->22->35 grid
      // transition anchored to the same content rather than its old bottom
      // offset.
      if (historyAnchorRestoreTimer !== null) clearTimeout(historyAnchorRestoreTimer);
      historyAnchorRestoreTimer = setTimeout(() => {
        historyAnchorRestoreTimer = null;
        restore();
        shellHistoryRestoreInFlightRef.current = false;
      }, 120);
    };

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
        if (!mobileBrowser) {
          const surface = ref.current;
          surface.classList.add('desktop-local-viewport');
          surface.style.overflow = 'auto';
          const style = getComputedStyle(surface);
          const width = surface.clientWidth - parseFloat(style.paddingLeft || '0') - parseFloat(style.paddingRight || '0');
          const height = surface.clientHeight;
          if (term.options.fontSize !== localTerminalFont(fontSize)) term.options.fontSize = localTerminalFont(fontSize);
          if (term.options.letterSpacing !== 0) term.options.letterSpacing = 0;
          if (term.options.lineHeight !== 1) term.options.lineHeight = 1;
          const screen = term.element?.querySelector<HTMLElement>('.xterm-screen');
          const rect = screen?.getBoundingClientRect();
          if (!rect || rect.width <= 0 || rect.height <= 0) return;
          const cellWidth = rect.width / term.cols;
          const cellHeight = rect.height / term.rows;
          const localGrid = desktopRequestedGrid(desktopCapacity(width, height, cellWidth, cellHeight));
          const geometryKey = [localGrid.cols, localGrid.rows, fontSize, window.devicePixelRatio, !!webglAddon].join(':');
          if (geometryKey !== requestedGeometryKey) {
            requestedGridRef.current = localGrid;
            Object.assign(surface.dataset, { requestedCols: String(localGrid.cols), requestedRows: String(localGrid.rows) });
            requestedGeometryKey = geometryKey;
            automaticGeometry?.update(localGrid);
          }
          const historyOwned = terminalModeRef.current !== 'cli' &&
            (shellHistoryReaderActiveRef.current || shellHistoryRestoreInFlightRef.current);
          const exactGrid = historyReplayGridLockRef.current || announcedGrid || localGrid;
          const key = [geometryKey, exactGrid.cols, exactGrid.rows, width, height, !!announcedGrid].join(':');
          if (key === fittedGridKey) return;
          if (historyOwned) prepareHistoryAnchorForGeometry();
          term.resize(exactGrid.cols, exactGrid.rows);
          if (term.element) term.element.style.width = `${Math.max(width, exactGrid.cols * cellWidth)}px`;
          desktopViewportRef.current?.refresh();
          if (historyOwned) restoreHistoryAnchorAfterGeometry();
          else if (!userOwnsViewport) desktopViewportRef.current?.revealCursor();
          sharedGrid = exactGrid;
          onResizeDimRef.current?.(exactGrid.cols, exactGrid.rows);
          if (myTabId) setSharedTerminalGrid(myTabId, sharedGrid);
          Object.assign(surface.dataset, {
            sharedCols: String(exactGrid.cols), sharedRows: String(exactGrid.rows),
            gridAuthority: announcedGrid ? 'server' : 'pending', fittedFontSize: String(term.options.fontSize),
            fittedLineHeight: '1', nativeCols: String(localGrid.cols), nativeRows: String(localGrid.rows),
          });
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
        // A phone's wrapped reader is local, but ANSI cursor coordinates still
        // belong to the one remote grid. Never parse a desktop frame at 69x21.
        const targetGrid = announcedGrid || mobileSharedTerminalGrid;
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

        const historyOwned = terminalModeRef.current !== 'cli' &&
          (shellHistoryReaderActiveRef.current || shellHistoryRestoreInFlightRef.current);
        if (historyOwned) prepareHistoryAnchorForGeometry();
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
        if (historyOwned) restoreHistoryAnchorAfterGeometry();

        requestedGridRef.current = mobileSharedTerminalGrid;
        sendRef.current(JSON.stringify(mobileSharedTerminalGrid));
        onResizeDimRef.current?.(targetGrid.cols, targetGrid.rows);
        inputViewportFollowedRef.current = false;


      } finally {
        resizingForSharedGrid = false;
      }
    };

    const scheduleFit = () => {
      if (document.documentElement.dataset.layoutDragging === 'true') return;
      if (pendingFitFrame !== null) cancelAnimationFrame(pendingFitFrame);
      pendingFitFrame = requestAnimationFrame(() => {
        pendingFitFrame = null;
        fitWhenVisible();
      });
    };
    modeFitRef.current = scheduleFit;
    // Font loading and renderer fallback can commit cell metrics after resize.
    // Re-measure after paint; unchanged capacity is deduplicated above.
    const renderedGeometry = term.onRender(() => { if (!mobileBrowser) scheduleFit(); });

    const titleDisposable = term.onTitleChange((title) => {
      const receivedGrid = parseSharedTerminalGridTitle(title);
      if (receivedGrid) automaticGeometry?.observe(receivedGrid);
      if (!receivedGrid) return;
      announcedGrid = receivedGrid;
      if (!mobileBrowser) {
        sharedGrid = receivedGrid;
        if (ref.current && ref.current.offsetWidth > 0 && ref.current.offsetHeight > 0) fitWhenVisible();
        else {
          resizingForSharedGrid = true;
          const historyOwned = terminalModeRef.current !== 'cli' &&
            (shellHistoryReaderActiveRef.current || shellHistoryRestoreInFlightRef.current);
          if (historyOwned) prepareHistoryAnchorForGeometry();
          term.resize(receivedGrid.cols, receivedGrid.rows);
          resizingForSharedGrid = false;
          if (historyOwned) restoreHistoryAnchorAfterGeometry();
        }
        return;
      }
      // Mobile rendering uses the exact server grid; its wrapped reader keeps
      // its independent readable font and does not renegotiate peer geometry.
      const nextGrid = receivedGrid;
      if (sharedGrid?.cols === nextGrid.cols && sharedGrid.rows === nextGrid.rows) return;
      sharedGrid = nextGrid;
      // Resize during the OSC callback, before parsing the following snapshot.
      resizingForSharedGrid = true;
      const historyOwned = terminalModeRef.current !== 'cli' &&
        (shellHistoryReaderActiveRef.current || shellHistoryRestoreInFlightRef.current);
      if (historyOwned) prepareHistoryAnchorForGeometry();
      term.resize(nextGrid.cols, nextGrid.rows);
      resizingForSharedGrid = false;
      if (myTabId) setSharedTerminalGrid(myTabId, nextGrid);
      if (historyOwned) restoreHistoryAnchorAfterGeometry();
      scheduleFit();
    });

    const surfaceElement = ref.current;
    let webglAddon: WebglAddon | null = null;
    let webglSetupTimer: number | null = null;
    const rendererObservation = surfaceElement ? observeTerminalRenderer(surfaceElement) : null;
    const recoverWebgl = () => {
      const lostAddon = webglAddon;
      if (!lostAddon) return;
      webglAddon = null;
      lostAddon.dispose();
      rendererObservation?.contextLost();
      scheduleFit();
    };
    const handleWebglContextLost = (event: Event) => {
      // The addon waits 3 seconds before onContextLoss. During that grace period
      // its canvas is unusable. Capture the owned canvas event immediately and
      // restore DOM rendering before the next paint, without remounting xterm.
      if (!(event.target instanceof HTMLCanvasElement) || !webglAddon) return;
      event.preventDefault();
      recoverWebgl();
    };
    if (surfaceElement) {
      surfaceElement.style.backgroundColor = themeConfig.background;
      term.open(surfaceElement);
      surfaceElement.addEventListener('webglcontextlost', handleWebglContextLost, true);
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
          webglAddon.onContextLoss(recoverWebgl);
          scheduleFit();
        } catch (error) {
          console.warn('WebGL renderer unavailable; using xterm DOM renderer', error);
          webglAddon = null;
        } finally {
          surfaceElement.dataset.rendererReady = 'true';
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
      if (!mobileBrowser) desktopViewportRef.current = createDesktopTerminalViewport(term, surfaceElement, () => {
        userOwnsViewport = true;
        shellHistoryUserScrollRef.current = true;
        requestAnimationFrame(() => { shellHistoryUserScrollRef.current = false; });
      });
      const settleInitialOutputViewport = () => {
        initialOutputFollowTimer = null;
        if (!initialOutputFollow || (terminalModeRef.current !== 'cli' &&
          (shellHistoryReaderActiveRef.current || shellHistoryRestoreInFlightRef.current))) return;
        if (!surfaceElement.classList.contains('desktop-local-viewport')) {
          initialOutputFollowTimer = setTimeout(settleInitialOutputViewport, 120);
          return;
        }
        const screen = term.element?.querySelector<HTMLElement>('.xterm-screen');
        if (screen) {
          if (desktopViewportRef.current) desktopViewportRef.current.revealCursor();
          else surfaceElement.scrollTop = terminalModeRef.current === 'cli' ? surfaceElement.scrollHeight :
            localViewportRevealRow(surfaceElement.scrollTop, surfaceElement.clientHeight, surfaceElement.scrollHeight,
              screen.getBoundingClientRect().height / term.rows, term.buffer.active.cursorY);
        }
        initialOutputFollow = false;
      };
      const recordOutputBatch = (bytes: number, writeMs?: number) => {
        if (!surfaceElement) return;
        surfaceElement.dataset.outputBatches = String(Number(surfaceElement.dataset.outputBatches || 0) + 1);
        surfaceElement.dataset.lastOutputBytes = String(bytes);
        surfaceElement.dataset.lastOutputAt = performance.now().toFixed(3);
        if (writeMs !== undefined) {
          surfaceElement.dataset.lastOutputWriteMs = writeMs.toFixed(3);
          surfaceElement.dataset.peakOutputWriteMs = Math.max(Number(surfaceElement.dataset.peakOutputWriteMs || 0), writeMs).toFixed(3);
        }
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
        outputQueueBytesRef.current = Math.max(0, outputQueueBytesRef.current - merged.byteLength);
        if (ref.current) ref.current.dataset.outputQueueBytes = String(outputQueueBytesRef.current);
        try {
          outputWritePendingRef.current = true;
          const started = performance.now();
          term.write(merged, () => {
            outputWritePendingRef.current = false;
            recordOutputBatch(merged.byteLength, performance.now() - started);
            pumpTerminalOutput();
          });
        } catch (error) {
          outputWritePendingRef.current = false;
          console.warn('terminal output delivery:', error);
          pumpTerminalOutput();
        }
      };
      outputScheduledJobRef.current = writeNextOutput;
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
      if (entries.some(entry => entry.isIntersecting)) {
        scheduleFit();
        activateGeometry();
      } else deactivateGeometry();
    });
    if (ref.current) visibilityObserver.observe(ref.current);

    const handleResize = () => scheduleFit();
    window.addEventListener('resize', handleResize);
    window.addEventListener('webterm-layout-drag-end', handleResize);

    return () => {
      automaticGeometry?.disconnect();
      if (automaticGeometryRef.current === automaticGeometry) automaticGeometryRef.current = null;
      geometryPanel?.removeEventListener('pointerdown', activateGeometry, true);
      geometryPanel?.removeEventListener('keydown', activateGeometry, true);
      window.removeEventListener('focus', activateGeometry);
      window.removeEventListener('blur', deactivateGeometry);
      document.removeEventListener('visibilitychange', geometryVisibility);
      modeFitRef.current = () => {};
      if (pendingFitFrame !== null) cancelAnimationFrame(pendingFitFrame);
      if (historyAnchorRestoreFrame !== null) cancelAnimationFrame(historyAnchorRestoreFrame);
      if (historyAnchorRestoreTimer !== null) clearTimeout(historyAnchorRestoreTimer);
      if (outputFrameRef.current !== null) cancelAnimationFrame(outputFrameRef.current);
      if (outputTimerRef.current !== null) clearTimeout(outputTimerRef.current);
      cancelTerminalOutput(outputScheduledJobRef.current);
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
      outputScheduledJobRef.current = () => {};
      outputQueueRef.current = [];
      outputQueueBytesRef.current = 0;
      outputQueuePeakRef.current = 0;
      replayGeometryRef.current?.reset();
      titleDisposable.dispose();
      renderedGeometry.dispose();
      desktopViewportRef.current?.dispose();
      desktopViewportRef.current = null;
      shellHistoryScrollDisposable.dispose();
      modeDisposables.forEach(disposable => disposable.dispose());
      surfaceElement?.removeEventListener('touchstart', handleTouchStart, true);
      surfaceElement?.removeEventListener('touchmove', handleTouchMove, true);
      surfaceElement?.removeEventListener('touchend', handleTouchEnd, true);
      surfaceElement?.removeEventListener('wheel', handleSurfaceWheel, true);
      surfaceElement?.removeEventListener('webglcontextlost', handleWebglContextLost, true);
      wheelSender.dispose();
      wheelNotchGateRef.current = null;
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
  }, [connId, copyCurrentSelection, fontSize, loadShellHistoryForScroll, myTabId, panelNumber, pasteFromClipboard, setSftpCdPath, setShowHistoryResume, terminalID, themeName, workspaceIndex]);
  // Control Mode remains an opt-in diagnostic until the remote tmux stream is
  // proven to emit a complete redraw on every supported SSH implementation.
  // Control Mode provides per-client viewport state and deterministic replay
  // for both desktop and mobile. Keep an emergency opt-out for operators
  // during rollout, but make the tested transport the normal data plane.
  const terminalClientID = webSocketClientID();
  const createWsUrl = useCallback(() => {
    // Deliberately read this local revision: an explicit legacy-adoption
    // acknowledgement must replace the rejected WebSocket with a new ticket.
    void identityRevision;
    return websocketTicketURL(`/ws/ssh/${connId}`,
    { endpoint: 'ssh', connId, terminalId: terminalID, clientId: terminalClientID }, {
      terminal_id: terminalID,
      client_id: terminalClientID,
      ...(workspaceIndex && panelNumber ? { workspace_index: String(workspaceIndex), panel_number: String(panelNumber) } : {}),
      // Identity verification is a control-mode protocol requirement. Do not
      // leave a browser-local compatibility preference able to bypass it.
      control: '1',
    });
  }, [connId, identityRevision, panelNumber, terminalClientID, terminalID, workspaceIndex]);

  const { send, status: terminalStatus } = useWebSocket({
    createUrl: createWsUrl,
    onMessage: (data) => {
      const term = termRef.current;
      if (!term) return;
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'terminal_mode' && ['shell', 'cli', 'unknown'].includes(msg.mode)) {
          setIdentityFault(null);
          const changed = terminalModeRef.current !== msg.mode;
          terminalModeRef.current = msg.mode;
          if (ref.current) ref.current.dataset.terminalMode = msg.mode;
          alternateScreenRef.current = msg.mode === 'cli';
          if (changed) modeFitRef.current();
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
          const screenSnapshot = isTerminalScreenSnapshot(bytes);
          if (screenSnapshot && (suppressLateScreenSnapshotRef.current || shellHistoryLoadingRef.current || shellHistoryReaderActiveRef.current)) {
            // Retain only its authoritative geometry. Its captured pixels are
            // superseded by the explicit history response and must never be
            // allowed to overlap a chunked replay.
            const grid = terminalGridAnnouncement(bytes);
            if (grid) replayGeometryRef.current?.receive(grid,
              shellHistoryLoadingRef.current || historyReplayGridLockRef.current !== null);
            deferredScreenSnapshotRef.current = bytes;
            suppressLateScreenSnapshotRef.current = false;
            return;
          }
          if (suppressHistoryReplayOutputRef.current || shellHistoryLoadingRef.current) {
            // A fresh HTTP capture includes all terminal state up to its
            // server-side capture point. Keeping the pre-capture control
            // stream would either duplicate the prompt or race its direct
            // xterm writes. Hold only the latest geometry during parsing;
            // metadata must survive even when its pixels are discarded.
            const grid = terminalGridAnnouncement(bytes);
            if (grid) replayGeometryRef.current?.receive(grid,
              shellHistoryLoadingRef.current || historyReplayGridLockRef.current !== null);
            return;
          }
          enqueueTerminalOutput(bytes);
        }
        if (msg.error) {
          const automaticTestRecovery = msg.environment === 'release-test' && ['TERMINAL_IDENTITY_UNAVAILABLE', 'TERMINAL_IDENTITY_MISMATCH'].includes(msg.code);
          if (msg.code === 'TERMINAL_IDENTITY_UNAVAILABLE' && !automaticTestRecovery) setIdentityFault('unregistered');
          else if (automaticTestRecovery || (typeof msg.code === 'string' && ['TERMINAL_IDENTITY_TIMEOUT', 'TERMINAL_SERVER_UNAVAILABLE', 'TERMINAL_SESSION_MISSING', 'TERMINAL_BACKEND_UNREACHABLE', 'TERMINAL_ATTACH_FAILED'].includes(msg.code))) {
            setIdentityFault(msg.code);
            setFaultDetail({ message: msg.error, observedAt: msg.observed_at, environment: msg.environment });
          }
          term.write(`\r\n\x1b[31m${msg.error}\x1b[0m\r\n`);
        }
      } catch {
        enqueueTerminalOutput(new TextEncoder().encode(data));
      }
    },
    onClose: (final) => {
      geometryConnectedRef.current = false;
      automaticGeometryRef.current?.disconnect();
      onStatusRef.current?.(false);
      const currentStatus = useLayoutStore.getState().statusConn;
      if (currentStatus) setStatusConn({ ...currentStatus, connected: false });
      if (final) {
        termRef.current?.write('\r\n\x1b[33m[' + t('term_disconnected') + ']\x1b[0m\r\n');
      }
    },
    onOpen: (sendNow) => {
      geometryConnectedRef.current = true;
      // fit() may run before the socket is open. Always make the first frame
      // carry the real xterm grid so the backend never leaves tmux at the
      // fallback PTY size (especially after a layout or tab-title update).
      const term = termRef.current;
      if (term && term.cols > 1 && term.rows > 0) {
        sendNow(JSON.stringify(requestedGridRef.current || { cols: term.cols, rows: term.rows }));
      }
      automaticGeometryRef.current?.connect();
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

  useEffect(() => {
    const autoRecoverable = identityFault === 'TERMINAL_SESSION_MISSING' || identityFault === 'TERMINAL_SERVER_UNAVAILABLE' || (faultDetail?.environment === 'release-test' && (identityFault === 'TERMINAL_IDENTITY_MISMATCH' || identityFault === 'TERMINAL_IDENTITY_UNAVAILABLE'));
    if (terminalStatus !== 'terminal-failed' || !autoRecoverable || recoveryReplaceFiredRef.current) return;
    if (recoveryPhase === 'idle') recoveryAttemptRef.current = 0;
    if (recoveryTimerRef.current) return;
    if (recoveryAttemptRef.current < 3) {
      const delay = 1000 * (recoveryAttemptRef.current + 1);
      recoveryAttemptRef.current++;
      recoveryTimerRef.current = setTimeout(() => {
        recoveryTimerRef.current = null;
        setRecoveryPhase('recovering');
        setIdentityRevision((revision) => revision + 1);
      }, delay);
      return () => {
        if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current);
        recoveryTimerRef.current = null;
      };
    }
    if (!onReplaceUnrecoverableTerminal) {
      queueMicrotask(() => {
        setRecoveryPhase('failed');
        termRef.current?.write(`\\r\\n\\x1b[31m[${t('term_recovery_failed')}]\\x1b[0m\\r\\n`);
      });
      return;
    }
    recoveryReplaceFiredRef.current = true;
    queueMicrotask(() => setRecoveryPhase('replacing'));
    void onReplaceUnrecoverableTerminal().catch((error) => {
      console.error('Failed to replace unrecoverable terminal:', error);
      setRecoveryPhase('failed');
      termRef.current?.write(`\\r\\n\\x1b[31m[${t('term_recovery_failed')}]\\x1b[0m\\r\\n`);
    });
    return () => {
      if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current);
      recoveryTimerRef.current = null;
    };
  }, [faultDetail?.environment, identityFault, onReplaceUnrecoverableTerminal, recoveryPhase, terminalStatus]);

  const adoptLegacyTerminal = useCallback(async () => {
    if (!terminalID || !workspaceIndex || !panelNumber) return;
    setIdentityFault('adopting');
    try {
      await apiPost(`/api/terminal-sessions/${encodeURIComponent(connId)}/adopt`, {
        terminal_id: terminalID,
        workspace_index: workspaceIndex,
        panel_number: panelNumber,
      });
      setIdentityFault(null);
      setIdentityRevision((revision) => revision + 1);
    } catch (error) {
      console.error('Failed to adopt existing terminal session:', error);
      setIdentityFault('adoption-failed');
    }
  }, [connId, panelNumber, terminalID, workspaceIndex]);

  const createSafeTerminal = useCallback(async () => {
    if (!onCreateSafeTerminal) return;
    setIdentityFault('creating');
    try {
      await onCreateSafeTerminal();
    } catch (error) {
      console.error('Failed to create a replacement terminal after identity rejection:', error);
      setIdentityFault('creation-failed');
    }
  }, [onCreateSafeTerminal]);

  const launchCodexScrollable = useCallback(() => {
    sendRef.current(terminalActionMessage(launchCodexScrollableAction));
    showClipboardNotice(t('term_history_codex_sent'));
    setHistoryHelpOpen(false);
    termRef.current?.focus();
  }, [showClipboardNotice]);

  const resumeTerminalInput = useCallback(() => {
    setShowHistoryResume(false);
    sendRef.current(terminalActionMessage(resumeTerminalInputAction));
    showClipboardNotice(t('term_history_resume_sent'));
    setHistoryHelpOpen(false);
    termRef.current?.focus();
  }, [showClipboardNotice, setShowHistoryResume]);

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

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    const disposable = term.onData((data) => {
      setShowHistoryResume(false);
      if (!inputViewportFollowedRef.current) {
        send(terminalActionMessage(followTerminalInputAction));
        inputViewportFollowedRef.current = true;
      }
      selectionSnapshotRef.current = '';
      send(JSON.stringify({ data }));
    });
    return () => disposable.dispose();
  }, [send, setShowHistoryResume, termKey]);

  const revealInputCursor = useCallback(() => {
    const surface = ref.current;
    const term = termRef.current;
    if (!surface?.classList.contains('desktop-local-viewport') || !term) return;
    if (desktopViewportRef.current) { desktopViewportRef.current.revealCursor(); return; }
    term.scrollToBottom();
    const screen = term.element?.querySelector<HTMLElement>('.xterm-screen');
    if (!screen) return;
    surface.scrollTop = localViewportRevealRow(surface.scrollTop, surface.clientHeight, surface.scrollHeight,
      screen.getBoundingClientRect().height / term.rows, term.buffer.active.cursorY);
  }, []);

  const takeSizeControl = useCallback(() => {
    const requested = requestedGridRef.current;
    if (!requested) return;
    sendRef.current(JSON.stringify(requested));
    sendRef.current(JSON.stringify({ action: 'take_size_control' }));
    termRef.current?.focus();
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
          if (!shouldRevealTerminalInputCursor(event)) {
            pendingCursorRevealRef.current = false;
            return;
          }
          pendingCursorRevealRef.current = true;
          revealInputCursor();
        }}
        onContextMenuCapture={(e) => routeTerminalContextMenu(e, (position) => {
          contextSelectionRef.current = termRef.current?.getSelection() || selectionSnapshotRef.current;
          setContextMenu(position);
        })}
      />
      <CliHistoryResume terminalRef={termRef} surfaceRef={ref} active={showHistoryResume} revision={termKey} onResume={resumeTerminalInput} />
      {identityFault && !(['TERMINAL_SESSION_MISSING', 'TERMINAL_SERVER_UNAVAILABLE', 'TERMINAL_IDENTITY_MISMATCH', 'TERMINAL_IDENTITY_UNAVAILABLE'].includes(identityFault) && (faultDetail?.environment === 'release-test' || identityFault === 'TERMINAL_SESSION_MISSING' || identityFault === 'TERMINAL_SERVER_UNAVAILABLE')) && recoveryPhase !== 'recovering' && recoveryPhase !== 'replacing' && (
        <div role="alert" style={{ position: 'absolute', inset: 0, zIndex: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18, background: 'rgba(12,16,24,.80)' }}>
          <div style={{ maxWidth: 410, padding: 16, border: '1px solid var(--c-border)', borderRadius: 7, background: colors.bgRaised, color: colors.text, boxShadow: '0 12px 36px rgba(0,0,0,.48)' }}>
            <div style={{ fontWeight: 650, marginBottom: 7 }}>{identityFault === 'TERMINAL_SERVER_UNAVAILABLE' ? '终端服务不可达' : identityFault === 'TERMINAL_SESSION_MISSING' ? '原终端会话已结束' : identityFault === 'TERMINAL_IDENTITY_TIMEOUT' ? '终端连接验证超时' : identityFault === 'TERMINAL_BACKEND_UNREACHABLE' || identityFault === 'TERMINAL_ATTACH_FAILED' ? '终端连接暂时不可用' : '终端会话未通过身份校验'}</div>
            <div style={{ color: colors.textMuted, fontSize: 12, lineHeight: 1.55 }}>{faultDetail?.message || '为避免误连到新的 Bash，会话已保持只读且未发送任何输入。'}</div>
            {faultDetail?.observedAt && <div style={{ marginTop: 7, color: colors.textMuted, fontSize: 12 }}>检测时间：{new Date(faultDetail.observedAt).toLocaleString()}</div>}
            {(identityFault === 'unregistered' || identityFault === 'adopting') && workspaceIndex && panelNumber && (
              <button type="button" disabled={identityFault === 'adopting'} onClick={() => { void adoptLegacyTerminal(); }} style={{ marginTop: 12, padding: '6px 10px', border: '1px solid var(--c-accent)', borderRadius: 4, background: colors.accentFaint, color: colors.accent, cursor: identityFault === 'adopting' ? 'wait' : 'pointer' }}>
                {identityFault === 'adopting' ? '正在验证已有会话…' : '验证并迁移已有会话'}
              </button>
            )}
            {identityFault === 'adoption-failed' && <div style={{ marginTop: 10, color: colors.dangerBright, fontSize: 12 }}>未找到可安全迁移的旧会话；可移除该 Panel，或明确新建独立 Panel。原会话不会被创建、替换或清理。</div>}
            {identityFault === 'creation-failed' && <div style={{ marginTop: 10, color: colors.dangerBright, fontSize: 12 }}>新建安全 Panel 失败；原会话及当前 Panel 均未被修改。</div>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
              <button type="button" onClick={() => { setFaultDetail(null); setIdentityFault(null); setIdentityRevision(value => value + 1); }} style={{ padding: '6px 10px', border: `1px solid ${colors.border}`, borderRadius: 4, background: colors.bg, color: colors.text, cursor: 'pointer' }}>重新检查原会话</button>
              {onDismissUnverified && <button type="button" onClick={onDismissUnverified} style={{ padding: '6px 10px', border: `1px solid ${colors.border}`, borderRadius: 4, background: colors.bg, color: colors.text, cursor: 'pointer' }}>从布局移除（保留远端会话）</button>}
              {onCreateSafeTerminal && <button type="button" disabled={identityFault === 'creating'} onClick={() => { void createSafeTerminal(); }} style={{ padding: '6px 10px', border: '1px solid var(--c-accent)', borderRadius: 4, background: colors.accentFaint, color: colors.accent, cursor: identityFault === 'creating' ? 'wait' : 'pointer' }}>{identityFault === 'creating' ? '正在新建安全 Panel…' : '新建独立终端（不恢复原进程）'}</button>}
            </div>
          </div>
        </div>
      )}
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
            {
              label: t('term_fit_window_title'),
              action: takeSizeControl,
            },
            ...(extraMenuItems || []),
          ]}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
