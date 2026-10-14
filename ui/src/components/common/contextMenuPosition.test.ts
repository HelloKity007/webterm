import { describe, expect, it } from 'vitest';
import { resolveContextMenuPosition } from './contextMenuPosition';

describe('resolveContextMenuPosition', () => {
  const viewport = { width: 1000, height: 800 };
  const size = { width: 200, height: 120 };

  it('anchors at the click point when the menu fits down and right', () => {
    expect(resolveContextMenuPosition({ x: 100, y: 200 }, size, viewport)).toEqual({ left: 100, top: 200 });
  });

  it('flips above the click point when the menu would overflow the bottom', () => {
    expect(resolveContextMenuPosition({ x: 100, y: 750 }, size, viewport)).toEqual({ left: 100, top: 630 });
  });

  it('flips left of the click point when the menu would overflow the right edge', () => {
    expect(resolveContextMenuPosition({ x: 950, y: 200 }, size, viewport)).toEqual({ left: 750, top: 200 });
  });

  it('clamps to the opposite edge when the menu cannot flip to the other side', () => {
    // A 780px menu clicked near the top overflows the bottom and has no room to
    // open upward either, so it pins 8px clear of the bottom edge.
    expect(resolveContextMenuPosition({ x: 40, y: 30 }, { width: 200, height: 780 }, viewport)).toEqual({ left: 40, top: 12 });
  });

  it('keeps a menu larger than the viewport inside the margins', () => {
    expect(resolveContextMenuPosition({ x: 0, y: 0 }, { width: 1200, height: 900 }, viewport)).toEqual({ left: 8, top: 8 });
  });
});
