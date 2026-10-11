import { describe, it, expect } from 'vitest';
import { desktopRequestedGrid } from './terminalScaling';
describe('desktop client geometry negotiation', () => {
  it.each([{ cols: 152, rows: 25 }, { cols: 115, rows: 44 }, { cols: 30, rows: 10 }])('keeps measured capacity %j without program or monitor caps', grid => {
    expect(desktopRequestedGrid(grid)).toEqual(grid);
  });
  it('retains protocol safety limits', () => {
    expect(desktopRequestedGrid({ cols: 1200, rows: 900 })).toEqual({ cols: 1000, rows: 499 });
    expect(desktopRequestedGrid({ cols: 0, rows: 0 })).toEqual({ cols: 2, rows: 1 });
  });
});
