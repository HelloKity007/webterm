import { describe, expect, it } from 'vitest';
import { calculateTerminalScale, defaultSharedTerminalGrid, parseSharedTerminalGridTitle, sharedGridForViewport } from './terminalScaling';

describe('parseSharedTerminalGridTitle', () => {
  it('converts the tmux content height to the complete client height', () => {
    expect(parseSharedTerminalGridTitle('webterm-grid:350x61')).toEqual({ cols: 350, rows: 62 });
  });

  it('ignores unrelated and unreasonable terminal titles', () => {
    expect(parseSharedTerminalGridTitle('claude')).toBeNull();
    expect(parseSharedTerminalGridTitle('webterm-grid:1x20')).toBeNull();
    expect(parseSharedTerminalGridTitle('webterm-grid:350x500')).toBeNull();
  });
});

describe('calculateTerminalScale', () => {
  it('provides a deterministic small-viewport baseline', () => {
    expect(defaultSharedTerminalGrid).toEqual({ cols: 240, rows: 60 });
    expect(sharedGridForViewport({ cols: 100, rows: 30 }, 1193)).toEqual({ cols: 240, rows: 60 });
    expect(sharedGridForViewport({ cols: 350, rows: 62 }, 1193)).toEqual({ cols: 350, rows: 62 });
    expect(sharedGridForViewport({ cols: 100, rows: 30 }, 1920)).toEqual({ cols: 240, rows: 60 });
    expect(sharedGridForViewport({ cols: 100, rows: 30 }, 2560)).toEqual({ cols: 100, rows: 30 });
  });
  it('keeps the configured font for a native-size shared grid', () => {
    expect(calculateTerminalScale({ cols: 350, rows: 62 }, { cols: 350, rows: 62 }, 14, 8)).toEqual({
      fontSize: 14,
      letterSpacing: 0,
      lineHeight: 1,
      scale: 1,
    });
  });

  it('fits a larger shared grid into a smaller browser without cropping rows', () => {
    const result = calculateTerminalScale({ cols: 191, rows: 46 }, { cols: 350, rows: 62 }, 14, 8);
    expect(result.fontSize).toBeCloseTo(7.64, 1);
    expect(result.letterSpacing).toBe(0);
    expect(result.lineHeight).toBeGreaterThan(1);
    expect(result.scale).toBeLessThan(1);
  });

  it('uses cell spacing when height is the limiting dimension', () => {
    const result = calculateTerminalScale({ cols: 240, rows: 30 }, { cols: 300, rows: 60 }, 14, 8);
    expect(result.fontSize).toBe(7);
    expect(result.letterSpacing).toBeGreaterThan(0);
    expect(result.lineHeight).toBe(1);
  });
});
