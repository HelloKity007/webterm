// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadTicketURL, websocketTicketURL, webSocketClientID, WebSocketAuthError } from './wsTicket';

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

  it('uses a short-lived scoped ticket instead of the JWT in download URLs', async () => {
    localStorage.setItem('token', 'long-lived-jwt');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ticket: 'download-ticket' }), { status: 200 }));

    const url = await downloadTicketURL('/api/sftp/download/4', { endpoint: 'sftp-download', connId: 4 }, { path: '/tmp/report.txt' });

    expect(url).toContain('path=%2Ftmp%2Freport.txt');
    expect(url).toContain('ticket=download-ticket');
    expect(url).not.toContain('long-lived-jwt');
  });

  it('keeps a stable client id within a browser tab', () => {
    expect(webSocketClientID()).toBe(webSocketClientID());
  });
});
