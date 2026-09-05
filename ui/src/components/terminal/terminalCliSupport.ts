export const terminalScrollbackLines = 20_000;
export const launchCodexScrollableAction = 'launch_codex_scrollable';
export const resumeTerminalInputAction = 'resume_terminal_input';

const replayedHistoryWheelEvents = new WeakSet<Event>();

/**
 * xterm encodes Shift in mouse reports. tmux consequently sees an unbound
 * S-WheelUpPane instead of its normal WheelUpPane history/application route.
 * Replay the browser event without Shift and let xterm generate the negotiated
 * mouse protocol; never synthesize terminal escape bytes ourselves.
 */
export function routeTerminalHistoryWheel(event: WheelEvent): boolean {
  if (replayedHistoryWheelEvents.has(event) || !event.shiftKey) return true;

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

export function terminalActionMessage(action: string): string {
  return JSON.stringify({ action });
}
