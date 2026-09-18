// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCliHistoryResume } from './useCliHistoryResume';

beforeEach(() => sessionStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('CLI history reading intent', () => {
  it('does not rerender for repeated input when the hint is already dismissed', () => {
    let renders = 0;
    const hook = renderHook(() => { renders++; return useCliHistoryResume('u1:c2:p6'); });
    const before = renders;
    act(() => { for (let i = 0; i < 100; i++) hook.result.current[1](false); });
    expect(renders).toBe(before);
  });

  it('survives a page component remount and clears after return to input', () => {
    const first = renderHook(() => useCliHistoryResume('user-1:conn-2:panel-6'));
    expect(first.result.current[0]).toBe(false);
    act(() => first.result.current[1](true));
    first.unmount();
    const restored = renderHook(() => useCliHistoryResume('user-1:conn-2:panel-6'));
    expect(restored.result.current[0]).toBe(true);
    act(() => restored.result.current[1](false));
    restored.unmount();
    expect(renderHook(() => useCliHistoryResume('user-1:conn-2:panel-6')).result.current[0]).toBe(false);
  });

  it('does not carry another user or terminal reading state into a new key', () => {
    const hook = renderHook(({ key }) => useCliHistoryResume(key), { initialProps: { key: 'u1:c2:p6' } });
    act(() => hook.result.current[1](true));
    hook.rerender({ key: 'u1:c2:p7' });
    expect(hook.result.current[0]).toBe(false);
    hook.rerender({ key: 'u2:c2:p6' });
    expect(hook.result.current[0]).toBe(false);
    hook.rerender({ key: 'u1:c2:p6' });
    expect(hook.result.current[0]).toBe(true);
  });

  it('still operates in memory when browser storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); });
    const hook = renderHook(() => useCliHistoryResume('u1:c2:p6'));
    act(() => hook.result.current[1](true));
    expect(hook.result.current[0]).toBe(true);
    act(() => hook.result.current[1](false));
    expect(hook.result.current[0]).toBe(false);
  });
});
