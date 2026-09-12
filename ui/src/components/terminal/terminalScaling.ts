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
export const defaultSharedTerminalGrid: TerminalGrid = { cols: 69, rows: 23 };
// A 1920-wide desktop is the small side when paired with a 3440px authority.
// Narrower screens use the deterministic shared-grid baseline and adaptive
// glyph sizing.
export const smallViewportWidth = 2400;
// The measured eight-pane 1920x1080 layout previously squeezed a 104-column
// authority into each pane. 69 columns makes the glyphs about 104/69 = 1.51
// times larger. With two panel rows per viewport, 23 terminal rows balance the
// available width and height so content reaches the right side without hiding
// the final row beyond the panel edge.
export const smallViewportGridLimit: TerminalGrid = { cols: 69, rows: 23 };

export function sharedGridForViewport(announced: TerminalGrid, viewportWidth: number): TerminalGrid {
  if (viewportWidth >= smallViewportWidth) return announced;
  return {
    cols: Math.min(smallViewportGridLimit.cols, Math.max(announced.cols, defaultSharedTerminalGrid.cols)),
    rows: Math.min(smallViewportGridLimit.rows, Math.max(announced.rows, defaultSharedTerminalGrid.rows)),
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

export function constrainTerminalHeight(fontSize: number, lineHeight: number, renderedHeight: number, availableHeight: number): { fontSize: number; lineHeight: number } {
  if (!Number.isFinite(fontSize) || !Number.isFinite(lineHeight) || !Number.isFinite(renderedHeight) || !Number.isFinite(availableHeight) ||
      fontSize <= 0 || lineHeight < 1 || renderedHeight <= 0 || availableHeight <= 0 || renderedHeight <= availableHeight) {
    return { fontSize, lineHeight };
  }
  const correction = (availableHeight / renderedHeight) * 0.995;
  const correctedLineHeight = lineHeight * correction;
  if (correctedLineHeight >= 1) {
    return { fontSize, lineHeight: round(correctedLineHeight, 4) };
  }
  return { fontSize: round(fontSize * correction, 4), lineHeight: 1 };
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
  const readableFloor = Math.min(baseFontSize, 16);
  const fontSize = Math.max(readableFloor, baseFontSize * scale);
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
