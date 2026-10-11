// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWebSocket } from './useWebSocket';

class FakeWebSocket {
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readonly readyState = FakeWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    void url;
    FakeWebSocket.instances.push(this);
  }

  sent: string[] = [];

  send(data: string) { this.sent.push(data); }
  close() { this.onclose?.(); }
  emitMessage(data: string) { this.onmessage?.(new MessageEvent('message', { data })); }
}

describe('useWebSocket', () => {
  afterEach(() => {
    cleanup();
    FakeWebSocket.instances = [];
    vi.unstubAllGlobals();
  });

  it('delivers messages to the latest callback without reconnecting', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ onMessage }) => useWebSocket({ url: 'ws://example.test/socket', onMessage }), { initialProps: { onMessage: first } });

    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    rerender({ onMessage: second });
    act(() => FakeWebSocket.instances[0].emitMessage('latest'));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('latest');
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('lets onOpen send the initial terminal size on the socket that just opened', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    renderHook(() => useWebSocket({
      url: 'ws://example.test/socket',
      onMessage: vi.fn(),
      onOpen: (sendNow) => sendNow('{"cols":235,"rows":41}'),
    }));

    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    act(() => FakeWebSocket.instances[0].onopen?.());

    expect(FakeWebSocket.instances[0].sent).toEqual(['{"cols":235,"rows":41}']);
  });

  it('keeps retrying past three failures and gets a fresh URL each time', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const createUrl = vi.fn(async () => `ws://example.test/socket?t=${createUrl.mock.calls.length}`);
    const { unmount } = renderHook(() => useWebSocket({ createUrl, onMessage: vi.fn() }));
    for (let attempt = 0; attempt < 5; attempt++) {
      await act(async () => { await Promise.resolve(); });
      expect(FakeWebSocket.instances).toHaveLength(attempt + 1);
      act(() => FakeWebSocket.instances[attempt].onclose?.());
      await act(async () => { vi.runOnlyPendingTimers(); await Promise.resolve(); });
    }
    expect(createUrl).toHaveBeenCalledTimes(6);
    unmount();
    vi.useRealTimers();
  });

  it('pauses while offline and reconnects immediately on online', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderHook(() => useWebSocket({ url: 'ws://example.test/socket', onMessage: vi.fn() }));
    await act(async () => { await Promise.resolve(); });
    expect(FakeWebSocket.instances).toHaveLength(0);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    act(() => window.dispatchEvent(new Event('online')));
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
  });

  it('sends heartbeat controls and keeps pong out of terminal output', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const onMessage = vi.fn();
    const { unmount } = renderHook(() => useWebSocket({ url: 'ws://example.test/socket', onMessage }));
    await act(async () => { await Promise.resolve(); });
    const socket = FakeWebSocket.instances[0];
    act(() => socket.onopen?.());
    act(() => vi.advanceTimersByTime(20000));
    expect(socket.sent).toContain('{"action":"ping"}');
    act(() => socket.emitMessage('{"type":"pong"}'));
    expect(onMessage).not.toHaveBeenCalled();
    unmount();
    vi.useRealTimers();
  });
});

describe('terminal loss reconnect policy', () => {
  afterEach(() => { cleanup(); FakeWebSocket.instances = []; vi.unstubAllGlobals(); vi.useRealTimers(); });
  it('stops after confirmed loss, ignores online events and drops queued input until explicit retry', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const onMessage = vi.fn();
    const { result, rerender } = renderHook(({ url }) => useWebSocket({ url, onMessage }), { initialProps: { url: 'ws://test/first' } });
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const ws = FakeWebSocket.instances[0];
    act(() => ws.emitMessage(JSON.stringify({ type: 'error', code: 'TERMINAL_SERVER_UNAVAILABLE', retryable: false })));
    expect(result.current.status).toBe('terminal-failed');
    act(() => { window.dispatchEvent(new Event('online')); result.current.send('must-not-replay'); });
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(ws.sent).toEqual([]);
    expect(onMessage).toHaveBeenCalledTimes(1);
    rerender({ url: 'ws://test/retry' });
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2));
    act(() => FakeWebSocket.instances[1].onopen?.());
    expect(FakeWebSocket.instances[1].sent).toEqual([]);
  });
});
