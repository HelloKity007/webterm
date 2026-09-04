import { useEffect, useRef } from 'react';
import { colors, font } from '../../theme/tokens';

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

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [onClose]);

  return (
    <div ref={ref} style={{
      position: 'fixed', left: x, top: y, zIndex: 1000,
      background: colors.bgInput, border: '1px solid var(--c-border)', borderRadius: 4, overflow: 'hidden',
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
