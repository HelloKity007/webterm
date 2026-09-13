import { describe, expect, it } from 'vitest';
import { fitGridRemainder } from './terminalGridRemainder';

describe('fitGridRemainder', () => {
  it('uses one physical pixel per row when the complete grid and bottom guard fit', () => {
    const height = fitGridRemainder(480, 513, 32, 1);
    expect(Math.floor(15 * height)).toBe(16);
  });
  it('never consumes the bottom guard or expands by more than one pixel', () => {
    expect(fitGridRemainder(480, 512, 32, 1)).toBe(1);
    expect(Math.floor(15 * fitGridRemainder(480, 800, 32, 1))).toBe(16);
  });
  it('obeys canvas rounding across fractional DPRs', () => {
    for (const dpr of [1, 1.203125, 1.25, 2]) {
      const rendered = Math.round(32 * 18 / dpr);
      const available = Math.round(32 * 19 / dpr) + 1;
      const result = fitGridRemainder(rendered, available, 32, dpr);
      expect(Math.floor(18 * result)).toBe(19);
      expect(Math.round(32 * Math.floor(18 * result) / dpr)).toBeLessThanOrEqual(available - 1);
    }
  });
  it('leaves invalid or unmeasurable surfaces unchanged', () => {
    expect(fitGridRemainder(0, 500, 32, 1)).toBe(1);
    expect(fitGridRemainder(400, 500, 0, 1)).toBe(1);
    expect(fitGridRemainder(400, 500, 32, NaN)).toBe(1);
  });
});
