// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WorkspaceTabBar from './WorkspaceTabBar';
import type { WorkspaceTab } from './workspaceLayout';
import { emptyPersistedLayout } from './layoutPersistence';

const tabs: WorkspaceTab[] = [
  { id: 'workspace-1', index: 1, name: 'workspace', layout: emptyPersistedLayout() },
  { id: 'workspace-3', index: 3, name: '<script>alert(1)</script>', layout: emptyPersistedLayout() },
];

afterEach(cleanup);

describe('WorkspaceTabBar', () => {
  it('shows stable indexes and renders names as text', () => {
    render(<WorkspaceTabBar tabs={tabs} activeWorkspaceTabId="workspace-1" onSelect={vi.fn()} onRename={vi.fn()} onCreate={vi.fn()} />);

    expect(screen.getByRole('tab', { name: '1: workspace' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '3: <script>alert(1)</script>' })).toBeTruthy();
    expect(document.querySelector('script')).toBeNull();
  });

  it('renames with Enter, cancels with Escape, and ignores a blank name on blur', () => {
    const onRename = vi.fn();
    render(<WorkspaceTabBar tabs={tabs} activeWorkspaceTabId="workspace-1" onSelect={vi.fn()} onRename={onRename} onCreate={vi.fn()} />);

    fireEvent.doubleClick(screen.getByRole('tab', { name: '1: workspace' }));
    const input = screen.getByRole('textbox', { name: '工作区名称' });
    fireEvent.change(input, { target: { value: 'production' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRename).toHaveBeenCalledWith('workspace-1', 'production');

    fireEvent.doubleClick(screen.getByRole('tab', { name: '1: workspace' }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: '工作区名称' }), { key: 'Escape' });
    expect(onRename).toHaveBeenCalledTimes(1);

    fireEvent.doubleClick(screen.getByRole('tab', { name: '1: workspace' }));
    const blankInput = screen.getByRole('textbox', { name: '工作区名称' });
    fireEvent.change(blankInput, { target: { value: '   ' } });
    fireEvent.blur(blankInput);
    expect(onRename).toHaveBeenCalledTimes(1);
  });

  it('defaults creation to blank and supports an explicit copy choice', () => {
    const onCreate = vi.fn();
    render(<WorkspaceTabBar tabs={tabs} activeWorkspaceTabId="workspace-1" onSelect={vi.fn()} onRename={vi.fn()} onCreate={onCreate} />);

    fireEvent.click(screen.getByRole('button', { name: '新建工作区' }));
    expect(screen.getByRole('radio', { name: '空白工作区' })).toHaveProperty('checked', true);
    fireEvent.click(screen.getByRole('button', { name: '创建工作区' }));
    expect(onCreate).toHaveBeenCalledWith('blank');

    fireEvent.click(screen.getByRole('button', { name: '新建工作区' }));
    fireEvent.click(screen.getByRole('radio', { name: '复制当前布局' }));
    fireEvent.click(screen.getByRole('button', { name: '创建工作区' }));
    expect(onCreate).toHaveBeenLastCalledWith('copy');
  });
});
