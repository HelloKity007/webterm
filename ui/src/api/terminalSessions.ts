import { apiDelete, apiPost } from './client';

export async function createTerminalSession(connId: number): Promise<string> {
  const result = await apiPost(`/api/terminal-sessions/${encodeURIComponent(connId)}`, {}) as { terminal_id?: unknown };
  if (typeof result.terminal_id !== 'string' || !result.terminal_id.startsWith('terminal-')) {
    throw new Error('terminal creation returned an invalid identity');
  }
  return result.terminal_id;
}

export function closeTerminalSession(connId: number, terminalId: string, workspaceIndex?: number, panelNumber?: number, terminate = false): Promise<unknown> {
  const layoutQuery = workspaceIndex && panelNumber ? `&workspace_index=${workspaceIndex}&panel_number=${panelNumber}` : '';
  return apiDelete(`/api/terminal-sessions/${connId}?terminal_id=${encodeURIComponent(terminalId)}${layoutQuery}${terminate ? '&terminate=1' : ''}`);
}
