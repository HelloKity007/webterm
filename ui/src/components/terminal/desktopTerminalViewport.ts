import type { Terminal } from '@xterm/xterm';

export function desktopCapacity(width: number, height: number, cellWidth: number, cellHeight: number) {
  return {
    cols: Math.max(2, Math.min(1000, Math.floor(width / cellWidth))),
    rows: Math.max(1, Math.min(499, Math.floor(height / cellHeight))),
  };
}

export function scrollPosition(pixels: number, baseY: number, cellHeight: number) {
  const line = Math.max(0, Math.min(baseY, Math.floor(pixels / cellHeight)));
  return { line, top: (line - baseY) * cellHeight };
}

/** One native scroll surface spans both normal-buffer history and live rows.
 * xterm still parses the server's exact grid; only its public scroll API is used.
 * A spacer represents offscreen history, while the rendered viewport is moved
 * back into that space. Beyond baseY the same rail exposes the live frame tail.
 */
export function createDesktopTerminalViewport(term: Terminal, surface: HTMLElement, onUserScroll: () => void) {
  const element = term.element!;
  const spacer = document.createElement('div');
  spacer.className = 'terminal-history-spacer';
  spacer.setAttribute('aria-hidden', 'true');
  surface.insertBefore(spacer, element);
  surface.classList.add('desktop-unified-scroll');
  let cellHeight = 1;
  let syncing = false;
  let following = true;
  let disposed = false;
  let lastProgrammaticTop = -1;
  const base = () => term.buffer.active.type === 'normal' ? term.buffer.active.baseY : 0;
  const setTop = (top: number) => {
    surface.scrollTop = Math.max(0, top);
    lastProgrammaticTop = surface.scrollTop;
  };
  const refresh = () => {
    if (disposed) return;
    const screen = element.querySelector<HTMLElement>('.xterm-screen');
    const height = screen?.getBoundingClientRect().height || 0;
    if (height <= 0) return;
    cellHeight = height / term.rows;
    spacer.style.height = `${base() * cellHeight}px`;
    element.style.position = 'relative';
    element.style.height = `${height}px`;
    element.style.minHeight = '';
    element.style.top = `${(term.buffer.active.viewportY - base()) * cellHeight}px`;
    surface.dataset.scrollOwner = 'surface';
    surface.dataset.historyBase = String(base());
  };
  const revealCursor = () => {
    refresh();
    following = true;
    syncing = true;
    term.scrollToBottom();
    syncing = false;
    const rowTop = (base() + term.buffer.active.cursorY) * cellHeight;
    let top = Math.max(surface.scrollTop, base() * cellHeight);
    if (rowTop < top) top = rowTop;
    else if (rowTop + cellHeight > top + surface.clientHeight) top = rowTop + cellHeight - surface.clientHeight;
    // Fullscreen CLIs keep status/help rows below the input cursor. Include
    // that footer when it and the cursor can both fit, without scrolling a
    // normal shell into its blank tail or hiding a top-of-screen editor cursor.
    const frameBottom = (base() + term.rows) * cellHeight - surface.clientHeight;
    if (term.buffer.active.type === 'alternate' && frameBottom <= rowTop) top = Math.max(top, frameBottom);
    setTop(top);
    // Also reveal a wide-grid cursor on a narrow mirror without scaling text.
    const screen = element.querySelector<HTMLElement>('.xterm-screen');
    const cellWidth = (screen?.getBoundingClientRect().width || 0) / term.cols;
    const x = term.buffer.active.cursorX * cellWidth;
    if (x < surface.scrollLeft) surface.scrollLeft = x;
    else if (x + cellWidth > surface.scrollLeft + surface.clientWidth) surface.scrollLeft = x + cellWidth - surface.clientWidth;
    refresh();
  };
  const applySurfaceScroll = () => {
    const position = scrollPosition(surface.scrollTop, base(), cellHeight);
    syncing = true;
    term.scrollToLine(position.line);
    syncing = false;
    element.style.top = `${position.top}px`;
  };
  const onScroll = () => {
    if (disposed) return;
    const programmatic = Math.abs(surface.scrollTop - lastProgrammaticTop) < 1;
    if (!programmatic) {
      following = surface.scrollTop >= (base() + term.buffer.active.cursorY + 1) * cellHeight - surface.clientHeight - 1;
      onUserScroll();
    }
    applySurfaceScroll();
  };
  surface.addEventListener('scroll', onScroll, { passive: true });
  const subscriptions = [
    term.onScroll(() => {
      refresh();
      if (!syncing) {
        following = term.buffer.active.viewportY === base();
        const tail = Math.max(0, surface.scrollTop - base() * cellHeight);
        setTop(term.buffer.active.viewportY * cellHeight + (term.buffer.active.viewportY === base() ? tail : 0));
      }
    }),
    term.onRender(refresh),
    term.onWriteParsed(() => { refresh(); if (following) revealCursor(); }),
  ];
  refresh();
  return {
    refresh,
    revealCursor,
    scrollLines(lines: number) {
      following = false;
      refresh();
      setTop(surface.scrollTop + lines * cellHeight);
      applySurfaceScroll();
      onUserScroll();
    },
    dispose() {
      disposed = true;
      subscriptions.forEach(subscription => subscription.dispose());
      surface.removeEventListener('scroll', onScroll);
      spacer.remove();
      surface.classList.remove('desktop-unified-scroll');
    },
  };
}

export type DesktopTerminalViewport = ReturnType<typeof createDesktopTerminalViewport>;
