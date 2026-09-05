import { t } from '../../i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
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
  launchCodexScrollableAction,
  resumeTerminalInputAction,
  routeTerminalWheel,
  terminalActionMessage,
  terminalScrollbackLines,
} from './terminalCliSupport';
import {
  clearTerminalHistory,
  copyTerminalText,
  createTerminalMouseState,
  getTerminalGridPosition,
  pasteTerminalText,
  routeTerminalClipboardShortcut,
  routeTerminalControlShortcut,
  routeTerminalContextMenu,
  routeTerminalMouseDown,
  routeTerminalMouseMove,
  routeTerminalMouseUp,
} from './terminalInteractions';

interface Props {
  connId: number;
  themeName?: string;
  onStatus?: (connected: boolean) => void;
  onResizeDim?: (cols: number, rows: number) => void;
  extraMenuItems?: { label: string; action: () => void }[];
  tabs?: import('../../store/layout').Tab[];
  myTabId?: string;
}

type Octets = Uint8Array | ArrayBuffer;
interface ZSentry { consume: (octets: Uint8Array) => void; }
interface ZTransfer { accept: () => Promise<void>; get_payloads: () => unknown; get_details: () => { name: string }; }
interface ZSession { type: 'send' | 'receive'; on: (event: string, callback: (value?: ZTransfer) => void) => void; start: () => void; abort: () => void; }
interface ZDetection { deny: () => void; confirm: () => ZSession; }
type TerminalSendRegistry = Window & Record<string, (data: string) => void>;

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

export default function ThemedTerminal({ connId, onStatus, onResizeDim, extraMenuItems, tabs, myTabId }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const [termKey, setTermKey] = useState(0);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [clipboardNotice, setClipboardNotice] = useState('');
  const [historyHelpOpen, setHistoryHelpOpen] = useState(false);
  const contextSelectionRef = useRef('');
  const mouseStateRef = useRef(createTerminalMouseState());
  const wheelStateRef = useRef(createTerminalWheelState());
  const clipboardNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rules = useHighlightRules();
  const rulesRef = useRef(rules);
  const zsentryRef = useRef<ZSentry | null>(null);
  const zsessionRef = useRef<ZSession | null>(null);
  const zmodemActiveRef = useRef(false);
  const pendingUploadRef = useRef<ZSession | null>(null);
  const sendRef = useRef<(data: string) => void>(() => {});
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

  const copyCurrentSelection = useCallback(async () => {
    const result = await copyTerminalText(termRef.current?.getSelection() || '', navigator.clipboard);
    showClipboardNotice(result === 'ok' ? t('term_copied') : result === 'empty' ? t('term_copy_empty') : t('term_copy_failed'));
  }, [showClipboardNotice]);

  const pasteFromClipboard = useCallback(async () => {
    const result = await pasteTerminalText(navigator.clipboard, (text) => termRef.current?.paste(text));
    if (result === 'ok') termRef.current?.focus();
    else showClipboardNotice(result === 'empty' ? t('term_paste_empty') : t('term_paste_failed'));
  }, [showClipboardNotice]);

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

  useEffect(() => () => {
    if (clipboardNoticeTimerRef.current) clearTimeout(clipboardNoticeTimerRef.current);
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
    const themeConfig = getTheme(themeName || 'Dracula');
    const term = new Terminal({
      cursorBlink: true, fontSize: fontSize, fontFamily: '"JetBrains Mono", "JetBrains Maple Mono", Consolas, monospace',
      scrollback: terminalScrollbackLines,
      scrollOnUserInput: true,
      theme: {
        background: themeConfig.background,
        foreground: themeConfig.foreground,
        scrollbarSliderBackground: colors.border,
        scrollbarSliderHoverBackground: colors.textMuted,
        scrollbarSliderActiveBackground: colors.accent,
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
    term.attachCustomWheelEventHandler((event) => routeTerminalWheel(event, {
      alternateScreen: term.buffer.active.type === 'alternate',
      state: wheelStateRef.current,
      sendPage: (direction) => {
        sendRef.current(JSON.stringify({ data: direction === 'up' ? '\x1b[5~' : '\x1b[6~' }));
      },
    }));

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

    term.onResize(({ cols, rows }) => {
      if (cols < 2 || rows < 1) return; // ignore zero-size (hidden terminal)
      sendRef.current(JSON.stringify({ cols, rows }));
      onResizeDimRef.current?.(cols, rows);
    });

    const fitWhenVisible = () => {
      if (!ref.current || ref.current.offsetWidth <= 0 || ref.current.offsetHeight <= 0) return;
      fitAddon.fit();
    };

    if (ref.current) {
      ref.current.style.backgroundColor = themeConfig.background;
      term.open(ref.current);
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
        fitWhenVisible();
        term.focus();
        // Retry focus after layout settles (important for split panes)
        setTimeout(() => term.focus(), 100);
      });
    }

    const resizeObserver = new ResizeObserver(() => {
      fitWhenVisible();
    });
    if (ref.current) resizeObserver.observe(ref.current);

    const handleResize = () => fitWhenVisible();
    window.addEventListener('resize', handleResize);

    return () => {
      term.dispose();
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
    };
  }, [copyCurrentSelection, fontSize, myTabId, pasteFromClipboard, setSftpCdPath, themeName]);

  const token = localStorage.getItem('token') || '';
  const terminalID = myTabId || '';
  const wsUrl = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/ssh/${connId}?token=${encodeURIComponent(token)}&terminal_id=${encodeURIComponent(terminalID)}`;

  const { send } = useWebSocket({
    url: wsUrl,
    onMessage: (data) => {
      const term = termRef.current;
      if (!term) return;
      try {
        const msg = JSON.parse(data);
        if (msg.data) {
          let bytes: Uint8Array;
          if (msg.b64) {
            const bin = atob(msg.data);
            bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          } else {
            bytes = new TextEncoder().encode(msg.data);
          }
          try {
            deliverTerminalBytes(term, zsentryRef.current, bytes);
          } catch (e) {
            // Repeated ZMODEM handshakes (rz retries) can make the session throw;
            // swallow them instead of dumping raw JSON into the terminal.
            console.warn('zmodem consume:', e);
          }
        }
        if (msg.error) term.write(`\r\n\x1b[31m${msg.error}\x1b[0m\r\n`);
      } catch {
        term.write(data);
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
        sendNow(JSON.stringify({ cols: term.cols, rows: term.rows }));
      }
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
    <div style={{ position: 'relative', flex: 1, display: 'flex', minWidth: 0, minHeight: 0, overflow: 'hidden', background: getTheme(themeName || 'Dracula').background }}>
      <div ref={ref} className="terminal-surface" style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden', padding: '0 6px', background: getTheme(themeName || 'Dracula').background }}
        onMouseDownCapture={(event) => routeTerminalMouseDown(event, mouseStateRef.current, {
          focusTerminal: focusTerminalAfterPointer,
          releaseTmuxMenuAt,
        })}
        onMouseMoveCapture={(event) => routeTerminalMouseMove(event, mouseStateRef.current, { moveTmuxMenuAt })}
        onMouseUpCapture={(event) => routeTerminalMouseUp(event, mouseStateRef.current, { focusTerminal: focusTerminalAfterPointer })}
        onKeyDownCapture={() => { mouseStateRef.current.tmuxMenuActive = false; }}
        onContextMenuCapture={(e) => routeTerminalContextMenu(e, (position) => {
          contextSelectionRef.current = termRef.current?.getSelection() || '';
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
