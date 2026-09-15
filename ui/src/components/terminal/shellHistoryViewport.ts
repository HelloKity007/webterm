export interface ShellHistoryViewport {
  anchor: string;
  anchorOffset: number;
  fromBottom: number;
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
    const { anchor, anchorOffset, fromBottom, savedAt } = value;
    if (typeof anchor !== 'string' || typeof anchorOffset !== 'number' || !Number.isInteger(anchorOffset) || anchorOffset < 0 ||
      typeof fromBottom !== 'number' || !Number.isInteger(fromBottom) || fromBottom < 1 ||
      typeof savedAt !== 'number' || !Number.isFinite(savedAt) || now - savedAt > maxAgeMs) {
      storage.removeItem(key);
      return null;
    }
    return { anchor, anchorOffset, fromBottom, savedAt };
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
  if (snapshot.anchor) {
    for (let index = lines.length - 1; index >= 0; index--) {
      if (lines[index] === snapshot.anchor) return Math.max(0, Math.min(baseY, index - snapshot.anchorOffset));
    }
  }
  return Math.max(0, Math.min(baseY, baseY - snapshot.fromBottom));
}
