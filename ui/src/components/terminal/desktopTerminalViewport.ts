import type { Terminal } from '@xterm/xterm';

export function desktopCapacity(width: number, height: number, cellWidth: number, cellHeight: number) {
  return {
    cols: Math.max(2, Math.min(1000, Math.floor(width / cellWidth))),
    rows: Math.max(1, Math.min(499, Math.floor(height / cellHeight))),
  };
}

export function scrollPosition(pixels: number, baseY: number, cellHeight: number, maxPixels?: number) {
  // The live frame is a few pixels shorter than the surface whenever the panel
  // height is not a whole number of rows, so the very end of the scrollbar is
  // below baseY * cellHeight. Mapping that tail with floor lands one line above
  // the live bottom and leaves the input row unpainted under the blank tail, so
  // an "at the end" scroll is snapped back to the live bottom instead.
  const atLiveBottom = maxPixels !== undefined && pixels >= maxPixels - 1;
  const line = atLiveBottom ? baseY : Math.max(0, Math.min(baseY, Math.floor(pixels / cellHeight)));
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
    // Never shorter than the surface: a panel height that is not a whole number
    // of rows used to leave the rail a few pixels short of baseY * cellHeight,
    // so "scrolled to the end" parked the viewport one line above the prompt.
    element.style.height = `${Math.max(height, surface.clientHeight)}px`;
    element.style.minHeight = '';
    element.style.top = `${(term.buffer.active.viewportY - base()) * cellHeight}px`;
    surface.dataset.scrollOwner = 'surface';
    surface.dataset.historyBase = String(base());
    // A history restore moves xterm's viewport without touching the surface
    // rail. Left alone, the rendered frame ends up outside the visible band and
    // the panel paints completely blank after switching back to that tab. Keep
    // the rail in step with xterm whenever the frame would fall out of view.
    // A hidden panel has no measurable band; never rewrite its saved position.
    const frameTop = term.buffer.active.viewportY * cellHeight;
    const frameBottom = frameTop + term.rows * cellHeight;
    if (surface.clientHeight > 0 &&
      (frameBottom <= surface.scrollTop + 1 || frameTop >= surface.scrollTop + surface.clientHeight - 1)) {
      setTop(frameTop);
    }
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
    const maxTop = Math.max(0, surface.scrollHeight - surface.clientHeight);
    const position = scrollPosition(surface.scrollTop, base(), cellHeight, maxTop);
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
