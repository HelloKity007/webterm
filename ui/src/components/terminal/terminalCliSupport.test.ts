// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createTerminalWheelState, followTerminalInputAction, launchCodexScrollableAction, resumeTerminalInputAction, routeTerminalHistoryWheel, routeTerminalWheel, terminalActionMessage, terminalScrollbackLines } from './terminalCliSupport';

describe('terminal CLI history support', () => {
  it('replays Shift+wheel without Shift so xterm and tmux use the negotiated wheel path', () => {
    const target = document.createElement('div');
    const received = vi.fn();
    target.addEventListener('wheel', (event) => {
      if (!event.shiftKey) received(event.deltaY, event.deltaMode);
    });
    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      shiftKey: true,
      deltaY: -120,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
    });
    target.dispatchEvent(event);

    expect(routeTerminalHistoryWheel(event)).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(received).toHaveBeenCalledWith(-120, WheelEvent.DOM_DELTA_PIXEL);
  });

  it('leaves normal wheel events to xterm for SGR mouse forwarding', () => {
    const event = new WheelEvent('wheel', { deltaY: 120 });

    expect(routeTerminalHistoryWheel(event)).toBe(true);
    expect(event.defaultPrevented).toBe(false);
  });

  it('turns Shift+wheel into rate-limited PageUp/PageDown in alternate-screen TUIs', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(2_000);
    const state = createTerminalWheelState();
    const sendPage = vi.fn();
    const up = new WheelEvent('wheel', { cancelable: true, shiftKey: true, deltaY: -120 });
    const repeatedUp = new WheelEvent('wheel', { cancelable: true, shiftKey: true, deltaY: -120 });
    const down = new WheelEvent('wheel', { cancelable: true, shiftKey: true, deltaY: 120 });

    expect(routeTerminalWheel(up, { alternateScreen: true, state, sendPage })).toBe(false);
    clock.mockReturnValue(2_010);
    expect(routeTerminalWheel(repeatedUp, { alternateScreen: true, state, sendPage })).toBe(false);
    expect(routeTerminalWheel(down, { alternateScreen: true, state, sendPage })).toBe(false);
    expect(sendPage.mock.calls).toEqual([['up'], ['down']]);
    expect(up.defaultPrevented).toBe(true);
    clock.mockRestore();
  });

  it('uses a fixed action instead of typing a shell command into the active composer', () => {
    expect(terminalActionMessage(launchCodexScrollableAction)).toBe('{"action":"launch_codex_scrollable"}');
    expect(terminalActionMessage(resumeTerminalInputAction)).toBe('{"action":"resume_terminal_input"}');
    expect(terminalActionMessage(followTerminalInputAction)).toBe('{"action":"follow_terminal_input"}');
    expect(terminalScrollbackLines).toBeGreaterThanOrEqual(5_000);
  });
});
