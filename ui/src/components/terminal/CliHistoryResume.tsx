import { useEffect, useState, type RefObject } from 'react';
import type { Terminal } from '@xterm/xterm';
import { t } from '../../i18n';
import { claudeComposerBoundary } from './claudeComposerBoundary';
import { colors } from '../../theme/tokens';

export default function CliHistoryResume({ terminalRef, surfaceRef, active, revision, onResume }: {
  terminalRef: RefObject<Terminal | null>;
  surfaceRef: RefObject<HTMLDivElement | null>;
  active: boolean;
  revision: number;
  onResume: () => void;
}) {
  const [top, setTop] = useState<number | null>(null);
  useEffect(() => {
    const term = terminalRef.current;
    const surface = surfaceRef.current;
    if (!active || !term || !surface) return;
    let frame: number | undefined;
    const measure = () => {
      frame = undefined;
      const screen = term.element?.querySelector('.xterm-screen');
      const root = surface.parentElement;
      if (!screen || !root || surface.dataset.terminalMode !== 'cli') { setTop(null); return; }
      const buffer = term.buffer.active;
      const lines = Array.from({ length: term.rows }, (_, row) => buffer.getLine(buffer.viewportY + row)?.translateToString(true) || '');
      const boundary = claudeComposerBoundary(lines);
      if (boundary === null) { setTop(null); return; }
      if (lines.slice(Math.max(0, boundary - 4), boundary).some(line => /Jump to bottom.*ctrl.End/i.test(line))) {
        setTop(null); return;
      }
      const rect = screen.getBoundingClientRect();
      const position = rect.top - root.getBoundingClientRect().top + boundary * rect.height / term.rows - 27;
      // Anchor above the real composer; never guess a fixed panel corner.
      setTop(position >= 0 && position + 24 <= root.clientHeight ? position : null);
    };
    const schedule = () => { if (frame === undefined) frame = requestAnimationFrame(measure); };
    const render = term.onRender(schedule);
    const resize = new ResizeObserver(schedule);
    resize.observe(surface);
    surface.addEventListener('scroll', schedule);
    schedule();
    return () => {
      render.dispose(); resize.disconnect(); surface.removeEventListener('scroll', schedule);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [active, revision, terminalRef, surfaceRef]);
  if (!active || top === null) return null;
  return <button className="terminal-history-resume" type="button"
    onClick={onResume} aria-label={t('term_history_resume_input')}
    style={{ position: 'absolute', top, left: '50%', transform: 'translateX(-50%)', zIndex: 12,
      height: 24, padding: '0 10px', borderRadius: 12, border: '1px solid var(--c-border)',
      background: colors.bgInput, color: colors.text, cursor: 'pointer', fontSize: 12 }}>
    ↓ {t('term_history_resume_input')}
  </button>;
}
