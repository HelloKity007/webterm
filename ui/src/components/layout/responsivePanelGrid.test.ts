import { describe, expect, it } from 'vitest';
import { buildCompactPanelGrid, compactPanelRowTemplate, shouldUseCompactDesktopGrid } from './responsivePanelGrid';

describe('responsivePanelGrid', () => {
  it('reflows eight panes into two columns and four scrollable rows on a compact desktop', () => {
    const paneIDs = Array.from({ length: 8 }, (_, index) => `pane${index + 1}`);
    expect(buildCompactPanelGrid(paneIDs)).toEqual({
      columns: 2,
      rows: 4,
      templateAreas: '"pane1 pane2" "pane3 pane4" "pane5 pane6" "pane7 pane8"',
    });
  });

  it('keeps the responsive rule off mobile and large desktops', () => {
    expect(shouldUseCompactDesktopGrid(false, 1920, 3000)).toBe(true);
    expect(shouldUseCompactDesktopGrid(false, 2808, 3000)).toBe(true);
    expect(shouldUseCompactDesktopGrid(false, 3440, 3000)).toBe(false);
    expect(shouldUseCompactDesktopGrid(false, 2999, 3000)).toBe(true);
    expect(shouldUseCompactDesktopGrid(false, 3000, 3000)).toBe(false);
    expect(shouldUseCompactDesktopGrid(true, 390, 3000)).toBe(false);
  });

  it('shows at most two panel rows and lets further rows overflow vertically', () => {
    expect(compactPanelRowTemplate(2)).toBe('repeat(2, minmax(0, 1fr))');
    expect(compactPanelRowTemplate(3)).toBe('repeat(3, calc(50% - 1px))');
    expect(compactPanelRowTemplate(4)).toBe('repeat(4, calc(50% - 1px))');
  });

  it('preserves pane order and leaves only the last odd slot empty', () => {
    expect(buildCompactPanelGrid(['a', 'b', 'c', 'd', 'e']).templateAreas).toBe('"a b" "c d" "e ."');
    expect(buildCompactPanelGrid(['a'])).toEqual({ columns: 1, rows: 1, templateAreas: '"a"' });
  });
});
