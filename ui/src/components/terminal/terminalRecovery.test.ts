// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { recoverTerminalIdentities, recoverTerminalIdentity, type TerminalRecoveryActions, type TerminalRecoveryTarget } from './terminalRecovery';

const target: TerminalRecoveryTarget = { connId: 7, terminalId: 'terminal-abc', workspaceIndex: 2, panelNumber: 47 };

function actions(overrides: Partial<TerminalRecoveryActions>): TerminalRecoveryActions {
  return {
    probe: vi.fn(async () => 'ready' as const),
    adopt: vi.fn(async () => ({ status: 'active' })),
    replace: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('recoverTerminalIdentity', () => {
  it('leaves a panel alone when its identity already verifies', async () => {
    const run = actions({ probe: vi.fn(async () => 'ready' as const) });

    await expect(recoverTerminalIdentity(target, run)).resolves.toBe('ready');
    expect(run.adopt).not.toHaveBeenCalled();
    expect(run.replace).not.toHaveBeenCalled();
  });

  it('binds an existing remote session through adoption', async () => {
    const probe = vi.fn()
      .mockResolvedValueOnce('unverified' as const)
      .mockResolvedValueOnce('ready' as const);
    const run = actions({ probe });

    await expect(recoverTerminalIdentity(target, run)).resolves.toBe('adopted');
    expect(run.adopt).toHaveBeenCalledWith(target);
    expect(run.replace).not.toHaveBeenCalled();
  });

  it('replaces the panel when nothing can be bound', async () => {
    const run = actions({ probe: vi.fn(async () => 'unverified' as const) });

    await expect(recoverTerminalIdentity(target, run)).resolves.toBe('replaced');
    expect(run.adopt).toHaveBeenCalledTimes(1);
    expect(run.replace).toHaveBeenCalledWith(target);
  });

  it('replaces a panel whose identity verifies but whose session is gone', async () => {
    const run = actions({ probe: vi.fn(async () => 'unavailable' as const) });

    await expect(recoverTerminalIdentity(target, run)).resolves.toBe('replaced');
  });

  it('keeps failing quiet when the replacement cannot be created', async () => {
    const run = actions({
      probe: vi.fn(async () => 'unverified' as const),
      replace: vi.fn(async () => { throw new Error('creation denied'); }),
    });

    await expect(recoverTerminalIdentity(target, run)).resolves.toBe('failed');
  });

  it('still replaces when adoption itself throws', async () => {
    const run = actions({
      probe: vi.fn(async () => 'unverified' as const),
      adopt: vi.fn(async () => { throw new Error('identity belongs to another endpoint'); }),
    });

    await expect(recoverTerminalIdentity(target, run)).resolves.toBe('replaced');
    expect(run.replace).toHaveBeenCalledTimes(1);
  });
});

describe('recoverTerminalIdentities', () => {
  it('recovers every panel and reports a per-tab outcome', async () => {
    const targets = [
      { connId: 1, terminalId: 'a', workspaceIndex: 1, panelNumber: 1 },
      { connId: 1, terminalId: 'b', workspaceIndex: 1, panelNumber: 2 },
      { connId: 1, terminalId: 'c', workspaceIndex: 1, panelNumber: 3 },
    ];
    const run = actions({
      probe: vi.fn(async (incoming: { terminalId: string }) => incoming.terminalId === 'a' ? 'ready' : 'unverified') as TerminalRecoveryActions['probe'],
    });

    const outcomes = await recoverTerminalIdentities(targets, run, 2);

    expect(outcomes.get('a')).toBe('ready');
    expect(outcomes.get('b')).toBe('replaced');
    expect(outcomes.get('c')).toBe('replaced');
    expect(run.adopt).toHaveBeenCalledTimes(2);
  });

  it('bounds concurrent probes', async () => {
    let inFlight = 0;
    let peak = 0;
    const run = actions({
      probe: vi.fn(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return 'ready' as const;
      }),
    });
    const targets = Array.from({ length: 8 }, (_, index) => ({
      connId: 1, terminalId: `t${index}`, workspaceIndex: 1, panelNumber: index + 1,
    }));

    await recoverTerminalIdentities(targets, run, 3);

    expect(peak).toBeLessThanOrEqual(3);
  });
});
