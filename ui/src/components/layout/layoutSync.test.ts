import { describe, expect, it } from 'vitest';
import { layoutEventRevision } from './layoutSync';

describe('layout sync transport', () => {
  it('accepts only newer valid revisions', () => {
    expect(layoutEventRevision('{"revision":8}', 7)).toBe(8);
    expect(layoutEventRevision('{"revision":7}', 7)).toBeNull();
    expect(layoutEventRevision('{"revision":"8"}', 7)).toBeNull();
  });
});
