import { describe, expect, it } from 'vitest';
import { clearShellHistoryViewport, loadShellHistoryViewport, restoredHistoryLine, saveShellHistoryViewport, shellHistoryViewportKey } from './shellHistoryViewport';

describe('shell history viewport persistence', () => {
  it('keeps user, terminal, workspace, and panel in the persistence identity', () => {
    expect(shellHistoryViewportKey('7', 2, 'ssh-a', 1, 5)).not.toBe(shellHistoryViewportKey('7', 2, 'ssh-a', 2, 5));
    expect(shellHistoryViewportKey('7', 2, 'ssh-a', 1, 5)).not.toBe(shellHistoryViewportKey('8', 2, 'ssh-a', 1, 5));
  });

  it('restores a content anchor after new terminal output changes the distance from bottom', () => {
    const snapshot = { anchor: 'reading here', anchorOffset: 1, fromBottom: 8, savedAt: Date.now() };
    expect(restoredHistoryLine(snapshot, ['old', 'reading here', 'one', 'two', 'new output'], 4)).toBe(0);
  });

  it('falls back to relative history position and expires stale state', () => {
    expect(restoredHistoryLine({ anchor: 'gone', anchorOffset: 0, fromBottom: 3, savedAt: Date.now() }, ['a', 'b', 'c', 'd', 'e', 'f'], 5)).toBe(2);
    const storage = new Map<string, string>();
    const fakeStorage = {
      getItem: (key: string) => storage.get(key) || null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
      removeItem: (key: string) => { storage.delete(key); },
    } as Storage;
    const key = 'history';
    saveShellHistoryViewport(fakeStorage, key, { anchor: 'row', anchorOffset: 0, fromBottom: 3, savedAt: 10 });
    expect(loadShellHistoryViewport(fakeStorage, key, 20)).toMatchObject({ anchor: 'row' });
    expect(loadShellHistoryViewport(fakeStorage, key, 7 * 60 * 60 * 1000)).toBeNull();
    clearShellHistoryViewport(fakeStorage, key);
  });
});
