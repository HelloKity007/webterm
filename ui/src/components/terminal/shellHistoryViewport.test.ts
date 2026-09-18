import { describe, expect, it } from 'vitest';
import { clearShellHistoryViewport, loadShellHistoryViewport, restoredHistoryLine, saveShellHistoryViewport, shellHistoryViewportKey } from './shellHistoryViewport';

describe('shell history viewport persistence', () => {
  it('disambiguates repeated history lines using the saved distance instead of the last match', () => {
    const lines = Array.from({ length: 100 }, () => 'XXXXXXXXXXXXXXXX');
    expect(restoredHistoryLine({ anchor: lines[0], anchorOffset: 0, fromBottom: 57, savedAt: Date.now() }, lines, 99)).toBe(42);
    expect(restoredHistoryLine({ anchor: lines[0], anchorOffset: 2, fromBottom: 57, savedAt: Date.now() }, lines, 99)).toBe(42);
  });
  it('keeps user, terminal, workspace, and panel in the persistence identity', () => {
    expect(shellHistoryViewportKey('7', 2, 'ssh-a', 1, 5)).not.toBe(shellHistoryViewportKey('7', 2, 'ssh-a', 2, 5));
    expect(shellHistoryViewportKey('7', 2, 'ssh-a', 1, 5)).not.toBe(shellHistoryViewportKey('8', 2, 'ssh-a', 1, 5));
  });

  it('restores a content anchor after new terminal output changes the distance from bottom', () => {
    const snapshot = { anchor: 'reading here', anchorOffset: 1, fromBottom: 8, baseY: 2, savedAt: Date.now() };
    expect(restoredHistoryLine(snapshot, ['old', 'reading here', 'one', 'two', 'new output'], 4)).toBe(0);
  });

  it('uses the exact saved relative line when the same buffer contains a repeated stale anchor', () => {
    const lines = Array.from({ length: 120 }, (_, index) => `row-${index}`);
    lines[42] = 'repeated marker';
    lines[55] = 'repeated marker';
    expect(restoredHistoryLine({ anchor: 'repeated marker', anchorOffset: 0, fromBottom: 78, baseY: 119, savedAt: Date.now() }, lines, 119)).toBe(41);
  });

  it('uses a visible multi-line context when live output adds a later repeated divider', () => {
    const lines = Array.from({ length: 130 }, (_, index) => `row-${index}`);
    lines[42] = '────────────────';
    lines[43] = 'unique earlier message';
    lines[44] = 'details';
    lines[75] = '────────────────';
    lines[76] = 'new live output';
    lines[77] = 'details';
    expect(restoredHistoryLine({
      anchor: '────────────────', anchorOffset: 0,
      anchorContext: ['────────────────', 'unique earlier message', 'details'],
      fromBottom: 87, baseY: 128, savedAt: Date.now(),
    }, lines, 129)).toBe(42);
  });

  it('does not let a legacy single-line anchor jump far from its saved offset', () => {
    const lines = Array.from({ length: 120 }, (_, index) => `row-${index}`);
    lines[55] = 'legacy marker';
    expect(restoredHistoryLine({ anchor: 'legacy marker', anchorOffset: 0, fromBottom: 78, savedAt: Date.now() }, lines, 119)).toBe(41);
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

  it('persists the independent local panel offset for a shared terminal grid', () => {
    const storage = new Map<string, string>();
    const fakeStorage = {
      getItem: (key: string) => storage.get(key) || null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
      removeItem: (key: string) => { storage.delete(key); },
    } as Storage;
    saveShellHistoryViewport(fakeStorage, 'shared-grid', {
      anchor: 'row', anchorOffset: 0, fromBottom: 75, rows: 35, cols: 104, outerTop: 382, savedAt: 10,
    });
    expect(loadShellHistoryViewport(fakeStorage, 'shared-grid', 20)).toMatchObject({ outerTop: 382, rows: 35, cols: 104 });
  });
});
