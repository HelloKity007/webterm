import { describe, expect, it, vi } from 'vitest';
import { createTerminalReplayGeometry } from './terminalReplayGeometry';

describe('terminal replay geometry', () => {
  it('delivers reader metadata without replaying captured pixels', () => {
    const deliver = vi.fn();
    const geometry = createTerminalReplayGeometry(deliver);
    const grid = new TextEncoder().encode('\x1b]2;webterm-grid:77x34\x07');
    geometry.receive(grid, false);
    expect(deliver).toHaveBeenCalledExactlyOnceWith(grid);
    geometry.release();
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it('retains only the latest announcement until history parsing finishes', () => {
    const deliver = vi.fn();
    const geometry = createTerminalReplayGeometry(deliver);
    geometry.receive(new Uint8Array([77]), true);
    const latest = new Uint8Array([93]);
    geometry.receive(latest, true);
    latest[0] = 1;
    expect(deliver).not.toHaveBeenCalled();
    geometry.release();
    expect(deliver).toHaveBeenCalledExactlyOnceWith(new Uint8Array([93]));
    geometry.release();
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it('never replays an old pending grid after a newer unblocked grid', () => {
    const deliver = vi.fn();
    const geometry = createTerminalReplayGeometry(deliver);
    geometry.receive(new Uint8Array([77]), true);
    geometry.receive(new Uint8Array([93]), false);
    geometry.release();
    expect(deliver).toHaveBeenCalledExactlyOnceWith(new Uint8Array([93]));
  });

  it('discards pending metadata when the terminal instance is replaced', () => {
    const deliver = vi.fn();
    const geometry = createTerminalReplayGeometry(deliver);
    geometry.receive(new Uint8Array([77]), true);
    geometry.reset();
    geometry.release();
    expect(deliver).not.toHaveBeenCalled();
  });
});
