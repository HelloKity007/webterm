export interface TerminalGrid {
  cols: number;
  rows: number;
}

export interface TerminalScaleOptions {
  fontSize: number;
  letterSpacing: number;
  lineHeight: number;
  scale: number;
}

const sharedGridTitle = /^webterm-grid:(\d+)x(\d+)$/;

// tmux reports the window content height. WebTerm forces the tmux status line
// on, so the browser PTY needs one additional row for the complete client view.
export function parseSharedTerminalGridTitle(title: string): TerminalGrid | null {
  const match = sharedGridTitle.exec(title);
  if (!match) return null;
  const cols = Number(match[1]);
  const windowRows = Number(match[2]);
  if (!Number.isInteger(cols) || !Number.isInteger(windowRows) || cols < 2 || cols > 1000 || windowRows < 1 || windowRows > 499) {
    return null;
  }
  return { cols, rows: windowRows + 1 };
}

function round(value: number, precision = 3): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

export function calculateTerminalScale(
  nativeGrid: TerminalGrid,
  sharedGrid: TerminalGrid,
  baseFontSize: number,
  nativeCellWidth: number,
): TerminalScaleOptions {
  const widthScale = nativeGrid.cols / sharedGrid.cols;
  const heightScale = nativeGrid.rows / sharedGrid.rows;
  const scale = Math.min(1, widthScale, heightScale);

  if (!Number.isFinite(scale) || scale <= 0 || nativeCellWidth <= 0) {
    return { fontSize: baseFontSize, letterSpacing: 0, lineHeight: 1, scale: 1 };
  }

  // Scale glyphs uniformly. Any spare width/height caused by different screen
  // aspect ratios is distributed as cell spacing, so all rows and columns fit
  // without stretching the glyphs themselves.
  const fontSize = Math.max(4, baseFontSize * scale);
  const effectiveScale = fontSize / baseFontSize;
  const fitMargin = scale < 1 ? 0.99 : 1;
  const letterSpacing = Math.max(0, nativeCellWidth * (widthScale * fitMargin - effectiveScale));
  const lineHeight = Math.max(1, heightScale * fitMargin / effectiveScale);

  return {
    fontSize: round(fontSize),
    letterSpacing: round(letterSpacing),
    lineHeight: round(lineHeight),
    scale: round(effectiveScale),
  };
}
