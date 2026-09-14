import { describe, expect, it } from 'vitest';
import { takeTerminalOutput } from './terminalOutputQueue';

describe('takeTerminalOutput', () => {
  it('preserves byte order while applying a per-frame budget', () => {
    const queue = [new Uint8Array([1, 2]), new Uint8Array([3, 4, 5]), new Uint8Array([6])];
    expect([...takeTerminalOutput(queue, 4)]).toEqual([1, 2, 3, 4]);
    expect([...takeTerminalOutput(queue, 4)]).toEqual([5, 6]);
    expect(queue).toHaveLength(0);
  });
});
