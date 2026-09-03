import { describe, expect, it } from 'vitest';
import { layoutEventRevision, layoutSocketURL } from './layoutSync';

describe('layout sync transport', () => {
  it('uses secure WebSocket transport on an HTTPS page and accepts only newer valid revisions', () => {
    expect(layoutSocketURL('jwt token', { protocol: 'https:', host: 'webterm.example:9443' })).toBe('wss://webterm.example:9443/ws/layout?token=jwt%20token');
    expect(layoutEventRevision('{"revision":8}', 7)).toBe(8);
    expect(layoutEventRevision('{"revision":7}', 7)).toBeNull();
    expect(layoutEventRevision('{"revision":"8"}', 7)).toBeNull();
  });
});
