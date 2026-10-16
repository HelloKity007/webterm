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

  it('snaps the scrollbar tail to the live bottom instead of one line above it', () => {
    // 19 rows of 21px inside a 406px surface leaves a 7px blank tail, so the
    // end of the scrollbar is 7px below baseY * cellHeight. Flooring that
    // offset parked the viewport one row above the prompt and left the input
    // row unpainted until something forced a fresh reveal.
    const cellHeight = 21;
    const baseY = 508;
    const maxTop = baseY * cellHeight + 19 * cellHeight - 406;
    expect(maxTop).toBeLessThan(baseY * cellHeight);
    expect(scrollPosition(maxTop, baseY, cellHeight, maxTop)).toEqual({ line: baseY, top: 0 });
    expect(scrollPosition(maxTop - 1, baseY, cellHeight, maxTop)).toEqual({ line: baseY, top: 0 });
    // A real mid-history position still maps one-to-one.
    expect(scrollPosition(400 * cellHeight, baseY, cellHeight, maxTop)).toEqual({ line: 400, top: (400 - baseY) * cellHeight });
  });
});
