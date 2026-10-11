/** Font belongs to the local preference, never the peer's PTY dimensions. */
export function localTerminalFont(preferred: number): number {
  return Number.isFinite(preferred) ? Math.max(11, preferred) : 16;
}

/** Consume a three-line notch locally before asking the remote app for history. */
export function localViewportScroll(top: number, height: number, contentHeight: number, cellHeight: number, lines: number): number {
  return Math.max(0, Math.min(Math.max(0, contentHeight - height), top + lines * cellHeight));
}

/** Reveal the input row without blindly hiding the top of a mostly empty shell. */
export function localViewportRevealRow(top: number, height: number, contentHeight: number, cellHeight: number, row: number): number {
  const rowTop = Math.max(0, row) * cellHeight;
  const next = rowTop < top ? rowTop : rowTop + cellHeight > top + height ? rowTop + cellHeight - height : top;
  return Math.max(0, Math.min(Math.max(0, contentHeight - height), next));
}
