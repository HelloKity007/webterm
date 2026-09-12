// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Terminal } from '@xterm/xterm';
import type { TerminalMode } from './terminalMode';
import { terminalModeAfterPrivateControl as mode } from './terminalMode';

describe('protocol terminal mode', () => {
  it('uses the streaming parser across split controls and ignores shell words in CLI output', async () => {
    const terminal = new Terminal();
    let current: TerminalMode = 'shell';
    for (const final of ['h', 'l']) terminal.parser.registerCsiHandler({ prefix: '?', final }, params => {
      current = mode(current, params, final === 'h');
      return false;
    });
    const write = (data: string) => new Promise<void>(resolve => terminal.write(data, resolve));
    try {
      await write('\x1b[?10');
      await write('49h');
      expect(current).toBe('cli');
      await write('bash zsh fish dash\r\nroot# \r\n$ ');
      expect(current).toBe('cli');
      expect(terminal.buffer.active.type).toBe('alternate');
      await write('\x1b[?1049l');
      expect(current).toBe('unknown');
      expect(terminal.buffer.active.type).toBe('normal');
      await write('Claude context bypass permissions');
      expect(current).toBe('unknown');
    } finally { terminal.dispose(); }
  });
  it('recognizes alternate buffers behind ssh and nested tmux', () => {
    for (const parameter of [47, 1047, 1049]) {
      expect(mode('shell', [parameter], true)).toBe('cli');
      expect(mode('unknown', [25, parameter], true)).toBe('cli');
      expect(mode('cli', [parameter], false)).toBe('unknown');
    }
  });
  it('does not classify a shell as CLI merely because tmux enables mouse or cursor controls', () => {
    expect(mode('shell', [1000, 1006, 25], true)).toBe('shell');
    expect(mode('cli', [25], false)).toBe('cli');
  });
  it('follows actual entry/exit order without sticky CLI state', () => {
    expect(mode(mode('shell', [1049], true), [1049], false)).toBe('unknown');
    expect(mode(mode('cli', [1049], false), [1049], true)).toBe('cli');
  });
});
