// xterm 6 rounds glyph widths and letterSpacing in device pixels. Choose a
// complete grid in that coordinate system, including its CSS canvas rounding.
export function fitTerminalColumns(available: number, rendered: number, cols: number, spacing: number, dpr: number) {
  if (![available, rendered, cols, spacing, dpr].every(Number.isFinite) || available <= 0 || rendered <= 0 || cols < 2 || dpr <= 0) return null;
  const cell = Math.round(rendered * dpr / cols);
  const glyph = Math.max(1, cell - Math.round(spacing));
  let best: { cols: number; letterSpacing: number; gap: number; cost: number } | null = null;
  for (let width = glyph; width <= Math.max(cell, glyph + 4); width++) {
    let count = Math.min(1000, Math.floor(available * dpr / width));
    while (count > 1 && Math.round(count * width / dpr) > available) count--;
    if (count < 2) continue;
    const gap = available - Math.round(count * width / dpr);
    const cost = Math.abs(count - cols) / cols + Math.abs(width - cell) / cell;
    if (!best || gap < best.gap - 0.01 || (Math.abs(gap - best.gap) < 0.01 && cost < best.cost)) {
      best = { cols: count, letterSpacing: width - glyph, gap, cost };
    }
  }
  return best;
}
