export function horizontalTabScrollTarget(scrollLeft: number, clientWidth: number, scrollWidth: number, deltaX: number, deltaY: number, deltaMode: number): number | null {
  if (scrollWidth <= clientWidth) return null;
  const primaryDelta = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
  const pixelsPerUnit = deltaMode === 1 ? 24 : deltaMode === 2 ? clientWidth : 1;
  const target = Math.max(0, Math.min(scrollWidth - clientWidth, scrollLeft + primaryDelta * pixelsPerUnit));
  return target === scrollLeft ? null : target;
}
