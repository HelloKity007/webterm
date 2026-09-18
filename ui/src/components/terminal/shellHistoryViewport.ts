export interface ShellHistoryViewport {
  anchor: string;
  anchorOffset: number;
  // A single divider or prompt can occur many times in a busy CLI transcript.
  // Keep a small visible-line fingerprint so new live output cannot restore a
  // reader to a later duplicate occurrence after a reload.
  anchorContext?: string[];
  fromBottom: number;
  // The normal-buffer origin at capture time makes a same-buffer restore
  // unambiguous even if a repeated line occurs elsewhere in scrollback.
  baseY?: number;
  // A reconnect can initially inherit a shorter peer's tmux layout. Retain
  // the reader's own stable grid so that layout cannot reflow its anchor
  // before this browser has completed its local negotiation.
  rows?: number;
  cols?: number;
  // A shared tmux grid may be taller than a particular local Panel. In that
  // case the Panel's own scroll container supplies part of the visible row
  // offset, independently of xterm's normal-buffer viewport.
  outerTop?: number;
  savedAt: number;
}

const maxAgeMs = 6 * 60 * 60 * 1000;
const keyPrefix = 'webterm-shell-history-viewport:v1';

export function shellHistoryViewportKey(userID: string, connID: number, terminalID: string, workspaceIndex?: number, panelNumber?: number) {
  return [keyPrefix, userID, connID, workspaceIndex || 0, panelNumber || 0, terminalID].join(':');
}

export function loadShellHistoryViewport(storage: Storage, key: string, now = Date.now()): ShellHistoryViewport | null {
  try {
    const value = JSON.parse(storage.getItem(key) || '') as Partial<ShellHistoryViewport>;
    const { anchor, anchorOffset, anchorContext, fromBottom, baseY, rows, cols, outerTop, savedAt } = value;
    if (typeof anchor !== 'string' || typeof anchorOffset !== 'number' || !Number.isInteger(anchorOffset) || anchorOffset < 0 ||
      typeof fromBottom !== 'number' || !Number.isInteger(fromBottom) || fromBottom < 1 ||
      typeof savedAt !== 'number' || !Number.isFinite(savedAt) || now - savedAt > maxAgeMs) {
      storage.removeItem(key);
      return null;
    }
    // Older v1 records did not include the outer panel offset. Retain them:
    // their xterm position is still valid and the missing outer value simply
    // means there is no outer offset to restore.
    if (outerTop !== undefined && (typeof outerTop !== 'number' || !Number.isFinite(outerTop) || outerTop < 0)) {
      storage.removeItem(key);
      return null;
    }
    if (baseY !== undefined && (!Number.isInteger(baseY) || baseY < 0)) {
      storage.removeItem(key);
      return null;
    }
    if (rows !== undefined && (!Number.isInteger(rows) || rows < 1 || rows > 499)) {
      storage.removeItem(key);
      return null;
    }
    if (cols !== undefined && (!Number.isInteger(cols) || cols < 2 || cols > 1000)) {
      storage.removeItem(key);
      return null;
    }
    if (anchorContext !== undefined && (!Array.isArray(anchorContext) || anchorContext.length < 1 || anchorContext.length > 8 ||
      anchorContext.some(line => typeof line !== 'string') || anchorContext.join('').length > 8192)) {
      storage.removeItem(key);
      return null;
    }
    return { anchor, anchorOffset, ...(anchorContext === undefined ? {} : { anchorContext }), fromBottom, ...(baseY === undefined ? {} : { baseY }), ...(rows === undefined ? {} : { rows }), ...(cols === undefined ? {} : { cols }), ...(outerTop === undefined ? {} : { outerTop }), savedAt };
  } catch {
    storage.removeItem(key);
    return null;
  }
}

export function saveShellHistoryViewport(storage: Storage, key: string, viewport: ShellHistoryViewport) {
  try { storage.setItem(key, JSON.stringify(viewport)); } catch { /* Session storage can be unavailable or full. */ }
}

export function clearShellHistoryViewport(storage: Storage, key: string) {
  try { storage.removeItem(key); } catch { /* Storage is optional persistence. */ }
}

export function restoredHistoryLine(snapshot: ShellHistoryViewport, lines: readonly string[], baseY: number): number {
  const expected = Math.max(0, Math.min(baseY, baseY - snapshot.fromBottom));
  // When the captured normal buffer is unchanged, distance from its bottom is
  // exact. Do not let a repeated marker line select a different occurrence
  // after a hard reload (the Windows native regression found a 13-row jump).
  if (snapshot.baseY === baseY) return expected;
  if (snapshot.anchorContext?.length) {
    let nearest: number | undefined;
    const limit = Math.min(baseY, lines.length - snapshot.anchorContext.length);
    for (let index = 0; index <= limit; index++) {
      if (!snapshot.anchorContext.every((line, offset) => lines[index + offset] === line)) continue;
      if (nearest === undefined || Math.abs(index - expected) < Math.abs(nearest - expected)) nearest = index;
    }
    if (nearest !== undefined) return nearest;
  }
  if (snapshot.anchor) {
    let nearest: number | undefined;
    for (let index = lines.length - 1; index >= 0; index--) {
      if (lines[index] !== snapshot.anchor) continue;
      const candidate = Math.max(0, Math.min(baseY, index - snapshot.anchorOffset));
      if (nearest === undefined || Math.abs(candidate - expected) < Math.abs(nearest - expected)) nearest = candidate;
    }
    // Legacy records predate baseY. Their old one-line anchor is useful for a
    // small reflow adjustment but unsafe when it is far from the saved
    // relative position: a repeated marker could otherwise visibly jump the
    // reader to another block.
    if (nearest !== undefined && (snapshot.baseY !== undefined || Math.abs(nearest - expected) <= 2)) return nearest;
  }
  return expected;
}
