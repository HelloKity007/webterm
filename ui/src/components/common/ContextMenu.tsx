import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { colors, font } from '../../theme/tokens';
import { MENU_EDGE_MARGIN, resolveContextMenuPosition } from './contextMenuPosition';

interface MenuItem {
  label: string;
  action: () => void | Promise<void>;
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

export default function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [onClose]);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const resolved = resolveContextMenuPosition(
      { x, y },
      { width: rect.width, height: rect.height },
      { width: window.innerWidth, height: window.innerHeight },
    );
    setPosition((previous) => (
      previous && previous.left === resolved.left && previous.top === resolved.top ? previous : resolved
    ));
  }, [x, y]);

  return (
    <div ref={ref} style={{
      position: 'fixed', left: position?.left ?? x, top: position?.top ?? y, zIndex: 1000,
      // Measured before the first paint, so the unclamped cursor anchor is
      // never shown even briefly when the menu would open off screen.
      visibility: position ? 'visible' : 'hidden',
      background: colors.bgInput, border: '1px solid var(--c-border)', borderRadius: 4,
      overflowX: 'hidden', overflowY: 'auto', maxHeight: `calc(100vh - ${MENU_EDGE_MARGIN * 2}px)`,
      minWidth: 140, boxShadow: '0 0 16px rgba(0,0,0,0.6), 0 0 4px rgba(0,255,255,0.1)',
    }}>
      {items.map((item, i) => (
        <div key={i} onClick={async () => {
          try {
            await item.action();
          } finally {
            onClose();
          }
        }}
          style={{
            padding: '8px 16px', fontSize: font.md, color: colors.text, cursor: 'pointer', whiteSpace: 'nowrap',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = colors.border)}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
          {item.label}
        </div>
      ))}
    </div>
  );
}
