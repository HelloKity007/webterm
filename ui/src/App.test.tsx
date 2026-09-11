// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { useAuthStore } from './store/auth';

describe('App login gate', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({ user: null, token: null });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows username and password fields when test auto-login is disabled', async () => {
    render(<App />);

    expect(await screen.findByPlaceholderText(/用户名|Username/)).toBeTruthy();
    expect(screen.getByPlaceholderText(/密码|Password/)).toBeTruthy();
  });
});
