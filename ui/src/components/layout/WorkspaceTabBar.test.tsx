// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WorkspaceTabBar from './WorkspaceTabBar';
import type { WorkspaceTab } from './workspaceLayout';
import { emptyPersistedLayout } from './layoutPersistence';
import ActivityBar from './ActivityBar';
import { useWorkspaceChromeStore } from '../../store/layout';
import { useAuthStore } from '../../store/auth';

const tabs: WorkspaceTab[] = [
  { id: 'workspace-1', index: 1, name: 'workspace', layout: emptyPersistedLayout() },
  { id: 'workspace-3', index: 3, name: '<script>alert(1)</script>', layout: emptyPersistedLayout() },
];

afterEach(cleanup);

describe('WorkspaceTabBar', () => {
  it('starts collapsed and toggles through the activity rail without selecting or closing a workspace', () => {
    useWorkspaceChromeStore.setState({ expanded: false });
    const previousToken = useAuthStore.getState().token;
    useAuthStore.setState({ token: 'ui-test' });
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<><ActivityBar onOpenSettings={vi.fn()} sidebarCollapsed onToggleSidebar={vi.fn()} />
      <WorkspaceTabBar collapsible tabs={tabs} activeWorkspaceTabId="workspace-1" onSelect={onSelect} onClose={onClose} onRename={vi.fn()} onCreate={vi.fn()} /></>);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(document.querySelectorAll('.activity-rail > .activity-btn')[1]).toBe(screen.getByRole('button', { name: '展开工作区标签栏' }));
    fireEvent.click(screen.getByRole('button', { name: '展开工作区标签栏' }));
    expect(screen.getByRole('tablist')).toBeTruthy();
    expect(screen.getByRole('button', { name: '收起工作区标签栏' }).getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '收起工作区标签栏' }));
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    useAuthStore.setState({ token: previousToken });
  });
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
    fireEvent.mouseDown(input);
    expect(input).toBeTruthy();
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
    expect(screen.getByRole('radio', { name: '复制当前布局' })).toHaveProperty('checked', true);
    fireEvent.click(screen.getByRole('radio', { name: '空白工作区' }));
    fireEvent.click(screen.getByRole('button', { name: '创建工作区' }));
    expect(onCreate).toHaveBeenCalledWith('blank');

    fireEvent.click(screen.getByRole('button', { name: '新建工作区' }));
    fireEvent.click(screen.getByRole('radio', { name: '复制当前布局' }));
    fireEvent.click(screen.getByRole('button', { name: '创建工作区' }));
    expect(onCreate).toHaveBeenLastCalledWith('copy');
  });

  it('confirms destructive scope, supports cancellation and can close the last workspace', () => {
    const onClose = vi.fn();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true);
    const { rerender } = render(<WorkspaceTabBar tabs={tabs} activeWorkspaceTabId="workspace-1" onSelect={vi.fn()} onRename={vi.fn()} onCreate={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /关闭工作区: 3:/ }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /关闭工作区: 3:/ }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Shell／Claude'));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Panel: 0'));
    expect(onClose).toHaveBeenCalledWith('workspace-3');
    rerender(<WorkspaceTabBar tabs={[tabs[0]]} activeWorkspaceTabId="workspace-1" onSelect={vi.fn()} onRename={vi.fn()} onCreate={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /关闭工作区/ }));
    expect(onClose).toHaveBeenLastCalledWith('workspace-1');
  });

  it('filters workspace tabs and toggles deterministic name sorting without changing indexes', () => {
    const many: WorkspaceTab[] = [
      ...tabs,
      { id: 'workspace-2', index: 2, name: 'alpha', layout: emptyPersistedLayout() },
    ];
    render(<WorkspaceTabBar tabs={many} activeWorkspaceTabId="workspace-1" onSelect={vi.fn()} onRename={vi.fn()} onCreate={vi.fn()} />);
    expect(screen.getByRole('tab', { name: '1: workspace' })).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: '搜索工作区' }), { target: { value: 'alpha' } });
    expect(screen.getByRole('tab', { name: '2: alpha' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: '1: workspace' })).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: '搜索工作区' }), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '排序工作区' }));
    const rendered = screen.getAllByRole('tab').map((tab) => tab.getAttribute('aria-label'));
    expect(rendered[0]).toBe('3: <script>alert(1)</script>');
    expect(screen.getByRole('tab', { name: '1: workspace' })).toBeTruthy();
  });

  it('emits before/after reorder drops, including cross-window transfer payloads', () => {
    const onReorder = vi.fn();
    render(<WorkspaceTabBar tabs={[...tabs, { id: 'workspace-2', index: 2, name: 'two', layout: emptyPersistedLayout() }]} activeWorkspaceTabId="workspace-1" onSelect={vi.fn()} onRename={vi.fn()} onCreate={vi.fn()} onReorder={onReorder} />);
    const source = screen.getByRole('tab', { name: '1: workspace' });
    const target = screen.getByRole('tab', { name: '2: two' });
    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: vi.fn().mockReturnValue('webterm-workspace:workspace-1') };
    fireEvent.dragStart(source, { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'webterm-workspace:workspace-1');
    fireEvent.drop(target, { dataTransfer, clientX: 9999 });
    expect(onReorder).toHaveBeenCalledWith('workspace-1', 'workspace-2', false);
  });
});
