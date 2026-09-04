// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../store/auth';
import Workspace from './Workspace';

vi.mock('./ActivityBar', () => ({ default: () => <div /> }));
vi.mock('./Sidebar', () => ({
  default: ({ collapsed }: { collapsed: boolean }) => <div data-testid="left-sidebar" data-collapsed={String(collapsed)} />,
}));
vi.mock('./MainArea', () => ({ default: () => <main /> }));
vi.mock('./HeaderSearch', () => ({ default: () => <div /> }));
vi.mock('../config/SettingsPanel', () => ({ default: () => <div /> }));

describe('Workspace default panels', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { id: 1, username: 'admin', role: 'admin' }, token: 'token' });
  });

  it('keeps the left sidebar collapsed after login settles', async () => {
    render(<Workspace />);
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(screen.getByTestId('left-sidebar').dataset.collapsed).toBe('true');
  });
});
