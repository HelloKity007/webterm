// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWheelDebugRecorder } from './terminalWheelDebug';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);
vi.stubGlobal('performance', { now: () => 0 });

function wheel(overrides: Partial<WheelEventInit> = {}): WheelEvent {
  return new WheelEvent('wheel', { deltaY: -12, deltaMode: WheelEvent.DOM_DELTA_PIXEL, cancelable: true, ...overrides });
}

afterEach(() => { fetchMock.mockReset(); fetchMock.mockResolvedValue(new Response('{}', { status: 200 })); });

describe('terminal wheel debug recorder', () => {
  it('records numeric wheel data and flushes after twenty events', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    const recorder = createWheelDebugRecorder('terminal-x', 2, 45);
    for (let i = 0; i < 20; i++) {
      recorder.begin(wheel({ deltaY: -10 - i }), { alternate: true, termMode: 'cli' });
      recorder.emitted('sgr-mouse');
      recorder.finish('intercepted');
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const batch = JSON.parse(fetchMock.mock.calls[0]![1].body) as Array<Record<string, unknown>>;
    expect(batch).toHaveLength(20);
    expect(batch[0]).toMatchObject({ delta_y: -10, delta_mode: 0, terminal_id: 'terminal-x', workspace: 2, panel: 45, gate: 'emitted', emit_path: 'sgr-mouse', route: 'intercepted' });
    const serialized = JSON.stringify(batch);
    expect(serialized).not.toMatch(/prompt|password|token|credential/i);
    recorder.dispose();
  });

  it('marks suppressed events and stops after three failed uploads', async () => {
    fetchMock.mockResolvedValue(new Response('err', { status: 500 }));
    const recorder = createWheelDebugRecorder('terminal-y', 2, 45);
    for (let batch = 0; batch < 5; batch++) {
      for (let i = 0; i < 20; i++) {
        recorder.begin(wheel(), { alternate: true, termMode: 'cli' });
        recorder.finish('intercepted');
      }
      await Promise.resolve();
    }
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('computes inter-event delta from event timestamps', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    const recorder = createWheelDebugRecorder('terminal-z', 2, 45);
    const first = new WheelEvent('wheel', { deltaY: 5 });
    Object.defineProperty(first, 'timeStamp', { value: 1000 });
    const second = new WheelEvent('wheel', { deltaY: 6 });
    Object.defineProperty(second, 'timeStamp', { value: 1016 });
    recorder.begin(first, { alternate: false, termMode: 'shell' });
    recorder.finish('passthrough');
    recorder.begin(second, { alternate: false, termMode: 'shell' });
    recorder.finish('passthrough');
    vi.useFakeTimers();
    vi.runAllTimers();
    vi.useRealTimers();
    recorder.dispose();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const batch = JSON.parse(fetchMock.mock.calls.at(-1)![1].body);
    expect(batch[0].dt_ms).toBe(0);
    expect(batch[1].dt_ms).toBeCloseTo(16, 5);
  });
});
