import { useLayoutEffect, useRef, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import TerminalTab from './TerminalTab';
import { disposePersistentTerminal, getPersistentTerminal, setPersistentTerminal } from './persistentTerminalStore';

// Moving a tab between panes reparents its host, not its terminal React root.
// Identity is the persisted terminal ID, never pane index or tab order.
export default function PersistentTerminalTab(props: ComponentProps<typeof TerminalTab>) {
  const slot = useRef<HTMLDivElement>(null);
  const id = props.myTabId;
  useLayoutEffect(() => {
    if (!id || !slot.current) return;
    let entry = getPersistentTerminal(id);
    if (!entry) {
      const host = document.createElement('div');
      Object.assign(host.style, { display: 'flex', flex: '1', minWidth: '0', minHeight: '0', overflow: 'hidden' });
      entry = { host, root: createRoot(host), owners: 0, disposeWhenUnowned: false };
      setPersistentTerminal(id, entry);
    }
    entry.owners++;
    slot.current.appendChild(entry.host);
    const mounted = entry;
    return () => {
      mounted.owners--;
      // A move or a workspace switch mounts the destination during this
      // commit. The renderer remains alive while merely hidden; explicit
      // close paths mark it for disposal via discardPersistentTerminal().
      queueMicrotask(() => {
        if (mounted.owners !== 0 || !mounted.disposeWhenUnowned) return;
        disposePersistentTerminal(id, mounted);
      });
    };
  }, [id]);
  useLayoutEffect(() => {
    if (id) getPersistentTerminal(id)?.root.render(<TerminalTab {...props} />);
  });
  return id ? <div ref={slot} style={{ display: 'flex', flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden' }} /> : <TerminalTab {...props} />;
}
