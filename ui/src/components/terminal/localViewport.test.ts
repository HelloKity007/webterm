import { describe, expect, it } from 'vitest';
import { localTerminalFont, localViewportFont, localViewportScroll, localViewportRevealRow } from './localViewport';
describe('peer-independent local viewport', () => {
  it('chooses a font that fits fractional cells as well as quantized GPU cells', () => {
    const measure = (size: number) => ({ width: size * 0.6, height: size * 1.2 });
    for (const width of [843, 929, 1420]) {
      const gpu = localViewportFont(16, width, 1, measure);
      expect(104 * measure(gpu).width).toBeLessThanOrEqual(width - 1.5);
      expect(104 * Math.floor(measure(gpu).width)).toBeLessThanOrEqual(width - 1.5);
    }
  });
  it('reveals early shell input instead of scrolling to unused bottom rows', () => {
    expect(localViewportRevealRow(173, 511, 684, 19, 0)).toBe(0);
    expect(localViewportRevealRow(0, 511, 684, 19, 3)).toBe(0);
    expect(localViewportRevealRow(0, 511, 684, 19, 35)).toBe(173);
    expect(localViewportRevealRow(173, 511, 684, 19, 32)).toBe(173);
  });
  it('uses only local preference for glyph size', () => {
    expect(localTerminalFont(16)).toBe(16);
    expect(localTerminalFont(18)).toBe(18);
    expect(localTerminalFont(NaN)).toBe(16);
  });
  it('moves three rows and clamps only at an edge', () => {
    expect(localViewportScroll(160, 511, 672, 21, -3)).toBe(97);
    expect(localViewportScroll(20, 511, 672, 21, -3)).toBe(0);
    expect(localViewportScroll(120, 511, 672, 21, 3)).toBe(161);
    expect(localViewportScroll(0, 700, 672, 21, 3)).toBe(0);
  });
  it('fits a local column budget without consulting peer dimensions', () => {
    const measure = (size: number) => ({ width: size * 0.6, height: size * 1.2 });
    const small = localViewportFont(16, 924, 1, measure);
    expect(small).toBeLessThanOrEqual(16);
    expect(104 * Math.floor(measure(small).width)).toBeLessThanOrEqual(922);
    expect(localViewportFont(16, 924, 1, measure)).toBe(small);
    expect(localViewportFont(16, 1420, 1, measure)).toBeGreaterThan(16);
  });
});
