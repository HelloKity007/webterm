import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';
import { colors, font } from '../../theme/tokens';

interface Props {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: number | string;
  height?: number | string;
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
        background: 'linear-gradient(150deg, rgba(38,43,67,0.98), rgba(22,25,40,0.98))', borderRadius: 16, width, height,
        maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100vh - 32px)', border: '1px solid rgba(122,162,247,0.28)', '--ui-scale': unscaled ? 1 : undefined,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 24px 70px rgba(0,0,0,0.48), inset 0 1px 0 rgba(255,255,255,0.05)',
      } as React.CSSProperties & Record<'--ui-scale', string | number | undefined>} onClick={(e) => e.stopPropagation()}>
        <div style={{
          padding: '18px 24px 14px', display: 'flex', borderBottom: '1px solid rgba(122,162,247,0.16)',
          justifyContent: 'space-between', alignItems: 'center', fontSize: font.xl2,
        }}>
          <span style={{ color: colors.accent, fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
          <button onClick={onClose} aria-label="关闭" style={{ background: 'rgba(15,18,32,0.42)', border: '1px solid rgba(122,162,247,0.16)', borderRadius: 7, color: colors.textMuted2, cursor: 'pointer', display: 'grid', placeItems: 'center', width: 30, height: 30 }}><Icon name="x" size={16} /></button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
