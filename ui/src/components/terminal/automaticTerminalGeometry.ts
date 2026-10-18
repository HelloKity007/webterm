import type { TerminalGrid } from './terminalScaling';

// User activation and local capacity changes can transfer control. Remote
// layout notifications only invalidate our remembered control, never reclaim it.
export function createAutomaticTerminalGeometry(send: (message: string) => void, eligible: () => boolean) {
  let grid: TerminalGrid | null = null;
  let announced: TerminalGrid | null = null;
  let connected = false;
  let active = false;
  // A peer at another viewport can leave the shared tmux grid wider/taller than
  // this panel. Re-assert whenever the negotiated grid is not ours, even if we
  // believe we already hold size control: that belief is what used to keep the
  // oversized grid stuck after the peer went away.
  const needsGrid = () => !!grid && !!announced && (announced.cols !== grid.cols || announced.rows !== grid.rows);
  const activate = () => {
    if (!connected || !grid || !eligible()) return;
    if (active && !needsGrid()) return;
    send(JSON.stringify(grid));
    send(JSON.stringify({ action: 'take_size_control' }));
    active = true;
    announced = { ...grid };
  };
  return {
    activate,
    deactivate() { active = false; },
    connect() { connected = true; active = false; activate(); },
    disconnect() { connected = false; active = false; },
    update(next: TerminalGrid) {
      if (grid?.cols === next.cols && grid.rows === next.rows) return;
      grid = next;
      active = false;
      if (connected && eligible()) activate();
      else send(JSON.stringify(next));
    },
    observe(next: TerminalGrid) {
      announced = { ...next };
      if (grid && (next.cols !== grid.cols || next.rows !== grid.rows)) active = false;
    },
  };
}

export type AutomaticTerminalGeometry = ReturnType<typeof createAutomaticTerminalGeometry>;
