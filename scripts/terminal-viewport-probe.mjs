// Browser-side, read-only probe. Do not expose terminal objects on production
// window globals merely for QA. Fail loudly if React's inspection shape changes.
export function terminalViewportProbe(surface, detailed = false) {
  let fiber = surface[Object.keys(surface).find(key => key.startsWith('__reactFiber$'))];
  let term;
  while (fiber && !term) {
    for (let hook = fiber.memoizedState, count = 0; hook && count < 100; hook = hook.next, count++) {
      const candidate = hook.memoizedState?.current;
      if (candidate?.buffer?.active && typeof candidate.scrollToLine === 'function') {
        term = candidate;
        break;
      }
    }
    fiber = fiber.return;
  }
  if (!term) throw new Error('Cannot inspect actual xterm buffer; no geometric-only fallback');
  const screen = surface.querySelector('.xterm-screen');
  // A native Windows hard reload can briefly make Chrome report a different
  // device-pixel scale for the xterm canvas and its scroll container. Their
  // getBoundingClientRect() values then live in different coordinate spaces
  // although the rendered rows and xterm buffer have not changed. Use CSS
  // layout metrics from the same offset chain instead.
  let screenTop = 0;
  let offsetNode = screen;
  while (offsetNode && offsetNode !== surface) {
    screenTop += offsetNode.offsetTop || 0;
    offsetNode = offsetNode.offsetParent;
  }
  let first;
  let last;
  if (offsetNode === surface && screen.offsetHeight) {
    const rowHeight = screen.offsetHeight / term.rows;
    first = Math.max(0, Math.floor((surface.scrollTop - screenTop) / rowHeight));
    last = Math.min(term.rows, Math.ceil((surface.scrollTop + surface.clientHeight - screenTop) / rowHeight));
  } else {
    // Preserve a safe fallback for an unexpected DOM hierarchy, but do not
    // use cross-coordinate rectangles when the normal offset chain exists.
    const screenRect = screen.getBoundingClientRect();
    const surfaceRect = surface.getBoundingClientRect();
    const rowHeight = screenRect.height / term.rows;
    first = Math.max(0, Math.floor((surfaceRect.top - screenRect.top) / rowHeight));
    last = Math.min(term.rows, Math.ceil((surfaceRect.bottom - screenRect.top) / rowHeight));
  }
  const buffer = term.buffer.active;
  const lines = Array.from({ length: Math.max(0, last - first) }, (_, row) =>
    buffer.getLine(buffer.viewportY + first + row)?.translateToString(true) || '');
  const result = {
    mode: surface.dataset.terminalMode, bufferType: buffer.type,
    mouseTrackingMode: term.modes.mouseTrackingMode,
    mouseEncoding: term._core?.coreMouseService?.activeEncoding,
    viewportY: buffer.viewportY, baseY: buffer.baseY,
    fromBottom: buffer.baseY - buffer.viewportY,
    outerTop: surface.scrollTop, first, last, rows: term.rows, cols: term.cols,
    historyReplay: {
      gridBefore: surface.dataset.historyReplayGridBefore,
      gridAfter: surface.dataset.historyReplayGridAfter,
      baseBefore: surface.dataset.historyReplayBaseBefore,
      baseAfter: surface.dataset.historyReplayBaseAfter,
    },
    lines,
  };
  if (detailed) result.diagnostic = {
    cursorX: buffer.cursorX, cursorY: buffer.cursorY, length: buffer.length,
    lines: Array.from({ length: Math.min(buffer.length, 10000) }, (_, i) => ({
      text: buffer.getLine(i)?.translateToString(true) || '', wrapped: buffer.getLine(i)?.isWrapped,
    })),
    truncated: buffer.length > 10000,
  };
  return result;
}
