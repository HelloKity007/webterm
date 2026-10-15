import { ApiError, apiDelete, apiGet, apiPost } from './client';

export async function createTerminalSession(connId: number): Promise<string> {
  const result = await apiPost(`/api/terminal-sessions/${encodeURIComponent(connId)}`, {}) as { terminal_id?: unknown };
  if (typeof result.terminal_id !== 'string' || !result.terminal_id.startsWith('terminal-')) {
    throw new Error('terminal creation returned an invalid identity');
  }
  return result.terminal_id;
}

export type TerminalIdentityStatus = 'ready' | 'unverified' | 'unavailable';

// Non-attaching probe of one durable identity. 'unverified' means the identity
// record cannot authorize an attach (missing, inactive or scoped elsewhere);
// 'unavailable' means the identity is fine but its remote session is not.
export async function probeTerminalIdentity(connId: number, terminalId: string): Promise<TerminalIdentityStatus> {
  try {
    await apiGet(`/api/terminal-health/${encodeURIComponent(connId)}?terminal_id=${encodeURIComponent(terminalId)}`);
    return 'ready';
  } catch (error) {
    if (error instanceof ApiError && error.code === 'TERMINAL_IDENTITY_UNAVAILABLE') return 'unverified';
    if (error instanceof ApiError && error.status === 503) return 'unavailable';
    throw error;
  }
}

export function adoptTerminalSession(connId: number, terminalId: string, workspaceIndex: number, panelNumber: number): Promise<unknown> {
  return apiPost(`/api/terminal-sessions/${encodeURIComponent(connId)}/adopt`, {
    terminal_id: terminalId,
    workspace_index: workspaceIndex,
    panel_number: panelNumber,
  });
}

export function closeTerminalSession(connId: number, terminalId: string, workspaceIndex?: number, panelNumber?: number, terminate = false): Promise<unknown> {
  const layoutQuery = workspaceIndex && panelNumber ? `&workspace_index=${workspaceIndex}&panel_number=${panelNumber}` : '';
  return apiDelete(`/api/terminal-sessions/${connId}?terminal_id=${encodeURIComponent(terminalId)}${layoutQuery}${terminate ? '&terminate=1' : ''}`);
}

// A legacy tab which could not be adopted has no verified terminal identity.
// It cannot be closed through the remote-session endpoint without weakening
// the identity guard, but removing it from this browser layout is safe: that
// operation neither creates, replaces, nor terminates any remote process.
export function canDismissUnverifiedTerminal(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'TERMINAL_IDENTITY_UNAVAILABLE';
}
