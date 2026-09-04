import { apiDelete } from './client';

export function closeTerminalSession(connId: number, terminalId: string): Promise<unknown> {
  return apiDelete(`/api/terminal-sessions/${connId}?terminal_id=${encodeURIComponent(terminalId)}`);
}
