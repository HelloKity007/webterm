export const terminalScrollbackLines = 20_000;
export const launchCodexScrollableAction = 'launch_codex_scrollable';
export const resumeTerminalInputAction = 'resume_terminal_input';
export const openClaudeTranscriptAction = 'open_claude_transcript';
export const followTerminalInputAction = 'follow_terminal_input';

const alternatePageIntervalMs = 120;

export interface TerminalWheelState {
  lastPageAt: number;
  lastPageDirection: number;
}

interface TerminalWheelOptions {
  scrollNotch?: (lines: number) => void;
  alternateScreen?: boolean;
  state?: TerminalWheelState;
  sendPage?: (direction: 'up' | 'down') => void;
}

export function createTerminalWheelState(): TerminalWheelState {
  return { lastPageAt: 0, lastPageDirection: 0 };
}

const replayedHistoryWheelEvents = new WeakSet<Event>();

/**
 * In a fullscreen alternate buffer, Shift+wheel becomes rate-limited
 * PageUp/PageDown so long Claude sessions can bypass expensive per-line mouse
 * repaints. On the main screen, xterm would encode Shift in mouse reports and
 * tmux would see an unbound S-WheelUpPane, so replay without Shift and let xterm
 * generate the negotiated protocol; never synthesize mouse escape bytes.
 */
export function routeTerminalHistoryWheel(event: WheelEvent, options: TerminalWheelOptions = {}): boolean {
  if (replayedHistoryWheelEvents.has(event) || !event.shiftKey) return true;

  const direction = event.deltaY < 0 ? -1 : event.deltaY > 0 ? 1 : 0;
  if (options.alternateScreen && options.state && options.sendPage && direction !== 0) {
    event.preventDefault();
    event.stopPropagation();
    const now = Date.now();
    if (direction !== options.state.lastPageDirection || now - options.state.lastPageAt >= alternatePageIntervalMs) {
      options.state.lastPageAt = now;
      options.state.lastPageDirection = direction;
      options.sendPage(direction < 0 ? 'up' : 'down');
    }
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  if (!event.target) return false;

  const replay = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    view: event.view,
    detail: event.detail,
    screenX: event.screenX,
    screenY: event.screenY,
    clientX: event.clientX,
    clientY: event.clientY,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
    shiftKey: false,
    button: event.button,
    buttons: event.buttons,
    relatedTarget: event.relatedTarget,
    deltaX: event.deltaX,
    deltaY: event.deltaY,
    deltaZ: event.deltaZ,
    deltaMode: event.deltaMode,
  });
  replayedHistoryWheelEvents.add(replay);
  event.target.dispatchEvent(replay);
  return false;
}

export function routeTerminalWheel(event: WheelEvent, options: TerminalWheelOptions = {}): boolean {
  if (event.ctrlKey) return true;
  if (options.scrollNotch) {
    if (!event.deltaY) return true;
    event.preventDefault();
    event.stopPropagation();
    options.scrollNotch(Math.sign(event.deltaY) * 3);
    return false;
  }
  // Keep the production-proven path for fullscreen TUIs: rate-limited
  // PageUp/PageDown avoids per-line SGR mouse repaint stalls in long Claude
  // sessions. Shift+wheel remains the explicit history override elsewhere.
  if (options.alternateScreen && options.state && options.sendPage) {
    const direction = event.deltaY < 0 ? -1 : event.deltaY > 0 ? 1 : 0;
    if (direction === 0) return false;
    event.preventDefault();
    event.stopPropagation();
    const now = Date.now();
    if (direction !== options.state.lastPageDirection || now - options.state.lastPageAt >= alternatePageIntervalMs) {
      options.state.lastPageAt = now;
      options.state.lastPageDirection = direction;
      options.sendPage(direction < 0 ? 'up' : 'down');
    }
    return false;
  }
  return event.shiftKey ? routeTerminalHistoryWheel(event, options) : true;
}

export function terminalActionMessage(action: string): string {
  return JSON.stringify({ action });
}
