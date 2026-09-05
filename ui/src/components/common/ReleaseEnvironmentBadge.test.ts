// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { releaseBadgeDetails } from './releaseEnvironment';

describe('release environment badge', () => {
  it('is visible only in release-test and shortens the immutable commit version', () => {
    expect(releaseBadgeDetails({ environment: 'production', version: 'abcdef' })).toEqual({ visible: false, version: '' });
    expect(releaseBadgeDetails({ environment: 'release-test', version: '1234567890abcdef' })).toEqual({ visible: true, version: '12345678' });
  });
});
