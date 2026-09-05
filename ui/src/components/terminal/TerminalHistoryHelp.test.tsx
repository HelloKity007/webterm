// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TerminalHistoryHelp from './TerminalHistoryHelp';

describe('TerminalHistoryHelp', () => {
  beforeEach(cleanup);

  const baseProps = {
    onClose: vi.fn(),
    onLaunchCodexScrollable: vi.fn(),
    onResumeInput: vi.fn(),
    onCopySelection: vi.fn(),
    onPaste: vi.fn(),
  };

  it('makes both Claude and Codex native history paths discoverable', () => {
    render(<TerminalHistoryHelp {...baseProps} />);

    expect(screen.getByText('Claude Code')).toBeTruthy();
    expect(screen.getByText('Codex CLI')).toBeTruthy();
    expect(screen.getByText('/tui fullscreen')).toBeTruthy();
    expect(screen.getByText('Ctrl+O')).toBeTruthy();
    expect(screen.getByText('Ctrl+T')).toBeTruthy();
  });

  it('requires an explicit button press to request Codex scrollable mode', () => {
    const launch = vi.fn();
    render(<TerminalHistoryHelp {...baseProps} onLaunchCodexScrollable={launch} />);

    fireEvent.click(screen.getByRole('button', { name: /空闲 shell|idle shell/i }));

    expect(launch).toHaveBeenCalledTimes(1);
  });

  it('exposes explicit resume, copy, and paste controls for fullscreen CLIs', () => {
    const resume = vi.fn();
    const copy = vi.fn();
    const paste = vi.fn();
    render(<TerminalHistoryHelp {...baseProps} onResumeInput={resume} onCopySelection={copy} onPaste={paste} />);

    fireEvent.click(screen.getByRole('button', { name: /恢复输入|resume input/i }));
    fireEvent.click(screen.getByRole('button', { name: /^复制$|^copy$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^粘贴$|^paste$/i }));

    expect(resume).toHaveBeenCalledTimes(1);
    expect(copy).toHaveBeenCalledTimes(1);
    expect(paste).toHaveBeenCalledTimes(1);
  });
});
