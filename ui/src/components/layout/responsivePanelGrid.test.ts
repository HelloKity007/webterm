import { describe, expect, it } from 'vitest';
import { buildCompactPanelGrid, compactPanelRowTemplate, shouldUseCompactDesktopGrid } from './responsivePanelGrid';

describe('responsivePanelGrid', () => {
  it('reflows eight panes into at most three columns on a compact desktop', () => {
    const paneIDs = Array.from({ length: 8 }, (_, index) => `pane${index + 1}`);
    expect(buildCompactPanelGrid(paneIDs)).toEqual({
      columns: 3,
      rows: 3,
      templateAreas: '"pane1 pane2 pane3" "pane4 pane5 pane6" "pane7 pane8 ."',
    });
  });

  it('keeps the responsive rule off mobile and large desktops', () => {
    expect(shouldUseCompactDesktopGrid(false, 1920, 3000)).toBe(true);
    expect(shouldUseCompactDesktopGrid(false, 2808, 3000)).toBe(true);
    expect(shouldUseCompactDesktopGrid(false, 3440, 3000)).toBe(false);
    expect(shouldUseCompactDesktopGrid(true, 390, 3000)).toBe(false);
  });

  it('shows at most two panel rows and lets further rows overflow vertically', () => {
    expect(compactPanelRowTemplate(2)).toBe('repeat(2, minmax(0, 1fr))');
    expect(compactPanelRowTemplate(3)).toBe('repeat(3, calc(50% - 1px))');
  });
});
