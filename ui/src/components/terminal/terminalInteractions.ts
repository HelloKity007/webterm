interface TerminalPointerEvent {
  button: number;
  buttons?: number;
  ctrlKey: boolean;
  shiftKey?: boolean;
  clientX: number;
  clientY: number;
  detail?: number;
  target?: EventTarget | null;
  nativeEvent?: Event;
  preventDefault: () => void;
  stopPropagation: () => void;
}

interface TerminalContextMenuEvent extends TerminalPointerEvent {
  clientX: number;
  clientY: number;
}

export type ClipboardActionResult = 'ok' | 'empty' | 'denied';

interface TerminalKeyboardEvent {
  type: string;
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  preventDefault?: () => void;
  stopPropagation?: () => void;
}

interface TerminalClipboardShortcutActions {
  copy: () => void;
}

const forwardedTerminalPointerEvents = new WeakSet<Event>();

export interface TerminalMouseState {
  tmuxMenuActive: boolean;
  selectionDragActive: boolean;
}

interface TerminalMouseActions {
  focusTerminal?: () => void;
  moveTmuxMenuAt?: (position: { x: number; y: number }) => void;
  releaseTmuxMenuAt?: (position: { x: number; y: number }) => void;
}

export function createTerminalMouseState(): TerminalMouseState {
  return { tmuxMenuActive: false, selectionDragActive: false };
}

export function getTerminalGridPosition(
  position: { x: number; y: number },
  bounds: { left: number; top: number; width: number; height: number },
  cols: number,
  rows: number,
): { col: number; row: number } {
  const col = Math.floor((position.x - bounds.left) * cols / bounds.width) + 1;
  const row = Math.floor((position.y - bounds.top) * rows / bounds.height) + 1;
  return {
    col: Math.max(1, Math.min(cols, col)),
    row: Math.max(1, Math.min(rows, row)),
  };
}

export function routeTerminalClipboardShortcut(
  event: TerminalKeyboardEvent,
  actions: TerminalClipboardShortcutActions,
): boolean {
  if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey) return true;
  const key = event.key.toLowerCase();
  // Ctrl+Shift+V already produces a trusted browser paste event that xterm
  // handles. Reading and pasting here as well duplicates the payload.
  if (key !== 'c') return true;
  event.preventDefault?.();
  event.stopPropagation?.();
  if (event.type === 'keydown') actions.copy();
  return false;
}

export function routeTerminalControlShortcut(
  event: TerminalKeyboardEvent,
  sendControl: (data: string) => void,
): boolean {
  if (!event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return true;
  const key = event.key.toLowerCase();
  const data = key === 'c' ? '\x03' : key === 'z' ? '\x1a' : '';
  if (!data) return true;
  if (event.type === 'keydown') sendControl(data);
  return false;
}

function routeTerminalRightButton(
  event: TerminalPointerEvent,
  type: 'mousedown' | 'mouseup',
  state: TerminalMouseState,
): void {
  const nativeEvent = event.nativeEvent;
  if (nativeEvent && forwardedTerminalPointerEvents.has(nativeEvent)) return;
  if (event.button !== 2) return;
  event.stopPropagation();
  if (!event.ctrlKey || !event.target) return;
  event.preventDefault();
  if (type === 'mousedown') state.tmuxMenuActive = true;

  const forwarded = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 2,
    buttons: type === 'mousedown' ? 2 : 0,
    altKey: true,
    clientX: event.clientX,
    clientY: event.clientY,
  });
  forwardedTerminalPointerEvents.add(forwarded);
  event.target.dispatchEvent(forwarded);
}

export async function copyTerminalText(
  text: string,
  clipboard: Pick<Clipboard, 'writeText'> | undefined,
): Promise<ClipboardActionResult> {
  if (!text) return 'empty';
  if (!clipboard?.writeText) return 'denied';
  try {
    await clipboard.writeText(text);
    return 'ok';
  } catch {
    return 'denied';
  }
}

export async function pasteTerminalText(
  clipboard: Pick<Clipboard, 'readText'> | undefined,
  paste: (text: string) => void,
): Promise<ClipboardActionResult> {
  if (!clipboard?.readText) return 'denied';
  try {
    const text = await clipboard.readText();
    if (!text) return 'empty';
    paste(text);
    return 'ok';
  } catch {
    return 'denied';
  }
}

