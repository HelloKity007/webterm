// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import App from './App';
import { useAuthStore } from './store/auth';

describe('App login gate', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({ user: null, token: null });
  });

  it('shows username and password fields together before login', () => {
    render(<App />);

    expect(screen.getByPlaceholderText(/用户名|Username/)).toBeTruthy();
    expect(screen.getByPlaceholderText(/密码|Password/)).toBeTruthy();
  });
});
