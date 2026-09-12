export interface ResponsivePanelGrid {
  columns: number;
  rows: number;
  templateAreas: string;
}

export const compactDesktopMaxPanelColumns = 3;
export const compactDesktopVisiblePanelRows = 2;

export function shouldUseCompactDesktopGrid(mobile: boolean, viewportWidth: number, breakpoint: number): boolean {
  return !mobile && viewportWidth < breakpoint;
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

export function compactPanelRowTemplate(rowCount: number, rowGap = 2): string {
  if (rowCount <= compactDesktopVisiblePanelRows) return `repeat(${Math.max(1, rowCount)}, minmax(0, 1fr))`;
  const gapShare = rowGap * (compactDesktopVisiblePanelRows - 1) / compactDesktopVisiblePanelRows;
  return `repeat(${rowCount}, calc(${100 / compactDesktopVisiblePanelRows}% - ${gapShare}px))`;
}
