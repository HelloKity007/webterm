export interface ResponsivePanelGrid {
  columns: number;
  rows: number;
  templateAreas: string;
}

export const compactDesktopMaxPanelColumns = 2;
export const compactDesktopVisiblePanelRows = 2;

export function shouldUseCompactDesktopGrid(mobile: boolean, viewportWidth: number, breakpoint: number): boolean {
  return !mobile && viewportWidth < breakpoint;
}

// A 2-column grid on a wide, short display makes each terminal nearly three
// times wider than it is tall. A CLI frame cannot fill that shape with normal
// glyphs while also keeping its composer visible. Use four taller cells and
// let the page scroll to the remaining rows.
export function shouldUseWideShortDesktopGrid(mobile: boolean, viewportWidth: number, viewportHeight: number, breakpoint: number): boolean {
  return !mobile && viewportWidth >= 2600 && viewportWidth < breakpoint && viewportHeight <= 1100;
}

export function buildCompactPanelGrid(paneIDs: string[], maxColumns = compactDesktopMaxPanelColumns): ResponsivePanelGrid {
  const columns = Math.max(1, Math.min(maxColumns, paneIDs.length));
  const rows = Math.max(1, Math.ceil(paneIDs.length / columns));
  const areas = Array.from({ length: rows }, () => Array(columns).fill('.'));
  paneIDs.forEach((id, index) => {
    areas[Math.floor(index / columns)][index % columns] = id;
  });
  return {
    columns,
    rows,
    templateAreas: areas.map((row) => `"${row.join(' ')}"`).join(' '),
  };
}

export function compactPanelRowTemplate(rowCount: number, rowGap = 2, visibleRows = compactDesktopVisiblePanelRows): string {
  if (rowCount <= visibleRows) return `repeat(${Math.max(1, rowCount)}, minmax(0, 1fr))`;
  const gapShare = rowGap * (visibleRows - 1) / visibleRows;
  return `repeat(${rowCount}, calc(${100 / visibleRows}% - ${gapShare}px))`;
}
