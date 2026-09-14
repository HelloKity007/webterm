import { useEffect, useRef } from 'react';
import type { LayoutNode } from './layoutPersistence';
import { layoutDividers, resizeLayoutDivider } from './layoutDividers';

interface Props {
  root: LayoutNode;
  container: React.RefObject<HTMLDivElement | null>;
  onPreview: (root: LayoutNode) => void;
  onDragStart: () => void;
  onCommit: (root: LayoutNode) => void;
}

export default function LayoutDividerOverlay({ root, container, onPreview, onDragStart, onCommit }: Props) {
  const latestRoot = useRef(root);
  useEffect(() => { latestRoot.current = root; }, [root]);
  return <>
    {layoutDividers(root).map((divider) => (
      <div key={divider.key} role="separator" aria-orientation={divider.direction === 'horizontal' ? 'vertical' : 'horizontal'}
        aria-label="调整 Panel 大小" tabIndex={0} data-layout-divider={divider.key}
        style={{
          position: 'absolute', zIndex: 8, touchAction: 'none', outline: 'none',
          cursor: divider.direction === 'horizontal' ? 'col-resize' : 'row-resize',
          ...(divider.direction === 'horizontal'
            ? { left: `calc(${divider.position * 100}% - 4px)`, top: `${divider.crossStart * 100}%`, width: 9, height: `${divider.crossSize * 100}%` }
            : { top: `calc(${divider.position * 100}% - 4px)`, left: `${divider.crossStart * 100}%`, height: 9, width: `${divider.crossSize * 100}%` }),
        }}
        onKeyDown={(event) => {
          const backward = divider.direction === 'horizontal' ? event.key === 'ArrowLeft' : event.key === 'ArrowUp';
          const forward = divider.direction === 'horizontal' ? event.key === 'ArrowRight' : event.key === 'ArrowDown';
          if (!backward && !forward) return;
          event.preventDefault();
          onCommit(resizeLayoutDivider(latestRoot.current, divider.path, divider.index, divider.pairShare + (forward ? 0.02 : -0.02)));
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          onDragStart();
          let frame: number | null = null;
          let lastShare = divider.pairShare;
          const calculate = (clientX: number, clientY: number) => {
            const rect = container.current?.getBoundingClientRect();
            if (!rect || !rect.width || !rect.height) return lastShare;
            const coordinate = divider.direction === 'horizontal' ? (clientX - rect.left) / rect.width : (clientY - rect.top) / rect.height;
            return Math.max(0.1, Math.min(0.9, (coordinate - divider.pairStart) / divider.pairSize));
          };
          const move = (moveEvent: PointerEvent) => {
            lastShare = calculate(moveEvent.clientX, moveEvent.clientY);
            if (frame !== null) return;
            frame = requestAnimationFrame(() => {
              frame = null;
              const next = resizeLayoutDivider(latestRoot.current, divider.path, divider.index, lastShare);
              latestRoot.current = next;
              onPreview(next);
            });
          };
          const finish = (upEvent: PointerEvent) => {
            if (frame !== null) cancelAnimationFrame(frame);
            frame = null;
            lastShare = calculate(upEvent.clientX, upEvent.clientY);
            const next = resizeLayoutDivider(latestRoot.current, divider.path, divider.index, lastShare);
            latestRoot.current = next;
            onCommit(next);
            event.currentTarget.removeEventListener('pointermove', move);
            event.currentTarget.removeEventListener('pointerup', finish);
            event.currentTarget.removeEventListener('pointercancel', finish);
          };
          event.currentTarget.addEventListener('pointermove', move);
          event.currentTarget.addEventListener('pointerup', finish);
          event.currentTarget.addEventListener('pointercancel', finish);
        }}>
        <span aria-hidden="true" style={{
          position: 'absolute', background: 'rgba(122,162,247,0.55)', borderRadius: 1,
          ...(divider.direction === 'horizontal' ? { width: 1, top: 0, bottom: 0, left: 4 } : { height: 1, left: 0, right: 0, top: 4 }),
        }} />
      </div>
    ))}
  </>;
}
