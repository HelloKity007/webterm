import { apiDelete } from './client';

export function closeTerminalSession(connId: number, terminalId: string, workspaceIndex?: number, panelNumber?: number): Promise<unknown> {
  const layoutQuery = workspaceIndex && panelNumber ? `&workspace_index=${workspaceIndex}&panel_number=${panelNumber}` : '';
  return apiDelete(`/api/terminal-sessions/${connId}?terminal_id=${encodeURIComponent(terminalId)}${layoutQuery}`);
}
