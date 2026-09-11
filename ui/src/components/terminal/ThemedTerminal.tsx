import { t } from '../../i18n';
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebglAddon } from '@xterm/addon-webgl';
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
import {
  createTerminalWheelState,
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
} from './terminalInteractions';
import { calculateTerminalScale, defaultSharedTerminalGrid, parseSharedTerminalGridTitle, smallViewportWidth, type TerminalGrid } from './terminalScaling';
import { getSharedTerminalGrid, setSharedTerminalGrid } from './terminalGridCache';
import { isMobileBrowserEnvironment } from '../layout/mobileLayout';

interface Props {
  connId: number;
  themeName?: string;
  onStatus?: (connected: boolean) => void;
  onResizeDim?: (cols: number, rows: number) => void;
  extraMenuItems?: { label: string; action: () => void }[];
  tabs?: import('../../store/layout').Tab[];
  myTabId?: string;
  workspaceIndex?: number;
  panelNumber?: number;
}

type Octets = Uint8Array | ArrayBuffer;
interface ZSentry { consume: (octets: Uint8Array) => void; }
interface ZTransfer { accept: () => Promise<void>; get_payloads: () => unknown; get_details: () => { name: string }; }
interface ZSession { type: 'send' | 'receive'; on: (event: string, callback: (value?: ZTransfer) => void) => void; start: () => void; abort: () => void; }
interface ZDetection { deny: () => void; confirm: () => ZSession; }
type TerminalSendRegistry = Window & Record<string, (data: string) => void>;

