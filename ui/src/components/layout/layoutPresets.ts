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
