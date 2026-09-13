import { describe, it, expect } from 'vitest';
import { desktopRequestedGrid } from './terminalScaling';
describe('desktop client geometry negotiation', () => {
  it('keeps native large-screen geometry', () => {
    expect(desktopRequestedGrid({ cols: 92, rows: 36 }, 3440)).toEqual({ cols: 92, rows: 36 });
  });
  it('prevents wide compact panels from inflating the shared server width', () => {
    expect(desktopRequestedGrid({ cols: 152, rows: 25 }, 2860)).toEqual({ cols: 79, rows: 19 });
    expect(desktopRequestedGrid({ cols: 102, rows: 26 }, 1920)).toEqual({ cols: 76, rows: 19 });
  });
  it('does not grow a very small measured viewport', () => {
    expect(desktopRequestedGrid({ cols: 30, rows: 10 }, 1920)).toEqual({ cols: 30, rows: 10 });
  });
});
