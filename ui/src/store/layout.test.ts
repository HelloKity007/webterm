import { beforeEach, describe, expect, it } from 'vitest';
import { useLayoutStore } from './layout';

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
