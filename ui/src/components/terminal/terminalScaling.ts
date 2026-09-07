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

// Give a small-only client a deterministic shared grid. A larger client can
// still grow this target through the authoritative tmux title announcement.
export const defaultSharedTerminalGrid: TerminalGrid = { cols: 80, rows: 24 };
// Keep a 1920-wide desktop as the large authority. Narrower screens use the
// deterministic shared-grid baseline and adaptive glyph sizing.
export const smallViewportWidth = 1800;

export function sharedGridForViewport(announced: TerminalGrid, viewportWidth: number): TerminalGrid {
  if (viewportWidth >= smallViewportWidth) return announced;
  return {
    cols: Math.max(announced.cols, defaultSharedTerminalGrid.cols),
    rows: Math.max(announced.rows, defaultSharedTerminalGrid.rows),
  };
}

const sharedGridTitle = /^webterm-grid:(\d+)x(\d+)$/;

// tmux reports the window content height. WebTerm hides the tmux status line,
// so the reported row count is already the complete browser client view.
export function parseSharedTerminalGridTitle(title: string): TerminalGrid | null {
  const match = sharedGridTitle.exec(title);
  if (!match) return null;
  const cols = Number(match[1]);
  const windowRows = Number(match[2]);
  if (!Number.isInteger(cols) || !Number.isInteger(windowRows) || cols < 2 || cols > 1000 || windowRows < 1 || windowRows > 499) {
    return null;
  }
  return { cols, rows: windowRows };
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
  // Keep scaled glyphs readable on small panels instead of rasterising them
  // at 2–4px. The final screen-fit pass still adapts the grid dimensions.
  const fontSize = Math.max(9, baseFontSize * scale);
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
