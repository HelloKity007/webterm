import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { Terminal, ITheme } from '@xterm/xterm';
import { isMobileBrowserEnvironment } from '../layout/mobileLayout';

const paletteKeys = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'] as const;
function terminalPaletteColor(index: number, theme: ITheme): string | undefined {
  if (index < 16) return theme[paletteKeys[index]];
  if (index < 232) {
    const n = index - 16, levels = [0, 95, 135, 175, 215, 255];
    return `rgb(${levels[Math.floor(n / 36)]}, ${levels[Math.floor(n / 6) % 6]}, ${levels[n % 6]})`;
  }
  const gray = 8 + (index - 232) * 10;
  return `rgb(${gray}, ${gray}, ${gray})`;
}
type Run = { text: string; style: CSSProperties };
function readTerminalRows(terminal: Terminal): Run[][] {
  const theme = terminal.options.theme || {};
  const buffer = terminal.buffer.active;
  // Shell scrollback belongs to xterm; alternate-screen history belongs to
  // the remote application and is requested by edge swipes below.
  return Array.from({ length: buffer.type === 'normal' ? buffer.length : terminal.rows }, (_, row) => {
    const line = buffer.getLine(row);
    const runs: Run[] = [];
    let lastStyle = '';
    for (let col = 0; line && col < terminal.cols; col++) {
      const cell = line.getCell(col);
      if (!cell || cell.getWidth() === 0) continue;
      const rgb = (value: number) => `#${value.toString(16).padStart(6, '0')}`;
      let color = cell.isFgRGB() ? rgb(cell.getFgColor()) : cell.isFgPalette() ? terminalPaletteColor(cell.getFgColor(), theme) : theme.foreground;
      let backgroundColor = cell.isBgRGB() ? rgb(cell.getBgColor()) : cell.isBgPalette() ? terminalPaletteColor(cell.getBgColor(), theme) : undefined;
      if (cell.isInverse()) [color, backgroundColor] = [backgroundColor || theme.background, color];
      const style: CSSProperties = { color, backgroundColor, fontWeight: cell.isBold() ? 'bold' : undefined,
        fontStyle: cell.isItalic() ? 'italic' : undefined, textDecoration: cell.isUnderline() ? 'underline' : undefined,
        opacity: cell.isDim() ? .6 : undefined, visibility: cell.isInvisible() ? 'hidden' : undefined };
      const key = JSON.stringify(style), text = cell.getChars() || ' ';
      if (runs.length && key === lastStyle) runs[runs.length - 1].text += text;
      else runs.push({ text, style });
      lastStyle = key;
    }
    // Trim only trailing padding; keep indentation, CJK and full line tails.
    while (runs.length) {
      runs[runs.length - 1].text = runs[runs.length - 1].text.trimEnd();
      if (runs[runs.length - 1].text) break;
      runs.pop();
    }
    return runs;
  });
}

export default function MobileTerminalReader({ terminalRef, revision, fontSize, onHistory }: {
  terminalRef: RefObject<Terminal | null>; revision: number; fontSize?: number; onHistory: (direction: 'up' | 'down') => void;
}) {
  const [snapshot, setSnapshot] = useState<{ rows: Run[][]; style: CSSProperties } | null>(null);
  const [reading, setReading] = useState(true);
  const textRef = useRef<HTMLDivElement>(null);
  const followBottom = useRef(true);
  const gesture = useRef<{ y: number; distance: number; sentAt: number } | null>(null);
  useLayoutEffect(() => {
    const element = textRef.current;
    if (element && followBottom.current) element.scrollTop = element.scrollHeight;
  }, [snapshot, reading]);
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || !isMobileBrowserEnvironment()) return;
    let frame: number | undefined;
    const update = () => {
      frame = undefined;
      if (window.innerWidth > 700) { setSnapshot(null); return; }
      setSnapshot({ rows: readTerminalRows(terminal), style: {
        fontSize: terminal.options.fontSize, fontFamily: terminal.options.fontFamily,
        color: terminal.options.theme?.foreground, backgroundColor: terminal.options.theme?.background,
      } });
    };
    const schedule = () => { if (frame === undefined) frame = requestAnimationFrame(update); };
    const subscriptions = [terminal.onWriteParsed(schedule), terminal.onResize(schedule)];
    window.addEventListener('resize', schedule);
    schedule();
    return () => { if (frame !== undefined) cancelAnimationFrame(frame); subscriptions.forEach(s => s.dispose()); window.removeEventListener('resize', schedule); };
  }, [terminalRef, revision]);
  if (!snapshot) return null;
  if (!reading) return <button className="mobile-reader-open" onClick={() => {
    terminalRef.current?.blur();
    setReading(true);
  }}>换行阅读</button>;
  return <section className="mobile-terminal-reader" aria-label="终端换行阅读" style={{ ...snapshot.style, fontSize: fontSize ?? snapshot.style.fontSize }}>
    <div className="mobile-reader-toolbar">
      <button onClick={() => { setReading(false); terminalRef.current?.focus(); }}>终端输入</button>
    </div>
    <div ref={textRef} className="mobile-reader-text" tabIndex={0} aria-label="自动换行的终端输出"
      onScroll={event => {
        const el = event.currentTarget;
        followBottom.current = el.scrollHeight - el.clientHeight - el.scrollTop < 2;
      }}
      onTouchStart={event => {
        gesture.current = event.touches.length === 1 ? { y: event.touches[0].clientY, distance: 0, sentAt: 0 } : null;
      }}
      onTouchMove={event => {
        const state = gesture.current;
        if (!state || event.touches.length !== 1) return;
        const delta = state.y - event.touches[0].clientY;
        state.y = event.touches[0].clientY;
        const el = event.currentTarget;
        const atEdge = delta < 0 ? el.scrollTop <= 1 : el.scrollHeight - el.clientHeight - el.scrollTop <= 1;
        if (!atEdge || terminalRef.current?.buffer.active.type !== 'alternate') { state.distance = 0; return; }
        if (Math.sign(state.distance) !== Math.sign(delta)) state.distance = 0;
        state.distance += delta;
        if (Math.abs(state.distance) >= 24 && performance.now() - state.sentAt >= 80) {
          followBottom.current = delta > 0;
          onHistory(delta < 0 ? 'up' : 'down');
          state.distance = 0;
          state.sentAt = performance.now();
        }
      }}
      onTouchEnd={() => { gesture.current = null; }}
      onTouchCancel={() => { gesture.current = null; }}>
      {snapshot.rows.map((runs, row) => <div className="mobile-reader-line" key={row}>
        {runs.map((run, index) => <span key={index} style={run.style}>{run.text}</span>)}
      </div>)}
    </div>
  </section>;
}
