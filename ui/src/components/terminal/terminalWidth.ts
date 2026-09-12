// xterm 6 rounds glyph widths and letterSpacing in device pixels. Choose a
// complete grid in that coordinate system, including its CSS canvas rounding.
export function fitTerminalColumns(available: number, rendered: number, cols: number, spacing: number, dpr: number) {
  if (![available, rendered, cols, spacing, dpr].every(Number.isFinite) || available <= 0 || rendered <= 0 || cols < 2 || dpr <= 0) return null;
  const cell = Math.round(rendered * dpr / cols);
  const glyph = Math.max(1, cell - Math.round(spacing));
  // Natural spacing takes priority over consuming every last pixel. Extra
  // spacing is doubled for CJK characters (two cells), visibly separating
  // adjacent Chinese glyphs. Reserve a small paint guard before the scrollbar.
  const usable = Math.max(0, available - 2);
  let count = Math.min(1000, Math.floor(usable * dpr / glyph));
  while (count > 1 && Math.round(count * glyph / dpr) > usable) count--;
  if (count < 2) return null;
  return { cols: count, letterSpacing: 0, gap: available - Math.round(count * glyph / dpr), cellWidth: glyph / dpr };
}
