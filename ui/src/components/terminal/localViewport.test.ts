import { describe, expect, it } from 'vitest';
import { localTerminalFont, localViewportScroll, localViewportRevealRow } from './localViewport';
describe('peer-independent local viewport', () => {
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
});
