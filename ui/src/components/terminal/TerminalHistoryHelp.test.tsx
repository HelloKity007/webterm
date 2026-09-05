// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TerminalHistoryHelp from './TerminalHistoryHelp';

describe('TerminalHistoryHelp', () => {
  beforeEach(cleanup);

  it('makes both Claude and Codex native history paths discoverable', () => {
    render(<TerminalHistoryHelp onClose={vi.fn()} onLaunchCodexScrollable={vi.fn()} />);

    expect(screen.getByText('Claude Code')).toBeTruthy();
    expect(screen.getByText('Codex CLI')).toBeTruthy();
    expect(screen.getByText('/tui fullscreen')).toBeTruthy();
    expect(screen.getByText('Ctrl+O')).toBeTruthy();
    expect(screen.getByText('Ctrl+T')).toBeTruthy();
  });

  it('requires an explicit button press to request Codex scrollable mode', () => {
    const launch = vi.fn();
    render(<TerminalHistoryHelp onClose={vi.fn()} onLaunchCodexScrollable={launch} />);

    fireEvent.click(screen.getByRole('button', { name: /空闲 shell|idle shell/i }));

    expect(launch).toHaveBeenCalledTimes(1);
  });
});
