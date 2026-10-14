export const MENU_EDGE_MARGIN = 8;

// A context menu opens down/right from the click point, so anchoring it at the
// cursor leaves the lower half unreachable when the panel is near the bottom of
// the window. Flip to the opposite side when the menu fits there, then clamp so
// a menu wider or taller than the remaining space still stays on screen.
export function resolveContextMenuPosition(
  anchor: { x: number; y: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = MENU_EDGE_MARGIN,
): { left: number; top: number } {
  const flipX = anchor.x + size.width + margin > viewport.width && anchor.x - size.width >= margin;
  const flipY = anchor.y + size.height + margin > viewport.height && anchor.y - size.height >= margin;
  const left = flipX ? anchor.x - size.width : anchor.x;
  const top = flipY ? anchor.y - size.height : anchor.y;
  return {
    left: Math.min(Math.max(left, margin), Math.max(margin, viewport.width - size.width - margin)),
    top: Math.min(Math.max(top, margin), Math.max(margin, viewport.height - size.height - margin)),
  };
}
