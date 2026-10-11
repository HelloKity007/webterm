export const terminalScrollbackLines = 20_000;
export const launchCodexScrollableAction = 'launch_codex_scrollable';
export const resumeTerminalInputAction = 'resume_terminal_input';
export const openClaudeTranscriptAction = 'open_claude_transcript';
export const followTerminalInputAction = 'follow_terminal_input';

const alternatePageIntervalMs = 120;

/** Forward a physical notch once; the CLI owns its native scroll step. */
export function createLatestTerminalWheelSender(send: (data: string) => void) {
  let disposed = false;
  return {
    notch(data: string) {
      if (!disposed) send(data);
    },
    dispose: () => { disposed = true; },
  };
}

export interface TerminalWheelState {
  lastPageAt: number;
  lastPageDirection: number;
}

export interface TerminalWheelNotchGate {
  offer(deltaY: number, deltaMode: number, at?: number, shift?: boolean): boolean;
}

// Platform detection cannot classify a Magic Mouse attached to Windows
// (navigator.platform is Win32 while the deltas are fractional momentum
// streams, and fast flicks cross any magnitude threshold). The reliable
// signal is the delta value itself: real wheel notches are integers
// quantized to the Windows wheel quantum (±100/±120 per event, multiples
// for fast scrolling); momentum deltas are arbitrary, mostly fractional.
// Momentum scrolling is distance-proportional like the native trackpad
// experience: one notch (3 lines) per 100px of accumulated travel. A
// token bucket bounds flicks (burst of notches, then throttled) while a
// sustained drag stays under the refill rate and never throttles. The
// bucket refills continuously, so unlike a per-gesture cap a momentum
// tail can never chain a gesture into a stuck, unscrollable direction.
export function createTerminalWheelNotchGate(options: {
  gestureGapMs?: number;
  notchPixels?: number;
  burstCap?: number;
  refillPerSecond?: number;
  now?: () => number;
} = {}): TerminalWheelNotchGate {
  const gestureGapMs = options.gestureGapMs ?? 150;
  const notchPixels = options.notchPixels ?? 100;
  const burstCap = options.burstCap ?? 6;
  const refillPerSecond = options.refillPerSecond ?? 6;
  const now = options.now ?? (() => Date.now());
  let gestureDirection = 0;
  let gestureShift: boolean | null = null;
  let accumulated = 0;
  let emittedCount = 0;
  let available = burstCap;
  let lastWheelAt = -Infinity;

  const refill = (at: number) => {
    if (lastWheelAt === -Infinity) {
      available = burstCap;
      return;
    }
    const elapsed = Math.max(0, at - lastWheelAt);
    available = Math.min(burstCap, available + (elapsed / 1000) * refillPerSecond);
  };

  return {
    offer(deltaY, deltaMode, at = now(), shift) {
      if (deltaMode !== WheelEvent.DOM_DELTA_PIXEL) {
        gestureDirection = 0;
        gestureShift = null;
        accumulated = 0;
        emittedCount = 0;
        refill(at);
        lastWheelAt = at;
        return true;
      }
      if (!deltaY) return false;
      const direction = Math.sign(deltaY);
      const absDelta = Math.abs(deltaY);
      if (Number.isInteger(deltaY) && (absDelta % 100 === 0 || absDelta % 120 === 0)) {
        // A discrete wheel notch always passes, even in fast bursts, and
        // anchors the gesture so a trailing momentum stream starts fresh.
        gestureDirection = direction;
        gestureShift = shift ?? null;
        accumulated = 0;
        emittedCount = 0;
        refill(at);
        lastWheelAt = at;
        return true;
      }
      const idle = at - lastWheelAt > gestureGapMs;
      const shiftChanged = gestureDirection !== 0 && gestureShift !== null && shift !== undefined && shift !== gestureShift;
      refill(at);
      lastWheelAt = at;
      if (available < 1) {
        // Throttled: consume no travel so a refill cannot replay a backlog.
        return false;
      }
      if (idle || direction !== gestureDirection || shiftChanged) {
        gestureDirection = direction;
        gestureShift = shift ?? null;
        accumulated = 0;
        emittedCount = 0;
      }
      accumulated += absDelta;
      const earned = 1 + Math.floor(accumulated / notchPixels);
      if (earned > emittedCount) {
        emittedCount++;
        available -= 1;
        return true;
      }
      return false;
    },
  };
}

interface TerminalWheelOptions {
  scrollNotch?: (lines: number) => void;
  notchGate?: TerminalWheelNotchGate;
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
    if (!options.notchGate?.offer(event.deltaY, event.deltaMode, undefined, event.shiftKey)) {
      if (options.notchGate) return false;
    }
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
