import type { TerminalGrid } from './terminalScaling';

// Measure candidates offscreen; never show binary-search steps in the terminal.
export function fitTerminalFont(grid: TerminalGrid, width: number, height: number, dpr: number,
  measure: (size: number) => { width: number; height: number }, webgl = true): number | null {
  if (![width, height, dpr].every(Number.isFinite) || width <= 2 || height <= 1 || dpr <= 0) return null;
  const fits = (size: number) => {
    const metric = measure(size);
    const cellWidth = webgl ? Math.floor(metric.width * dpr) : metric.width * dpr;
    return cellWidth > 0 && metric.height > 0 &&
      Math.round(grid.cols * cellWidth / dpr) <= width - 2 &&
      Math.round(grid.rows * Math.ceil(metric.height * dpr) / dpr) <= height - 1;
  };
  if (!fits(4)) return null;
  let low = 4, high = 64;
  for (let i = 0; i < 16; i++) {
    const mid = (low + high) / 2;
    if (fits(mid)) low = mid;
    else high = mid;
  }
  return low;
}
