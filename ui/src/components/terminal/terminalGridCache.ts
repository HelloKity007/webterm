import type { TerminalGrid } from './terminalScaling';

const sharedTerminalGridCache = new Map<string, TerminalGrid>();

export function getSharedTerminalGrid(tabId: string): TerminalGrid | null {
  return sharedTerminalGridCache.get(tabId) || null;
}

export function setSharedTerminalGrid(tabId: string, grid: TerminalGrid): void {
  sharedTerminalGridCache.set(tabId, grid);
}
