import type { Direction, LayoutNode } from './layoutPersistence';

export interface LayoutDivider {
  key: string;
  path: number[];
  index: number;
  direction: Direction;
  position: number;
  crossStart: number;
  crossSize: number;
  pairStart: number;
  pairSize: number;
  pairShare: number;
}

function normalized(ratios: number[]): number[] {
  const sum = ratios.reduce((total, ratio) => total + ratio, 0);
  return sum > 0 ? ratios.map((ratio) => ratio / sum) : ratios.map(() => 1 / ratios.length);
}

export function layoutDividers(root: LayoutNode): LayoutDivider[] {
  const result: LayoutDivider[] = [];
  const visit = (node: LayoutNode, path: number[], x: number, y: number, width: number, height: number) => {
    if (node.type === 'leaf') return;
    const ratios = normalized(node.ratios);
    let offset = 0;
    for (let index = 0; index < node.children.length; index++) {
      const ratio = ratios[index];
      if (index < node.children.length - 1) {
        const pairSize = ratio + ratios[index + 1];
        result.push({
          key: `${path.join('.') || 'root'}:${index}`,
          path: [...path], index, direction: node.direction,
          position: node.direction === 'horizontal' ? x + width * (offset + ratio) : y + height * (offset + ratio),
          crossStart: node.direction === 'horizontal' ? y : x,
          crossSize: node.direction === 'horizontal' ? height : width,
          pairStart: node.direction === 'horizontal' ? x + width * offset : y + height * offset,
          pairSize: (node.direction === 'horizontal' ? width : height) * pairSize,
          pairShare: ratio / pairSize,
        });
      }
      if (node.direction === 'horizontal') visit(node.children[index], [...path, index], x + width * offset, y, width * ratio, height);
      else visit(node.children[index], [...path, index], x, y + height * offset, width, height * ratio);
      offset += ratio;
    }
  };
  visit(root, [], 0, 0, 1, 1);
  return result;
}

export function resizeLayoutDivider(root: LayoutNode, path: number[], index: number, pairShare: number): LayoutNode {
  const next = structuredClone(root);
  let node = next;
  for (const childIndex of path) {
    if (node.type !== 'split' || !node.children[childIndex]) return root;
    node = node.children[childIndex];
  }
  if (node.type !== 'split' || index < 0 || index + 1 >= node.ratios.length) return root;
  const pairTotal = node.ratios[index] + node.ratios[index + 1];
  const share = Math.max(0.1, Math.min(0.9, pairShare));
  node.ratios[index] = pairTotal * share;
  node.ratios[index + 1] = pairTotal * (1 - share);
  const total = node.ratios.reduce((sum, ratio) => sum + ratio, 0);
  node.ratios = node.ratios.map((ratio) => ratio / total);
  return next;
}
