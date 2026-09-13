import { describe, expect, it } from 'vitest';
import { localTerminalFont, localViewportFont, localViewportScroll } from './localViewport';
describe('peer-independent local viewport', () => {
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
    const small = localViewportFont(16, 924, 1, measure, true);
    expect(small).toBeLessThanOrEqual(16);
    expect(104 * Math.floor(measure(small).width)).toBeLessThanOrEqual(922);
    expect(localViewportFont(16, 924, 1, measure, true)).toBe(small);
  });
});
