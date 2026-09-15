import type { Root } from 'react-dom/client';

export type PersistentTerminalEntry = {
  host: HTMLDivElement;
  root: Root;
  owners: number;
  disposeWhenUnowned: boolean;
};

const terminals = new Map<string, PersistentTerminalEntry>();

export function getPersistentTerminal(id: string) {
  return terminals.get(id);
}

export function setPersistentTerminal(id: string, entry: PersistentTerminalEntry) {
  terminals.set(id, entry);
}

export function disposePersistentTerminal(id: string, entry: PersistentTerminalEntry) {
  if (terminals.get(id) !== entry) return;
  entry.root.unmount();
  entry.host.remove();
  terminals.delete(id);
}

// Workspace navigation hides a terminal slot but must not destroy its xterm
// normal-buffer history. Explicit close paths call this after remote cleanup.
export function discardPersistentTerminal(id: string) {
  const entry = terminals.get(id);
  if (!entry) return;
  entry.disposeWhenUnowned = true;
  if (entry.owners === 0) disposePersistentTerminal(id, entry);
}