interface PendingLeftGesture {
  anchor: { col: number; row: number };
  clientX: number;
  clientY: number;
  detail: number;
  target: EventTarget;
  selecting: boolean;
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

export default function ThemedTerminal({ connId, onStatus, onResizeDim, extraMenuItems, tabs, myTabId, workspaceIndex, panelNumber }: Props) {
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
  const pendingUploadRef = useRef<ZSession | null>(null);
  const outputQueueRef = useRef<Uint8Array[]>([]);
  const outputFrameRef = useRef<number | null>(null);
  const sendRef = useRef<(data: string) => void>(() => {});
  const inputViewportFollowedRef = useRef(false);
  const onStatusRef = useRef(onStatus);
  const onResizeDimRef = useRef(onResizeDim);
  const themeName = usePreferencesStore((s) => s.themeName);
  const fontSize = usePreferencesStore((s) => s.fontSize);
  const broadcastScope = useLayoutStore((s) => s.broadcastScope);
  const broadcastSourceId = useLayoutStore((s) => s.broadcastSourceId);
  const setBroadcastSource = useLayoutStore((s) => s.setBroadcastSource);
  const terminalRegistry = useLayoutStore((s) => s.terminalRegistry);
  const registerTerminal = useLayoutStore((s) => s.registerTerminal);
  const unregisterTerminal = useLayoutStore((s) => s.unregisterTerminal);
  const setSftpCdPath = useLayoutStore((s) => s.setSftpCdPath);
  const setStatusConn = useLayoutStore((s) => s.setStatusConn);
  const focusedPaneId = useLayoutStore((s) => s.focusedPaneId);

  const enqueueTerminalOutput = useCallback((bytes: Uint8Array) => {
    outputQueueRef.current.push(bytes);
    if (outputFrameRef.current !== null) return;
    outputFrameRef.current = requestAnimationFrame(() => {
      outputFrameRef.current = null;
      const term = termRef.current;
      const queue = outputQueueRef.current.splice(0);
      if (!term || queue.length === 0) return;
      const total = queue.reduce((size, chunk) => size + chunk.byteLength, 0);
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const chunk of queue) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
      }
      try {
        deliverTerminalBytes(term, zsentryRef.current, merged);
      } catch (error) {
        console.warn('terminal output delivery:', error);
      }
    });
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

  useEffect(() => {
    const themeConfig = getTheme(themeName || 'XTerminal Green');
    const term = new Terminal({
      cursorBlink: true, fontSize: fontSize, fontFamily: '"JetBrains Mono", "JetBrains Maple Mono", Consolas, monospace',
      scrollback: terminalScrollbackLines,
      scrollOnUserInput: true,
      // Match native terminal applications: one wheel notch should advance
      // several rows instead of appearing to crawl through long scrollback.
      scrollSensitivity: 3,
      fastScrollSensitivity: 3,
      overviewRuler: { width: 5 },
      theme: {
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
    const mobileBrowser = isMobileBrowserEnvironment();
    const handleTerminalWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) inputViewportFollowedRef.current = false;
      // A normal shell has a local xterm scrollback. Do not let tmux's mouse
      // protocol reach readline, where wheel reports become history-up/down.
      const alternate = terminalModeRef.current === 'cli' ||
        (terminalModeRef.current === 'unknown' && (alternateScreenRef.current || term.buffer.active.type === 'alternate'));
      return routeTerminalWheel(event, {
        scrollNotch: (lines) => {
          if (!alternate) {
            term.scrollLines(lines);
            return;
          }
          // Claude's negotiated SGR wheel handler advances three lines per
          // report. Send one report, independent of browser pixel deltas.
          const bounds = term.element?.querySelector('.xterm-screen')?.getBoundingClientRect();
          if (!bounds) return;
          const { col, row } = getTerminalGridPosition(
            { x: event.clientX, y: event.clientY }, bounds, term.cols, term.rows,
          );
          sendRef.current(JSON.stringify({ data: `\x1b[<${lines < 0 ? 64 : 65};${col};${row}M` }));
        },
      });
    };
    term.attachCustomWheelEventHandler(handleTerminalWheel);
    // Handle wheels on the complete panel, including the area below xterm's
    // last integral character row. Do not replay into another coordinate space.
    const handleSurfaceWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      const viewport = term.element?.querySelector('.xterm-scrollable-element');
      if (event.target instanceof Node && viewport?.contains(event.target)) return;
      if (!handleTerminalWheel(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.deltaY) term.scrollLines(Math.sign(event.deltaY) * 3);
    };

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
          term.scrollLines(direction * 3);
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

    term.onResize(({ cols, rows }) => {
      if (cols < 2 || rows < 1) return; // ignore zero-size (hidden terminal)
      if (resizingForSharedGrid) return;
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
        const currentScreen = term.element?.querySelector<HTMLElement>('.xterm-screen');
        if (currentScreen) currentScreen.style.transform = '';

        // Adapt to the browser viewport, not the largest attached monitor.
        const displayWidth = window.innerWidth;
        const useSmallViewportBaseline = !mobileBrowser && displayWidth < smallViewportWidth;
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
        fitAddon.fit();

        const nativeGrid = { cols: term.cols, rows: term.rows };
        // Raw pane ANSI coordinates must use the server's exact grid, even
        // on a large display with many small split panels.
        const targetGrid = sharedGrid || (useSmallViewportBaseline ? defaultSharedTerminalGrid : nativeGrid);
        const screen = term.element?.querySelector<HTMLElement>('.xterm-screen');
        const nativeCellWidth = screen && nativeGrid.cols > 0
          ? screen.getBoundingClientRect().width / nativeGrid.cols
          : 1;
        let scaleOptions = mobileBrowser
          ? { fontSize: responsiveFontSize, letterSpacing: 0, lineHeight: 1, scale: 1 }
          : calculateTerminalScale(nativeGrid, targetGrid, responsiveFontSize, nativeCellWidth);

        term.options.fontSize = scaleOptions.fontSize;
        term.options.letterSpacing = scaleOptions.letterSpacing;
        term.options.lineHeight = scaleOptions.lineHeight;

        // Font rasterisation can differ by a fraction of a pixel across DPRs.
        // Add a small correction only when xterm says the target would overflow.
        const proposed = fitAddon.proposeDimensions();
        if (!mobileBrowser && proposed && (proposed.cols < targetGrid.cols || proposed.rows < targetGrid.rows)) {
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
        if (useSmallViewportBaseline) {
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
      } finally {
        resizingForSharedGrid = false;
      }
    };

    const scheduleFit = () => {
      if (pendingFitFrame !== null) cancelAnimationFrame(pendingFitFrame);
      pendingFitFrame = requestAnimationFrame(() => {
        pendingFitFrame = null;
        fitWhenVisible();
      });
    };

    const titleDisposable = term.onTitleChange((title) => {
      const announcedGrid = parseSharedTerminalGridTitle(title);
      if (!announcedGrid) return;
      // tmux's title is authoritative for a connected shared session, but a
      // small-only client still needs the deterministic baseline. Otherwise
      // tmux echoes the small client's native grid and immediately erases the
      // scale that was applied during the first fit.
      const nextGrid = announcedGrid;
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
    if (surfaceElement) {
      surfaceElement.style.backgroundColor = themeConfig.background;
      term.open(surfaceElement);
      // Full-screen CLIs repaint the alternate buffer heavily. Prefer GPU
      // rendering, but gracefully retain xterm's DOM renderer when WebGL is
      // unavailable (for example in headless or embedded browsers).
      try {
        webglAddon = new WebglAddon();
        term.loadAddon(webglAddon);
        webglAddon.onContextLoss(() => {
          webglAddon?.dispose();
          webglAddon = null;
        });
      } catch (error) {
        console.warn('WebGL renderer unavailable; using xterm DOM renderer', error);
        webglAddon = null;
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
      setTermKey((k) => k + 1);

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

    const handleResize = () => scheduleFit();
    window.addEventListener('resize', handleResize);

    return () => {
      if (pendingFitFrame !== null) cancelAnimationFrame(pendingFitFrame);
      if (outputFrameRef.current !== null) cancelAnimationFrame(outputFrameRef.current);
      outputFrameRef.current = null;
      outputQueueRef.current = [];
      titleDisposable.dispose();
      surfaceElement?.removeEventListener('touchstart', handleTouchStart, true);
      surfaceElement?.removeEventListener('touchmove', handleTouchMove, true);
      surfaceElement?.removeEventListener('touchend', handleTouchEnd, true);
      surfaceElement?.removeEventListener('wheel', handleSurfaceWheel, true);
      if (webglAddon) {
        try { webglAddon.dispose(); } catch { /* ignore */ }
        webglAddon = null;
      }
      term.dispose();
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
    };
  }, [copyCurrentSelection, fontSize, myTabId, pasteFromClipboard, setSftpCdPath, themeName]);

  const token = localStorage.getItem('token') || '';
  const terminalID = myTabId || '';
  const layoutQuery = workspaceIndex && panelNumber ? `&workspace_index=${workspaceIndex}&panel_number=${panelNumber}` : '';
  // Control Mode remains an opt-in diagnostic until the remote tmux stream is
  // proven to emit a complete redraw on every supported SSH implementation.
  // Control Mode provides per-client viewport state and deterministic replay
  // for both desktop and mobile. Keep an emergency opt-out for operators
  // during rollout, but make the tested transport the normal data plane.
  const controlQuery = localStorage.getItem('webterm-control-mode') === '0' ? '' : '&control=1';
  const wsUrl = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/ssh/${connId}?token=${encodeURIComponent(token)}&terminal_id=${encodeURIComponent(terminalID)}${layoutQuery}${controlQuery}`;

  const { send } = useWebSocket({
    url: wsUrl,
    onMessage: (data) => {
      const term = termRef.current;
      if (!term) return;
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'terminal_mode' && (msg.mode === 'shell' || msg.mode === 'cli')) {
          terminalModeRef.current = msg.mode;
          if (msg.mode === 'cli') alternateScreenRef.current = true;
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
          const raw = new TextDecoder().decode(bytes);
          // xterm may report an alternate buffer after a reconnect even when
          // the captured pane is a shell. Raw mode transitions plus prompt/UI
          // markers are more reliable for deciding whether wheel is CLI input.
          // eslint-disable-next-line no-control-regex
          if (/\x1b\[\?(?:47|1047|1049)h/.test(raw)) alternateScreenRef.current = true;
          // eslint-disable-next-line no-control-regex
          if (/\x1b\[\?(?:47|1047|1049)l/.test(raw)) alternateScreenRef.current = false;
          // Strip terminal control sequences before identifying a shell
          // prompt. This prevents a stale xterm alternate-buffer flag on a
          // reattached bash pane from turning wheel input into PageUp.
          // eslint-disable-next-line no-control-regex
          const plain = raw.replace(/\x1b(?:\][^\x07]*(?:\x07|\x1b\\)|\[[0-?]*[ -/]*[@-~]|[@-_])/g, '').replace(/\r/g, '');
          const shellPrompt = /(?:^|\n)[^\n]{0,200}(?:\$|#)\s*$/.test(plain) || /\b(?:bash|zsh|fish|dash)\b/.test(plain);
          // A reattached shell can start with tmux's stale ?1049h redraw;
          // an actual shell prompt is authoritative and must win over it.
          if (shellPrompt) terminalModeRef.current = 'shell';
          else if (/claude|context|bypass permissions|\[minimax/i.test(plain)) terminalModeRef.current = 'cli';
            enqueueTerminalOutput(bytes);
        }
        if (msg.error) term.write(`\r\n\x1b[31m${msg.error}\x1b[0m\r\n`);
      } catch {
        enqueueTerminalOutput(new TextEncoder().encode(data));
      }
    },
    onClose: (final) => {
      if (final) {
        onStatusRef.current?.(false);
        setStatusConn(null);
        termRef.current?.write('\r\n\x1b[33m[' + t('term_disconnected') + ']\x1b[0m\r\n');
      } else {
        termRef.current?.write('\r\n\x1b[33m[' + t('term_reconnecting') + ']\x1b[0m\r\n');
      }
    },
    onOpen: (sendNow) => {
      // fit() may run before the socket is open. Always make the first frame
      // carry the real xterm grid so the backend never leaves tmux at the
      // fallback PTY size (especially after a layout or tab-title update).
      const term = termRef.current;
      if (term && term.cols > 1 && term.rows > 0) {
        const cachedGrid = terminalID ? getSharedTerminalGrid(terminalID) : null;
        sendNow(JSON.stringify({
          cols: Math.max(term.cols, cachedGrid?.cols || 0),
          rows: Math.max(term.rows, cachedGrid?.rows || 0),
        }));
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
              // Remote ran rz: browsers require a user gesture to open a file picker,
              // so ask the user to press Enter first.
              pendingUploadRef.current = session;
              termRef.current?.write('\r\n\x1b[33m[ZMODEM] 按 Enter 选择要上传的文件 / press Enter to choose files\x1b[0m\r\n');
              session.on('session_end', () => {
                zmodemActiveRef.current = false;
                zsessionRef.current = null;
                pendingUploadRef.current = null;
                zsentryRef.current = makeSentry();
              });
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

  // Register this terminal's send function globally for broadcast
  useEffect(() => {
    if (!myTabId) return;
    const key = `webterm-ws-${myTabId}`;
    (window as unknown as TerminalSendRegistry)[key] = send;
    registerTerminal(myTabId);
    return () => {
      delete (window as unknown as TerminalSendRegistry)[key];
      unregisterTerminal(myTabId);
    };
  }, [myTabId, send, registerTerminal, unregisterTerminal]);

  // Auto-register as broadcast source
  useEffect(() => {
    if (broadcastScope !== 'off' && !broadcastSourceId && myTabId) {
      setBroadcastSource(myTabId);
    }
  }, [broadcastScope, broadcastSourceId, myTabId, setBroadcastSource]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    const disposable = term.onData((data) => {
      if (pendingUploadRef.current && (data === '\r' || data === '\n')) {
        const session = pendingUploadRef.current;
        pendingUploadRef.current = null;
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.onchange = async () => {
          const files = input.files ? Array.from(input.files) : [];
          try {
            if (files.length) {
              await Zmodem.Browser.send_files(session, files);
            } else {
              try { session.abort(); } catch { /* session already closed */ }
            }
          } catch (e) {
            termRef.current?.write(`\r\n\x1b[31mZMODEM: ${e}\x1b[0m\r\n`);
          }
          zmodemActiveRef.current = false;
          zsessionRef.current = null;
        };
        input.click();
        return;
      }
      if (zmodemActiveRef.current) {
        sendTextAsBinary(data);
        return;
      }
      if (!inputViewportFollowedRef.current) {
        send(terminalActionMessage(followTerminalInputAction));
        inputViewportFollowedRef.current = true;
      }
      selectionSnapshotRef.current = '';
      const isSource = myTabId === broadcastSourceId;
      const isTarget = broadcastScope !== 'off' && !isSource;

      if (isTarget) return; // Target terminal - input comes from broadcast

      send(JSON.stringify({ data }));

      // Broadcast to other terminals
      if (isSource && broadcastScope !== 'off') {
        const targets = broadcastScope === 'all' ? terminalRegistry : tabs?.map((t) => t.id) || [];
        targets.forEach((tid) => {
          if (tid !== myTabId) {
            const targetSend = (window as unknown as TerminalSendRegistry)[`webterm-ws-${tid}`];
            if (targetSend) targetSend(JSON.stringify({ data }));
          }
        });
      }
    });
    return () => disposable.dispose();
  }, [send, sendTextAsBinary, broadcastScope, broadcastSourceId, myTabId, tabs, terminalRegistry, termKey]);

  return (
    <div className="terminal-root" style={{ position: 'relative', flex: 1, display: 'flex', minWidth: 0, minHeight: 0, overflow: 'hidden', background: getTheme(themeName || 'XTerminal Green').background }}>
      <div ref={ref} className="terminal-surface" style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden', padding: '0 6px', background: getTheme(themeName || 'XTerminal Green').background }}
        onMouseDownCapture={handleSurfaceMouseDown}
        onMouseMoveCapture={handleSurfaceMouseMove}
        onMouseUpCapture={handleSurfaceMouseUp}
        onKeyDownCapture={() => { mouseStateRef.current.tmuxMenuActive = false; }}
        onContextMenuCapture={(e) => routeTerminalContextMenu(e, (position) => {
          contextSelectionRef.current = termRef.current?.getSelection() || selectionSnapshotRef.current;
          setContextMenu(position);
        })}
      />
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
