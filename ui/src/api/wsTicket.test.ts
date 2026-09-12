// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { websocketTicketURL, webSocketClientID, WebSocketAuthError } from './wsTicket';

describe('websocket tickets', () => {
  afterEach(() => { vi.restoreAllMocks(); sessionStorage.clear(); localStorage.clear(); });

  it('uses bearer-authenticated REST and exposes only the short ticket in the websocket URL', async () => {
    localStorage.setItem('token', 'long-lived-jwt');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ticket: 'single-use-ticket' }), { status: 200 }));
    const url = await websocketTicketURL('/ws/ssh/4', { endpoint: 'ssh', connId: 4, terminalId: 'term-a' }, { terminal_id: 'term-a' });
    expect(url).toContain('/ws/ssh/4?terminal_id=term-a&ticket=single-use-ticket');
    expect(url).not.toContain('long-lived-jwt');
    const [, init] = fetchMock.mock.calls[0];
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer long-lived-jwt');
    expect(JSON.parse(String(init?.body))).toEqual({ endpoint: 'ssh', conn_id: 4, terminal_id: 'term-a', client_id: '' });
  });

  it('classifies forbidden ticket acquisition as non-retryable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 403 }));
    await expect(websocketTicketURL('/ws/layout', { endpoint: 'layout', clientId: 'c1' })).rejects.toBeInstanceOf(WebSocketAuthError);
  });

  it('keeps a stable client id within a browser tab', () => {
    expect(webSocketClientID()).toBe(webSocketClientID());
  });
});
