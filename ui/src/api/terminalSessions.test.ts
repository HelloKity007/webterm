// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { closeTerminalSession } from './terminalSessions';

describe('closeTerminalSession', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('token', 'close-token');
  });

  it('requests deletion of the exact connection and terminal ID', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"status":"ok"}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await closeTerminalSession(12, 'ssh-12-pane a; rm -rf /');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/terminal-sessions/12?terminal_id=ssh-12-pane%20a%3B%20rm%20-rf%20%2F',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({ Authorization: 'Bearer close-token' }),
      }),
    );
  });
});
