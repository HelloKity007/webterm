// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createLatestTerminalWheelSender } from './terminalCliSupport';
import { createTerminalWheelNotchGate, createTerminalWheelState, followTerminalInputAction, launchCodexScrollableAction, resumeTerminalInputAction, routeTerminalHistoryWheel, routeTerminalWheel, terminalActionMessage, terminalScrollbackLines } from './terminalCliSupport';

describe('terminal CLI history support', () => {
  it('reverses immediately after a wheel flood without draining stale down events', () => {
    vi.useFakeTimers();
    try {
      const send = vi.fn();
      const wheel = createLatestTerminalWheelSender(send);
      for (let i = 0; i < 100; i++) wheel.notch('down');
      expect(send).toHaveBeenCalledTimes(100);
      send.mockClear();
      wheel.notch('up');
      expect(send.mock.calls).toEqual([['up']]);
      vi.runAllTimers();
      expect(send.mock.calls).toEqual([['up']]);
      wheel.notch('down');
      wheel.dispose();
      send.mockClear();
      wheel.notch('up');
      vi.runAllTimers();
      expect(send).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it('scrolls exactly three lines per event regardless of delta size, mode or Shift', () => {
    const scrollNotch = vi.fn();
    for (const deltaMode of [0, 1, 2]) {
      for (const deltaY of [-1, -120, -900, 1, 120, 900]) {
        const event = new WheelEvent('wheel', { cancelable: true, deltaMode, deltaY, shiftKey: true });
        expect(routeTerminalWheel(event, { scrollNotch })).toBe(false);
        expect(scrollNotch).toHaveBeenLastCalledWith(Math.sign(deltaY) * 3);
        expect(event.defaultPrevented).toBe(true);
      }
    }
    expect(scrollNotch).toHaveBeenCalledTimes(18);
  });

  it('scrolls momentum gestures proportionally with a per-gesture cap', () => {
    let at = 0;
    const gate = createTerminalWheelNotchGate({ gestureGapMs: 150, now: () => at });
    const send = vi.fn();
    // gentle ~90px swipe: one notch
    for (let i = 0; i < 9; i++) {
      at = i * 10;
      routeTerminalWheel(new WheelEvent('wheel', { cancelable: true, deltaY: 10, deltaMode: WheelEvent.DOM_DELTA_PIXEL }), { scrollNotch: send, notchGate: gate });
    }
    expect(send).toHaveBeenCalledTimes(1);
    // medium ~300px swipe: 4 notches
    at = 1000;
    for (let i = 0; i < 30; i++) {
      at = 1000 + i * 10;
      routeTerminalWheel(new WheelEvent('wheel', { cancelable: true, deltaY: 10, deltaMode: WheelEvent.DOM_DELTA_PIXEL }), { scrollNotch: send, notchGate: gate });
    }
    expect(send).toHaveBeenCalledTimes(5);
    // hard ~900px flick: throttled to the burst allowance plus what the
    // bucket refills during the sustained stream itself
    at = 2000;
    for (let i = 0; i < 60; i++) {
      at = 2000 + i * 10;
      routeTerminalWheel(new WheelEvent('wheel', { cancelable: true, deltaY: 15, deltaMode: WheelEvent.DOM_DELTA_PIXEL }), { scrollNotch: send, notchGate: gate });
    }
    expect(send.mock.calls.length).toBeGreaterThanOrEqual(11);
    expect(send.mock.calls.length).toBeLessThanOrEqual(15);
  });

  it('never leaves a direction stuck after a flick exhausts the burst', () => {
    let at = 0;
    const gate = createTerminalWheelNotchGate({ gestureGapMs: 150, now: () => at });
    const send = vi.fn();
    // hard flick: 12×95px in one momentum stream exhausts the bucket
    for (let i = 0; i < 12; i++) {
      at = i * 15;
      routeTerminalWheel(new WheelEvent('wheel', { cancelable: true, deltaY: -95, deltaMode: WheelEvent.DOM_DELTA_PIXEL }), { scrollNotch: send, notchGate: gate });
    }
    expect(send).toHaveBeenCalledTimes(6);
    // same-direction swipe shortly after must scroll again without a
    // reverse-direction gesture to unstick the previous implementation
    at = 465;
    for (let i = 0; i < 10; i++) {
      at = 465 + i * 10;
      routeTerminalWheel(new WheelEvent('wheel', { cancelable: true, deltaY: -15, deltaMode: WheelEvent.DOM_DELTA_PIXEL }), { scrollNotch: send, notchGate: gate });
    }
    expect(send.mock.calls.length).toBeGreaterThan(6);
  });

  it('passes every discrete Windows notch through, even in fast bursts', () => {
    let at = 0;
    const gate = createTerminalWheelNotchGate({ gestureGapMs: 150, now: () => at });
    const send = vi.fn();
    for (let i = 0; i < 5; i++) {
      at = i * 20;
      routeTerminalWheel(new WheelEvent('wheel', { cancelable: true, deltaY: -120 }), { scrollNotch: send, notchGate: gate });
    }
    expect(send).toHaveBeenCalledTimes(5);
    expect(send).toHaveBeenLastCalledWith(-3);
  });

  it('bounds the momentum tail that follows a quantum notch', () => {
    let at = 0;
    const gate = createTerminalWheelNotchGate({ gestureGapMs: 150, now: () => at });
    const send = vi.fn();
    routeTerminalWheel(new WheelEvent('wheel', { cancelable: true, deltaY: -100 }), { scrollNotch: send, notchGate: gate });
    for (let i = 1; i <= 30; i++) {
      at = i * 12;
      routeTerminalWheel(new WheelEvent('wheel', { cancelable: true, deltaY: -8, deltaMode: WheelEvent.DOM_DELTA_PIXEL }), { scrollNotch: send, notchGate: gate });
    }
    // one discrete notch plus a 240px tail earning three more, never unbounded
    expect(send).toHaveBeenCalledTimes(4);
  });

  it('caps a large fractional fast flick instead of scrolling to the end', () => {
    let at = 0;
    const gate = createTerminalWheelNotchGate({ gestureGapMs: 150, now: () => at });
    const send = vi.fn();
    const flick = [80, 262.5, 95, 70, 100.83, 52.5, 41.67, 25, 12.5, 5.83, 2.5, 0.83];
    flick.forEach((deltaY, index) => {
      at = index * 15;
      routeTerminalWheel(new WheelEvent('wheel', { cancelable: true, deltaY: -deltaY, deltaMode: WheelEvent.DOM_DELTA_PIXEL }), { scrollNotch: send, notchGate: gate });
    });
    expect(send.mock.calls.length).toBeLessThanOrEqual(10);
    expect(send.mock.calls.length).toBeGreaterThanOrEqual(6);
  });

  it('treats non-quantized integer momentum values as gesture events', () => {
    let at = 0;
    const gate = createTerminalWheelNotchGate({ gestureGapMs: 150, now: () => at });
    const send = vi.fn();
    [-80, -105, -95, -60].forEach((deltaY, index) => {
      at = index * 20;
      routeTerminalWheel(new WheelEvent('wheel', { cancelable: true, deltaY, deltaMode: WheelEvent.DOM_DELTA_PIXEL }), { scrollNotch: send, notchGate: gate });
    });
    expect(send).toHaveBeenCalledTimes(4);
  });

  it('allows a reversed momentum gesture immediately and consumes suppressed events', () => {
    let at = 100;
    const gate = createTerminalWheelNotchGate({ gestureGapMs: 150, notchPixels: 1000, now: () => at });
    const send = vi.fn();
    const down = new WheelEvent('wheel', { cancelable: true, deltaY: 40, deltaMode: WheelEvent.DOM_DELTA_PIXEL });
    expect(routeTerminalWheel(down, { scrollNotch: send, notchGate: gate })).toBe(false);
    at = 110;
    const up = new WheelEvent('wheel', { cancelable: true, deltaY: -8, deltaMode: WheelEvent.DOM_DELTA_PIXEL });
    expect(routeTerminalWheel(up, { scrollNotch: send, notchGate: gate })).toBe(false);
    expect(up.defaultPrevented).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(-3);
  });

  it('preserves browser zoom and ignores horizontal wheels', () => {
    const scrollNotch = vi.fn();
    for (const event of [new WheelEvent('wheel', { ctrlKey: true, deltaY: 120 }), new WheelEvent('wheel', { deltaX: 120 })]) {
      expect(routeTerminalWheel(event, { scrollNotch })).toBe(true);
    }
    expect(scrollNotch).not.toHaveBeenCalled();
  });
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

  it('uses the production-proven rate-limited page path for alternate-screen wheel scrolling', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(3_000);
    const state = createTerminalWheelState();
    const sendPage = vi.fn();
    const event = new WheelEvent('wheel', { cancelable: true, deltaY: -80 });

    expect(routeTerminalWheel(event, { alternateScreen: true, state, sendPage })).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(sendPage).toHaveBeenCalledWith('up');
    clock.mockRestore();
  });

  it('uses a fixed action instead of typing a shell command into the active composer', () => {
    expect(terminalActionMessage(launchCodexScrollableAction)).toBe('{"action":"launch_codex_scrollable"}');
    expect(terminalActionMessage(resumeTerminalInputAction)).toBe('{"action":"resume_terminal_input"}');
    expect(terminalActionMessage(followTerminalInputAction)).toBe('{"action":"follow_terminal_input"}');
    expect(terminalScrollbackLines).toBeGreaterThanOrEqual(5_000);
  });
});
