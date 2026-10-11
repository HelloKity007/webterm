import { describe, expect, it } from 'vitest';
import { desktopCapacity, scrollPosition } from './desktopTerminalViewport';

describe('desktop terminal geometry', () => {
  it('fills measured capacity above the old CLI cap without changing cells', () => {
    expect(desktopCapacity(1200, 640, 8, 16)).toEqual({ cols: 150, rows: 40 });
    expect(desktopCapacity(843, 511, 8, 17)).toEqual({ cols: 105, rows: 30 });
  });
  it('maps history and a taller live frame into one continuous scrollbar', () => {
    expect(scrollPosition(160, 100, 16)).toEqual({ line: 10, top: -1440 });
    expect(scrollPosition(1600, 100, 16)).toEqual({ line: 100, top: 0 });
    expect(scrollPosition(1728, 100, 16)).toEqual({ line: 100, top: 0 });
    expect(scrollPosition(48, 0, 16)).toEqual({ line: 0, top: 0 });
  });
});
