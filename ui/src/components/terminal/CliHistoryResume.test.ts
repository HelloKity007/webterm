import { describe, expect, it } from 'vitest';
import { claudeComposerBoundary } from './claudeComposerBoundary';

describe('Claude history hint anchor', () => {
  it('uses the input boundary above the statusline, including multiline drafts', () => {
    expect(claudeComposerBoundary(['history', '──────────', '❯ draft', 'continued draft', '──────────', 'Context 30%'])).toBe(1);
  });
  it('does not guess a corner when the composer is missing', () => {
    expect(claudeComposerBoundary(['history', 'Context 30%', '$ bash'])).toBeNull();
  });
  it('ignores a quoted prompt in history in favor of the live composer', () => {
    expect(claudeComposerBoundary(['──────', '❯ old', 'history', '──────', '❯ current', '──────'])).toBe(3);
  });
});
