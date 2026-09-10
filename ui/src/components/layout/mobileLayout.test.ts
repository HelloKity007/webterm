import { describe, expect, it } from 'vitest';
import { isMobileBrowser } from './mobileLayout';

describe('mobile browser detection', () => {
  it('recognizes common phone and tablet user agents', () => {
    expect(isMobileBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 Safari/604.1')).toBe(true);
    expect(isMobileBrowser('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Mobile Safari/537.36')).toBe(true);
    expect(isMobileBrowser('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15')).toBe(true);
  });

  it('does not classify desktop browsers solely by viewport width', () => {
    expect(isMobileBrowser('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36')).toBe(false);
  });
});
