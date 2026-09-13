/** Consume at most one physical pixel per row without changing glyphs/grid. */
export function fitGridRemainder(renderedHeight: number, availableHeight: number, rows: number, dpr: number): number {
  if (![renderedHeight, availableHeight, rows, dpr].every(Number.isFinite) || renderedHeight <= 0 || rows < 1 || dpr <= 0) return 1;
  const cell = Math.round(renderedHeight * dpr / rows);
  if (cell < 1) return 1;
  const nextHeight = Math.round(rows * (cell + 1) / dpr);
  if (nextHeight > availableHeight - 1) return 1;
  // xterm floors cell * lineHeight. A tiny epsilon defeats float underflow.
  return (cell + 1.000001) / cell;
}
