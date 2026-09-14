export function layoutEventRevision(raw: string, currentRevision: number): number | null {
  try {
    const message: unknown = JSON.parse(raw);
    if (typeof message !== 'object' || message === null || !('revision' in message)) return null;
    const revision = (message as { revision: unknown }).revision;
    return typeof revision === 'number' && Number.isSafeInteger(revision) && revision > currentRevision ? revision : null;
  } catch {
    return null;
  }
}

export type PresenceControlEvent =
  | { type: 'presence_snapshot'; terminals: Record<string, number> }
  | { type: 'presence_delta'; terminalId: string; online: number };

export function presenceControlEvent(raw: string): PresenceControlEvent | null {
  try {
    const message = JSON.parse(raw) as Partial<PresenceControlEvent>;
    if (message.type === 'presence_snapshot' && message.terminals && typeof message.terminals === 'object') {
      const terminals: Record<string, number> = {};
      for (const [terminalID, online] of Object.entries(message.terminals)) {
        if (terminalID && typeof online === 'number' && Number.isSafeInteger(online) && online >= 0) terminals[terminalID] = online;
      }
      return { type: 'presence_snapshot', terminals };
    }
    if (message.type === 'presence_delta' && typeof message.terminalId === 'string' && message.terminalId.length > 0 &&
      typeof message.online === 'number' && Number.isSafeInteger(message.online) && message.online >= 0) {
      return { type: 'presence_delta', terminalId: message.terminalId, online: message.online };
    }
  } catch { /* malformed control messages are ignored */ }
  return null;
}
