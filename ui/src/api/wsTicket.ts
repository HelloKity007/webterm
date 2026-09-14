import { apiFetch } from './client';

export type WSEndpoint = 'ssh' | 'sftp' | 'db' | 'layout' | 'local-fs' | 'sftp-download' | 'local-download';
export interface WSTicketScope {
  endpoint: WSEndpoint;
  connId?: number;
  terminalId?: string;
  clientId?: string;
}

export class WebSocketAuthError extends Error {
  retryable = false;
}

export function webSocketClientID(): string {
  const key = 'webterm-ws-client-id';
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = globalThis.crypto?.randomUUID?.() || `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(key, id);
  }
  return id;
}

export async function websocketTicketURL(path: string, scope: WSTicketScope, query: Record<string, string> = {}): Promise<string> {
  const ticket = await issueScopedTicket(scope);
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = new URL(`${protocol}//${location.host}${path}`);
  Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));
  url.searchParams.set('ticket', ticket);
  return url.toString();
}

async function issueScopedTicket(scope: WSTicketScope): Promise<string> {
  const response = await apiFetch('/api/ws-tickets', {
    method: 'POST',
    body: JSON.stringify({
      endpoint: scope.endpoint,
      conn_id: scope.connId || 0,
      terminal_id: scope.terminalId || '',
      client_id: scope.clientId || '',
    }),
  });
  if (!response.ok) {
    const message = `websocket ticket failed (${response.status})`;
    if (response.status === 401 || response.status === 403) throw new WebSocketAuthError(message);
    throw new Error(message);
  }
  const body = await response.json() as { ticket?: string };
  if (!body.ticket) throw new Error('websocket ticket response is invalid');
  return body.ticket;
}

export async function downloadTicketURL(path: string, scope: WSTicketScope, query: Record<string, string> = {}): Promise<string> {
  const ticket = await issueScopedTicket(scope);
  const url = new URL(path, location.origin);
  Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));
  url.searchParams.set('ticket', ticket);
  return `${url.pathname}${url.search}`;
}
