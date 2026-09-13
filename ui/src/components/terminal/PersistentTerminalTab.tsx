import { useLayoutEffect, useRef, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import TerminalTab from './TerminalTab';

type Entry = { host: HTMLDivElement; root: Root; owners: number };
const terminals = new Map<string, Entry>();

// Moving a tab between panes reparents its host, not its terminal React root.
// Identity is the persisted terminal ID, never pane index or tab order.
export default function PersistentTerminalTab(props: ComponentProps<typeof TerminalTab>) {
  const slot = useRef<HTMLDivElement>(null);
  const id = props.myTabId;
  useLayoutEffect(() => {
    if (!id || !slot.current) return;
    let entry = terminals.get(id);
    if (!entry) {
      const host = document.createElement('div');
      Object.assign(host.style, { display: 'flex', flex: '1', minWidth: '0', minHeight: '0', overflow: 'hidden' });
      entry = { host, root: createRoot(host), owners: 0 };
      terminals.set(id, entry);
    }
    entry.owners++;
    slot.current.appendChild(entry.host);
    const mounted = entry;
    return () => {
      mounted.owners--;
      // A move mounts the destination during this commit. Only a genuine
      // removal with no remaining owner disposes the renderer/socket.
      queueMicrotask(() => {
        if (mounted.owners !== 0 || terminals.get(id) !== mounted) return;
        mounted.root.unmount();
        mounted.host.remove();
        terminals.delete(id);
      });
    };
  }, [id]);
  useLayoutEffect(() => {
    if (id) terminals.get(id)?.root.render(<TerminalTab {...props} />);
  });
  return id ? <div ref={slot} style={{ display: 'flex', flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden' }} /> : <TerminalTab {...props} />;
}
