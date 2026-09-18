export function claudeComposerBoundary(lines: readonly string[]): number | null {
  for (let row = lines.length - 1; row > 0; row--) {
    if (/^\s*❯/.test(lines[row]) && /^\s*─{5}/.test(lines[row - 1])) return row - 1;
  }
  return null;
}
