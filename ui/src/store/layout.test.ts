import { beforeEach, describe, expect, it } from 'vitest';
import { normalizeModuleType, useLayoutStore } from './layout';

describe('layout tab request queue', () => {
  beforeEach(() => {
    useLayoutStore.setState({ newTabQueue: [] });
  });

  it('keeps a requested SSH tab available when the database area drains its own requests', () => {
    const store = useLayoutStore.getState();
    store.requestTab({ id: 'ssh-1', type: 'ssh', title: 'x99', connId: 2 });
    store.requestTab({ id: 'database-1', type: 'database', title: 'metrics', connId: 3 });

    expect(useLayoutStore.getState().drainTabQueue('database')).toEqual([
      { id: 'database-1', type: 'database', title: 'metrics', connId: 3 },
    ]);
    expect(useLayoutStore.getState().drainTabQueue('ssh')).toEqual([
      { id: 'ssh-1', type: 'ssh', title: 'x99', connId: 2 },
    ]);
  });
});

describe('layout module migration', () => {
  it('normalizes the legacy persisted sftp module to files', () => {
    expect(normalizeModuleType('sftp')).toBe('files');
    useLayoutStore.getState().setActiveModule('sftp');
    expect(useLayoutStore.getState().activeModule).toBe('files');
  });

  it('falls back safely when persisted module data is invalid', () => {
    expect(normalizeModuleType('unknown')).toBe('ssh');
    expect(normalizeModuleType(undefined)).toBe('ssh');
  });
});
