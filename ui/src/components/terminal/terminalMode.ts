export type TerminalMode = 'unknown' | 'shell' | 'cli';

// Called by xterm's streaming CSI parser, so split WebSocket frames and
// multiple controls in one frame are handled in their actual order.
export function terminalModeAfterPrivateControl(
  current: TerminalMode, params: (number | number[])[], enabled: boolean,
): TerminalMode {
  if (!params.some(value => typeof value === 'number' && [47, 1047, 1049].includes(value))) return current;
  return enabled ? 'cli' : 'unknown';
}
