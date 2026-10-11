import type { TerminalGrid } from './terminalScaling';

// User activation and local capacity changes can transfer control. Remote
// layout notifications only invalidate our remembered control, never reclaim it.
export function createAutomaticTerminalGeometry(send: (message: string) => void, eligible: () => boolean) {
  let grid: TerminalGrid | null = null;
  let connected = false;
  let active = false;
  const activate = () => {
    if (!connected || !grid || !eligible() || active) return;
    send(JSON.stringify(grid));
    send(JSON.stringify({ action: 'take_size_control' }));
    active = true;
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
      if (grid && (next.cols !== grid.cols || next.rows !== grid.rows)) active = false;
    },
  };
}

export type AutomaticTerminalGeometry = ReturnType<typeof createAutomaticTerminalGeometry>;
