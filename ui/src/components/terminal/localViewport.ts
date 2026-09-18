import { fitTerminalFont } from './terminalFontFit';

/** Font belongs to the local preference, never the peer's PTY dimensions. */
export function localTerminalFont(preferred: number): number {
  return Number.isFinite(preferred) ? Math.max(11, preferred) : 16;
}

export function localViewportFont(preferred: number, width: number, dpr: number,
  measure: (size: number) => { width: number; height: number }): number {
  // A consistent desktop column budget is independent of attached peers.
  // Row overflow scrolls locally and never participates in font fitting. A
  // two-column intermediate display has substantially wider panes than the
  // four-column large layout. Let those panes use the largest complete local
  // glyphs instead of leaving hundreds of pixels unused; this changes neither
  // the shared PTY grid nor another browser's font.
  // DOM uses fractional cell widths; WebGL rounds them down. Choose the largest
  // font safe for both, so deferred GPU installation/context loss cannot change
  // visible glyph size or renegotiate rows at unchanged local geometry.
  const widthFit = fitTerminalFont({ cols: 104, rows: 1 }, width, 1000, dpr, measure, false);
  return widthFit ?? localTerminalFont(preferred);
}

/** Consume a three-line notch locally before asking the remote app for history. */
export function localViewportScroll(top: number, height: number, contentHeight: number, cellHeight: number, lines: number): number {
  return Math.max(0, Math.min(Math.max(0, contentHeight - height), top + lines * cellHeight));
}

/** Reveal the input row without blindly hiding the top of a mostly empty shell. */
export function localViewportRevealRow(top: number, height: number, contentHeight: number, cellHeight: number, row: number): number {
  const rowTop = Math.max(0, row) * cellHeight;
  const next = rowTop < top ? rowTop : rowTop + cellHeight > top + height ? rowTop + cellHeight - height : top;
  return Math.max(0, Math.min(Math.max(0, contentHeight - height), next));
}
