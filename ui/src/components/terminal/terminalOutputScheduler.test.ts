import { afterEach, describe, expect, it, vi } from 'vitest';
import { cancelTerminalOutput, scheduleTerminalOutput } from './terminalOutputScheduler';

describe('terminal output scheduler', () => {
  afterEach(() => vi.useRealTimers());

  it('services at most one terminal job per frame and remains fair', () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const first = () => calls.push('a');
    const second = () => calls.push('b');
    scheduleTerminalOutput(first);
    scheduleTerminalOutput(second);
    vi.advanceTimersByTime(16);
    expect(calls).toEqual(['a']);
    vi.advanceTimersByTime(16);
    expect(calls).toEqual(['a', 'b']);
  });

  it('cancels queued work when a terminal is disposed', () => {
    vi.useFakeTimers();
    const job = vi.fn();
    scheduleTerminalOutput(job);
    cancelTerminalOutput(job);
    vi.advanceTimersByTime(20);
    expect(job).not.toHaveBeenCalled();
  });
});
