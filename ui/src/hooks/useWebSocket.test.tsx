// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
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

  send(data: string) { void data; }
  close() { this.onclose?.(); }
  emitMessage(data: string) { this.onmessage?.(new MessageEvent('message', { data })); }
}

describe('useWebSocket', () => {
  afterEach(() => {
    FakeWebSocket.instances = [];
    vi.unstubAllGlobals();
  });

  it('delivers messages to the latest callback without reconnecting', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ onMessage }) => useWebSocket({ url: 'ws://example.test/socket', onMessage }), { initialProps: { onMessage: first } });

    expect(FakeWebSocket.instances).toHaveLength(1);
    rerender({ onMessage: second });
    act(() => FakeWebSocket.instances[0].emitMessage('latest'));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('latest');
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
