import { describe, expect, it } from 'vitest';
import { fitTerminalColumns } from './terminalWidth';

describe('terminal width at the actual scrollbar boundary', () => {
  it('keeps exact 1920 geometry and removes fractional-DPR overlap', () => {
    expect(fitTerminalColumns(608, 608, 76, 0, 1)?.letterSpacing).toBe(0);
    const fit = fitTerminalColumns(918.0779, 919, 79, 4, 1.203125)!;
    expect(fit.gap).toBeGreaterThanOrEqual(2);
    expect(fit.gap).toBeLessThan(3 + fit.cellWidth);
    expect(fit.letterSpacing).toBe(0);
  });
  it('never clips a column across widths and zoom levels', () => {
    for (const dpr of [1, 1.203125, 1.25, 1.5, 2]) {
      for (const available of [380, 608, 690.5, 832.75, 918.0779]) {
        const fit = fitTerminalColumns(available, Math.round(79 * 12 / dpr), 79, 3, dpr)!;
        expect(fit.gap).toBeGreaterThanOrEqual(2);
        expect(fit.letterSpacing).toBe(0);
        expect(fit.gap).toBeLessThan(3 + fit.cellWidth);
        expect(fit.cols).toBeGreaterThan(1);
      }
    }
  });
});
