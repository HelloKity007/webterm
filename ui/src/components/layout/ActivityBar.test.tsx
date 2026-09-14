// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ActivityBar from './ActivityBar';
import { useAuthStore } from '../../store/auth';
import { useLayoutStore } from '../../store/layout';

describe('ActivityBar file entry', () => {
  afterEach(() => {
    cleanup();
    useAuthStore.setState({ token: null });
    useLayoutStore.setState({ activeModule: 'ssh' });
  });

  it('shows one unified Files entry and removes the SSH file-list toggle', () => {
    useAuthStore.setState({ token: 'ui-test' });
    render(<ActivityBar onOpenSettings={vi.fn()} sidebarCollapsed onToggleSidebar={vi.fn()} />);

    expect(document.querySelectorAll('.activity-files')).toHaveLength(1);
    expect(document.querySelector('.ssh-files-toggle')).toBeNull();
    expect(screen.getAllByRole('button', { name: '文件' })).toHaveLength(1);
  });

  it('switches directly from the terminal to the unified file workspace', () => {
    useAuthStore.setState({ token: 'ui-test' });
    render(<ActivityBar onOpenSettings={vi.fn()} sidebarCollapsed onToggleSidebar={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '文件' }));
    expect(useLayoutStore.getState().activeModule).toBe('files');
  });
});