export function routeTerminalMouseDown(
  event: TerminalPointerEvent,
  state: TerminalMouseState = createTerminalMouseState(),
  actions: TerminalMouseActions = {},
): void {
  const nativeEvent = event.nativeEvent;
  if (nativeEvent && forwardedTerminalPointerEvents.has(nativeEvent)) return;
  if (event.button === 0 && state.tmuxMenuActive) {
    // A tmux display-menu opened from MouseDown is a press-drag-release menu.
    // Make a normal left click release that held menu gesture at the chosen
    // row, so mouse users can activate an item without holding Ctrl/right.
    event.preventDefault();
    event.stopPropagation();
    state.tmuxMenuActive = false;
    if (actions.releaseTmuxMenuAt) {
      actions.releaseTmuxMenuAt({ x: event.clientX, y: event.clientY });
      return;
    }
    if (!event.target) return;
    const forwarded = new MouseEvent('mouseup', {
      bubbles: true,
      cancelable: true,
      button: 2,
      buttons: 0,
      altKey: true,
      clientX: event.clientX,
      clientY: event.clientY,
    });
    forwardedTerminalPointerEvents.add(forwarded);
    event.target.dispatchEvent(forwarded);
    return;
  }
  if (event.button === 0 && !event.ctrlKey && !event.shiftKey && event.target) {
    // tmux mouse mode consumes an ordinary left drag. Replay only the press
    // with Shift so xterm starts its local selection service; subsequent
    // document-level move/up events then extend and finish that selection.
    event.stopPropagation();
    actions.focusTerminal?.();
    state.selectionDragActive = true;
    const forwarded = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      shiftKey: true,
      detail: event.detail || 1,
      clientX: event.clientX,
      clientY: event.clientY,
    });
    forwardedTerminalPointerEvents.add(forwarded);
    event.target.dispatchEvent(forwarded);
    return;
  }
  // tmux normally has no C-MouseDown3Pane binding. Its M-MouseDown3Pane
  // binding opens the standard menu unconditionally, so map the user's
  // Ctrl+right-click pair to Alt+right-click after blocking the originals.
  // The WeakSet lets each replay pass capture handling.
  routeTerminalRightButton(event, 'mousedown', state);
}

export function routeTerminalMouseMove(
  event: TerminalPointerEvent,
  state: TerminalMouseState,
  actions: TerminalMouseActions = {},
): void {
  const nativeEvent = event.nativeEvent;
  if (nativeEvent && forwardedTerminalPointerEvents.has(nativeEvent)) return;
  if (state.selectionDragActive && event.buttons === 0) {
    state.selectionDragActive = false;
    return;
  }
  if (state.selectionDragActive && event.target) {
    event.preventDefault();
    event.stopPropagation();
    const forwarded = new MouseEvent('mousemove', {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      shiftKey: true,
      clientX: event.clientX,
      clientY: event.clientY,
    });
    forwardedTerminalPointerEvents.add(forwarded);
    event.target.dispatchEvent(forwarded);
    return;
  }
  if (!state.tmuxMenuActive || !event.target) return;
  event.preventDefault();
  event.stopPropagation();
  actions.moveTmuxMenuAt?.({ x: event.clientX, y: event.clientY });
}

export function routeTerminalMouseUp(
  event: TerminalPointerEvent,
  state: TerminalMouseState = createTerminalMouseState(),
  actions: TerminalMouseActions = {},
): void {
  const nativeEvent = event.nativeEvent;
  if (nativeEvent && forwardedTerminalPointerEvents.has(nativeEvent)) return;
  if (event.button === 0 && state.selectionDragActive && event.target) {
    event.preventDefault();
    event.stopPropagation();
    state.selectionDragActive = false;
    const forwarded = new MouseEvent('mouseup', {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 0,
      shiftKey: true,
      clientX: event.clientX,
      clientY: event.clientY,
    });
    forwardedTerminalPointerEvents.add(forwarded);
    event.target.dispatchEvent(forwarded);
    actions.focusTerminal?.();
    return;
  }
  if (event.button !== 2) return;
  event.preventDefault();
  event.stopPropagation();
}

export function routeTerminalContextMenu(
  event: TerminalContextMenuEvent,
  openFrontendMenu: (position: { x: number; y: number }) => void,
): void {
  // Always suppress the browser's native menu. Ctrl+right-click has already
  // reached xterm on mousedown and is reserved for tmux.
  event.preventDefault();
  event.stopPropagation();
  if (event.ctrlKey) return;
  openFrontendMenu({ x: event.clientX, y: event.clientY });
}
