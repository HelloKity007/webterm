import type { LayoutNode } from './layoutPersistence';

function eightPaneGrid(paneIDs: string[]): LayoutNode {
  const row = (ids: string[]): LayoutNode => ({
    type: 'split',
    direction: 'horizontal',
    ratios: [0.25, 0.25, 0.25, 0.25],
    children: ids.map((id) => ({ type: 'leaf', id })),
  });
  return {
    type: 'split',
    direction: 'vertical',
    ratios: [0.5, 0.5],
    children: [row(paneIDs.slice(0, 4)), row(paneIDs.slice(4, 8))],
  };
}

export function panelGrid(paneIDs: string[], columns: number): LayoutNode | null {
  if (paneIDs.length === 0 || columns < 1 || !Number.isInteger(columns) || new Set(paneIDs).size !== paneIDs.length) return null;
  if (paneIDs.length === 1) return { type: 'leaf', id: paneIDs[0] };
  const rows: LayoutNode[] = [];
  for (let offset = 0; offset < paneIDs.length; offset += columns) {
    const ids = paneIDs.slice(offset, offset + columns);
    rows.push(ids.length === 1 ? { type: 'leaf', id: ids[0] } : {
      type: 'split', direction: 'horizontal', ratios: ids.map(() => 1 / ids.length),
      children: ids.map((id) => ({ type: 'leaf', id })),
    });
  }
  if (rows.length === 1) return rows[0];
  return { type: 'split', direction: 'vertical', ratios: rows.map(() => 1 / rows.length), children: rows };
}

export function replaceLeafWithEightPaneGrid(
  root: LayoutNode,
  targetID: string,
  paneIDs: string[],
): LayoutNode | null {
  if (paneIDs.length !== 8 || paneIDs[0] !== targetID || new Set(paneIDs).size !== 8) return null;
  const replacement = eightPaneGrid(paneIDs);

  const replace = (node: LayoutNode): [LayoutNode, boolean] => {
    if (node.type === 'leaf') return node.id === targetID ? [replacement, true] : [{ ...node }, false];
    let replaced = false;
    const children = node.children.map((child) => {
      const [next, childReplaced] = replace(child);
      replaced ||= childReplaced;
      return next;
    });
    return [{ ...node, ratios: [...node.ratios], children }, replaced];
  };

  const [nextRoot, replaced] = replace(root);
  return replaced ? nextRoot : null;
}
