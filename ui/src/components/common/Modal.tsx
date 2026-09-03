import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';
import { colors, font } from '../../theme/tokens';

interface Props {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
  height?: number;
  unscaled?: boolean;
}

export default function Modal({ title, onClose, children, width = 600, height = 400, unscaled }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: 'rgba(26,27,38,0.88)', borderRadius: 12, width, height, '--ui-scale': unscaled ? 1 : undefined,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px var(--c-border)',
      } as React.CSSProperties & Record<'--ui-scale', string | number | undefined>} onClick={(e) => e.stopPropagation()}>
        <div style={{
          padding: '16px 24px 8px', display: 'flex',
          justifyContent: 'space-between', alignItems: 'center', fontSize: font.xl2,
        }}>
          <span style={{ color: colors.accent, fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: colors.textMuted, cursor: 'pointer', display: 'flex', alignItems: 'center' }}><Icon name="x" size={18} /></button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
