import React, { useState, useRef, useEffect } from 'react';
import { colors, font } from '../../theme/tokens';

interface Props {
  value: string;
  onChange: (value: string) => void;
  style?: React.CSSProperties;
  children: React.ReactNode;
}

type OptionProps = { value: string; style?: React.CSSProperties; children?: React.ReactNode };

export default function CustomSelect({ value, onChange, style, children }: Props) {
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const opts = React.Children.toArray(children)
    .filter((child): child is React.ReactElement<OptionProps> => React.isValidElement<OptionProps>(child) && typeof child.props.value === 'string');
  const currentOpt = opts.find((option) => option.props.value === value);
  const label = currentOpt?.props?.children ?? (value || '');
  const optStyle = currentOpt?.props?.style;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleKey = (e: React.KeyboardEvent) => {
    if (!open) { if (e.key === 'Enter' || e.key === ' ') { setOpen(true); e.preventDefault(); } return; }
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'ArrowDown') { setFocusIdx((i) => Math.min(i + 1, opts.length - 1)); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { setFocusIdx((i) => Math.max(i - 1, 0)); e.preventDefault(); }
    else if (e.key === 'Enter') {
      if (focusIdx >= 0 && opts[focusIdx]) {
        const v = opts[focusIdx].props.value;
        onChange(v); setOpen(false); setFocusIdx(-1);
      }
      e.preventDefault();
    }
  };

  const selectValue = (v: string) => { onChange(v); setOpen(false); setFocusIdx(-1); };

  return (
    <div ref={ref} tabIndex={0} onKeyDown={handleKey}
      onClick={() => setOpen(!open)}
      style={{
        position: 'relative', outline: 'none', cursor: 'pointer', ...style,
        display: 'flex', alignItems: 'center', userSelect: 'none',
      }}>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...(optStyle || {}) }}>{label}</span>
      <span style={{ fontSize: font.xs, color: colors.textMuted, marginLeft: 4 }}>{open ? '▲' : '▼'}</span>
      {open && (
        <div style={{
          position: 'fixed', zIndex: 10001,
          background: colors.bgInput, border: '1px solid var(--c-border)', borderRadius: 4,
          overflow: 'overlay', maxHeight: 200, boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        }} ref={(el) => {
          if (el && ref.current) {
            const rect = ref.current.getBoundingClientRect();
            el.style.left = `${rect.left}px`;
            el.style.top = `${rect.bottom + 2}px`;
            el.style.width = `${rect.width}px`;
          }
        }}>
          {opts.map((opt, i) => (
            <div key={i}
              onClick={(e) => { e.stopPropagation(); selectValue(opt.props.value); }}
              onMouseEnter={() => setFocusIdx(i)}
              style={{
                padding: '6px 12px', fontSize: font.lg, cursor: 'pointer',
                background: i === focusIdx ? colors.accent : 'transparent',
                color: i === focusIdx ? colors.bg : (opt.props.style?.color || colors.text),
              }}>
              {opt.props.children}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
