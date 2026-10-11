// History replay owns the parser's grid, not the server's latest geometry.
// Keep metadata separate from discarded snapshot pixels and apply it once
// the logical-line replay and reader-anchor restoration have settled.
export function createTerminalReplayGeometry(deliver: (grid: Uint8Array) => void) {
  let pending: Uint8Array | null = null;
  return {
    receive(grid: Uint8Array, blocked: boolean) {
      if (blocked) {
        pending = grid.slice();
      } else {
        pending = null;
        deliver(grid);
      }
    },
    release() {
      const grid = pending;
      pending = null;
      if (grid) deliver(grid);
    },
    reset() { pending = null; },
  };
}
