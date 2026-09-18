import React, { useState, useRef, useEffect, useId } from 'react';
import { colors, font } from '../../theme/tokens';

interface Props {
  value: string;
  onChange: (value: string) => void;
  style?: React.CSSProperties;
  children: React.ReactNode;
  label?: string;
}

type OptionProps = { value: string; style?: React.CSSProperties; children?: React.ReactNode };

export default function CustomSelect({ value, onChange, style, children, label: accessibleLabel }: Props) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const opts = React.Children.toArray(children)
    .filter((child): child is React.ReactElement<OptionProps> => React.isValidElement<OptionProps>(child) && typeof child.props.value === 'string');
  const currentOpt = opts.find((option) => option.props.value === value);
  const label = currentOpt?.props?.children ?? (value || '');
  const optStyle = currentOpt?.props?.style;
  const controlLabel = accessibleLabel || (typeof label === 'string' || typeof label === 'number' ? String(label) : value) || 'Select option';
  const openOptions = () => { setFocusIdx(Math.max(0, opts.findIndex(option => option.props.value === value))); setOpen(true); };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleKey = (e: React.KeyboardEvent) => {
    if (!open) { if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) { openOptions(); e.preventDefault(); } return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); ref.current?.focus(); return; }
    if (e.key === 'Tab') { setOpen(false); return; }
    if (e.key === 'ArrowDown') { setFocusIdx((i) => Math.min(i + 1, opts.length - 1)); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { setFocusIdx((i) => Math.max(i - 1, 0)); e.preventDefault(); }
    else if (e.key === 'Home') { setFocusIdx(0); e.preventDefault(); }
    else if (e.key === 'End') { setFocusIdx(opts.length - 1); e.preventDefault(); }
    else if (e.key === 'Enter' || e.key === ' ') {
      if (focusIdx >= 0 && opts[focusIdx]) {
        const v = opts[focusIdx].props.value;
        selectValue(v);
      }
      e.preventDefault();
    }
  };

  const selectValue = (v: string) => { onChange(v); setOpen(false); setFocusIdx(-1); ref.current?.focus(); };

  useEffect(() => {
    if (open && focusIdx >= 0) document.getElementById(`${listId}-${focusIdx}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [focusIdx, listId, open]);

  return (
    <div ref={ref} tabIndex={0} role="combobox" aria-label={controlLabel} aria-haspopup="listbox" aria-expanded={open}
      aria-controls={open ? listId : undefined} aria-activedescendant={open && opts[focusIdx] ? `${listId}-${focusIdx}` : undefined}
      onKeyDown={handleKey} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
      onClick={() => { ref.current?.focus(); if (open) setOpen(false); else openOptions(); }}
      style={{
        position: 'relative', outlineOffset: 2, cursor: 'pointer', ...style,
        display: 'flex', alignItems: 'center', userSelect: 'none',
      }}>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...(optStyle || {}) }}>{label}</span>
      {/* A CSS triangle is deliberately decorative.  A Unicode arrow made axe
          mark the otherwise hidden glyph as an unverifiable contrast result,
          while the combobox itself already exposes its expanded state. */}
      <span aria-hidden="true" style={{
        width: 0, height: 0, marginLeft: 6, flex: '0 0 auto',
        borderLeft: '4px solid transparent', borderRight: '4px solid transparent',
        ...(open
          ? { borderBottom: `5px solid ${colors.textMuted}` }
          : { borderTop: `5px solid ${colors.textMuted}` }),
      }} />
      {open && (
        <div id={listId} role="listbox" aria-label={controlLabel} style={{
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
            <div key={i} id={`${listId}-${i}`} role="option" aria-selected={opt.props.value === value}
              onMouseDown={(event) => event.preventDefault()}
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
