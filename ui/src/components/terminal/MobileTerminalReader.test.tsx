// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Terminal } from '@xterm/xterm';
import MobileTerminalReader from './MobileTerminalReader';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('mobile wrapped terminal reader', () => {
  it('preserves full colored CJK and long line tails without resizing the terminal', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Android Mobile');
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(390);
    const terminal = new Terminal({ cols: 104, rows: 29, fontSize: 11, allowProposedApi: true, theme: { red: '#ff0000' } });
    await new Promise<void>(resolve => terminal.write('\x1b[?1049h第95行\x1b[31m红色完整结尾\x1b[0m\r\n第99行 ' + 'x'.repeat(65) + ' Title完整结尾', resolve));
    const history = vi.fn();
    try {
      render(<MobileTerminalReader terminalRef={{ current: terminal }} revision={1} onHistory={history} />);
      await waitFor(() => expect(screen.getByLabelText('自动换行的终端输出').textContent).toContain('Title完整结尾'));
      expect(screen.getByText('红色完整结尾').style.color).toBe('rgb(255, 0, 0)');
      expect(terminal.cols).toBe(104);
      expect(screen.queryByText('更早输出')).toBeNull();
      expect(screen.queryByText('更新输出')).toBeNull();
      const reader = screen.getByLabelText('自动换行的终端输出');
      reader.scrollTop = 0;
      fireEvent.touchStart(reader, { touches: [{ clientY: 100 }] });
      fireEvent.touchMove(reader, { touches: [{ clientY: 160 }] });
      expect(history).toHaveBeenCalledWith('up');
      fireEvent.touchEnd(reader);
      fireEvent.click(screen.getByText('终端输入'));
      expect(screen.queryByLabelText('自动换行的终端输出')).toBeNull();
      fireEvent.click(screen.getByText('换行阅读'));
      expect(screen.getByLabelText('自动换行的终端输出').textContent).toContain('Title完整结尾');
    } finally { terminal.dispose(); }
  });

  it('includes shell scrollback and full tails without sending input on swipes', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Android Mobile');
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(390);
    const terminal = new Terminal({ cols: 104, rows: 3, scrollback: 100 });
    await new Promise<void>(resolve => terminal.write('first history\r\n' + 'x'.repeat(80) + '完整尾部\r\nthird\r\nfourth\r\nlast', resolve));
    const history = vi.fn();
    try {
      render(<MobileTerminalReader terminalRef={{ current: terminal }} revision={1} onHistory={history} />);
      await waitFor(() => expect(screen.getByLabelText('自动换行的终端输出').textContent).toContain('first history'));
      const reader = screen.getByLabelText('自动换行的终端输出');
      expect(reader.textContent).toContain('完整尾部');
      expect(reader.textContent).toContain('last');
      fireEvent.touchStart(reader, { touches: [{ clientY: 100 }] });
      fireEvent.touchMove(reader, { touches: [{ clientY: 180 }] });
      expect(history).not.toHaveBeenCalled();
      expect(terminal.cols).toBe(104);
    } finally { terminal.dispose(); }
  });

  it('does not replace the desktop terminal', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Desktop Chrome');
    const terminal = new Terminal();
    try {
      render(<MobileTerminalReader terminalRef={{ current: terminal }} revision={1} onHistory={() => {}} />);
      expect(screen.queryByLabelText('终端换行阅读')).toBeNull();
    } finally { terminal.dispose(); }
  });
});
