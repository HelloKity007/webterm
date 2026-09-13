import { describe, expect, it } from 'vitest';
import { fitTerminalFont } from './terminalFontFit';

describe('offscreen exact-grid font fitting', () => {
  const measure = (size: number) => ({ width: size * .6, height: size * 1.3 });
  it('finds the largest complete grid at fractional DPR without changing rows/cols', () => {
    for (const dpr of [1, 1.203125, 1.25, 2]) {
      const grid = { cols: 152, rows: 32 };
      const size = fitTerminalFont(grid, 925, 510, dpr, measure)!;
      expect(Math.round(152 * Math.floor(measure(size).width * dpr) / dpr)).toBeLessThanOrEqual(923);
      expect(Math.round(32 * Math.ceil(measure(size).height * dpr) / dpr)).toBeLessThanOrEqual(509);
      const next = measure(size + .01);
      expect(Math.round(152 * Math.floor(next.width * dpr) / dpr) > 923 || Math.round(32 * Math.ceil(next.height * dpr) / dpr) > 509).toBe(true);
      expect(grid).toEqual({ cols: 152, rows: 32 });
    }
  });
  it('accounts for fractional DOM-renderer character widths', () => {
    const size = fitTerminalFont({cols:152, rows:32}, 925, 510, 1.25, measure, false)!;
    expect(Math.round(152 * measure(size).width)).toBeLessThanOrEqual(923);
  });
  it('does not invent a fit for hidden or impossible surfaces', () => {
    expect(fitTerminalFont({cols:152,rows:32},0,510,1,measure)).toBeNull();
    expect(fitTerminalFont({cols:152,rows:32},20,20,1,measure)).toBeNull();
  });
});
