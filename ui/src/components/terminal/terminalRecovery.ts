import { adoptTerminalSession, probeTerminalIdentity, type TerminalIdentityStatus } from '../../api/terminalSessions';

export interface TerminalRecoveryTarget {
  connId: number;
  terminalId: string;
  workspaceIndex: number;
  panelNumber: number;
}

export type TerminalRecoveryOutcome = 'ready' | 'adopted' | 'replaced' | 'failed';

export interface TerminalRecoveryActions {
  probe: (target: TerminalRecoveryTarget) => Promise<TerminalIdentityStatus>;
  adopt: (target: TerminalRecoveryTarget) => Promise<unknown>;
  replace: (target: TerminalRecoveryTarget) => Promise<unknown>;
}

// Background recovery for one panel. Bind to an already-existing remote
// session first (adopt never creates one); only when nothing can be bound is
// the panel replaced with a fresh terminal. The user is never asked, and a
// panel that already verifies is left completely alone.
export async function recoverTerminalIdentity(
  target: TerminalRecoveryTarget,
  actions: TerminalRecoveryActions,
): Promise<TerminalRecoveryOutcome> {
  if (await actions.probe(target) === 'ready') return 'ready';
  try {
    await actions.adopt(target);
  } catch {
    // Nothing was bound, so the identity is unchanged: skip the re-probe.
    try {
      await actions.replace(target);
      return 'replaced';
    } catch {
      return 'failed';
    }
  }
  if (await actions.probe(target) === 'ready') return 'adopted';
  try {
    await actions.replace(target);
    return 'replaced';
  } catch {
    return 'failed';
  }
}

const recoveryInFlight = new Map<string, Promise<TerminalRecoveryOutcome>>();

// A layout reload and a pane mounting may ask for the same panel at once.
// One attempt per terminal id keeps recovery from creating duplicate sessions.
export function recoverTerminalIdentityOnce(
  target: TerminalRecoveryTarget,
  actions: TerminalRecoveryActions,
): Promise<TerminalRecoveryOutcome> {
  const existing = recoveryInFlight.get(target.terminalId);
  if (existing) return existing;
  const task = recoverTerminalIdentity(target, actions).finally(() => recoveryInFlight.delete(target.terminalId));
  recoveryInFlight.set(target.terminalId, task);
  return task;
}

export function defaultTerminalRecoveryActions(replace: (target: TerminalRecoveryTarget) => Promise<unknown>): TerminalRecoveryActions {
  return {
    probe: (target) => probeTerminalIdentity(target.connId, target.terminalId),
    adopt: (target) => adoptTerminalSession(target.connId, target.terminalId, target.workspaceIndex, target.panelNumber),
    replace,
  };
}

// Keep concurrent SSH probes bounded: a workspace can hold dozens of panels and
// every probe is a remote command.
export async function recoverTerminalIdentities(
  targets: TerminalRecoveryTarget[],
  actions: TerminalRecoveryActions,
  concurrency = 3,
): Promise<Map<string, TerminalRecoveryOutcome>> {
  const outcomes = new Map<string, TerminalRecoveryOutcome>();
  const queue = [...targets];
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, async () => {
    for (let target = queue.shift(); target; target = queue.shift()) {
      try {
        outcomes.set(target.terminalId, await recoverTerminalIdentityOnce(target, actions));
      } catch {
        outcomes.set(target.terminalId, 'failed');
      }
    }
  });
  await Promise.all(workers);
  return outcomes;
}
