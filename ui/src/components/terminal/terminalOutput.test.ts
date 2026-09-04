import { describe, expect, it, vi } from 'vitest';
import { deliverTerminalBytes } from './terminalOutput';

describe('deliverTerminalBytes', () => {
  it('renders the first terminal frame when the ZMODEM sentry is not ready', () => {
    const write = vi.fn();
    const bytes = new Uint8Array([104, 105]);

    deliverTerminalBytes({ write }, null, bytes);

    expect(write).toHaveBeenCalledWith(bytes);
  });

  it('routes later frames through the ZMODEM sentry', () => {
    const write = vi.fn();
    const consume = vi.fn();
    const bytes = new Uint8Array([104, 105]);

    deliverTerminalBytes({ write }, { consume }, bytes);

    expect(consume).toHaveBeenCalledWith(bytes);
    expect(write).not.toHaveBeenCalled();
  });
});
