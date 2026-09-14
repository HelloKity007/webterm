import { describe, expect, it } from 'vitest';
import { layoutEventRevision, presenceControlEvent } from './layoutSync';

describe('layout sync transport', () => {
  it('accepts only newer valid revisions', () => {
    expect(layoutEventRevision('{"revision":8}', 7)).toBe(8);
    expect(layoutEventRevision('{"revision":7}', 7)).toBeNull();
    expect(layoutEventRevision('{"revision":"8"}', 7)).toBeNull();
  });
});

describe('presenceControlEvent', () => {
  it('accepts snapshots and deltas while filtering invalid counters', () => {
    expect(presenceControlEvent('{"type":"presence_snapshot","terminals":{"ssh-1":2,"bad":-1}}')).toEqual({
      type: 'presence_snapshot', terminals: { 'ssh-1': 2 },
    });
    expect(presenceControlEvent('{"type":"presence_delta","terminalId":"ssh-1","online":1}')).toEqual({
      type: 'presence_delta', terminalId: 'ssh-1', online: 1,
    });
    expect(presenceControlEvent('{"type":"presence_delta","terminalId":"","online":1}')).toBeNull();
  });
});
