// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TabBar from './TabBar';
import { horizontalTabScrollTarget } from './tabBarScroll';

describe('TabBar', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it('renders a pane new-tab button when requested', () => {
    const onAddTab = vi.fn();
    render(<TabBar
      tabs={[{ id: 'ssh-1', type: 'ssh', title: '本机', connId: 1 }]}
      activeTabId="ssh-1"
      onSelectTab={() => {}}
      onCloseTab={() => {}}
      onAddTab={onAddTab}
    />);

    fireEvent.click(screen.getByRole('button', { name: '新建标签' }));
    expect(onAddTab).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('广播')).toBeNull();
  });

  it('keeps a fixed tab number while a double-click renames only the title', () => {
    const onRenameTab = vi.fn();
    render(<TabBar
      tabs={[{ id: 'ssh-7', type: 'ssh', title: 'x99', connId: 7, labelNumber: 3 }]}
      activeTabId="ssh-7"
      onSelectTab={() => {}}
      onCloseTab={() => {}}
      onRenameTab={onRenameTab}
    />);

    fireEvent.doubleClick(screen.getByText('3: x99'));
    const input = screen.getByDisplayValue('x99');
    fireEvent.change(input, { target: { value: '生产机' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onRenameTab).toHaveBeenCalledWith('ssh-7', '生产机');
    expect(screen.getByText('3: x99')).toBeTruthy();
  });

  it('confirms before closing a terminal tab', () => {
    const onCloseTab = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<TabBar tabs={[{ id: 'ssh-1', type: 'ssh', title: '本机', connId: 1 }]} activeTabId="ssh-1" onSelectTab={() => {}} onCloseTab={onCloseTab} />);
    const close = screen.getByLabelText('关闭标签');
    fireEvent.click(close);
    fireEvent.click(close);
    expect(onCloseTab).toHaveBeenCalledTimes(1);
  });

  it('disables native tab dragging on touch devices so the bar can pan horizontally', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    render(<TabBar tabs={[{ id: 'ssh-1', type: 'ssh', title: '本机', connId: 1 }]} activeTabId="ssh-1" onSelectTab={() => {}} onCloseTab={() => {}} />);

    const tab = screen.getByText('1: 本机');
    expect(tab.getAttribute('draggable')).toBe('false');
    expect(tab.getAttribute('data-terminal-tab')).toBe('true');
  });

  it('maps a mouse wheel over overflowing panel names to horizontal movement', () => {
    expect(horizontalTabScrollTarget(0, 300, 900, 0, 100, 0)).toBe(100);
    expect(horizontalTabScrollTarget(590, 300, 900, 0, 100, 0)).toBe(600);
    expect(horizontalTabScrollTarget(600, 300, 900, 0, 100, 0)).toBeNull();
    expect(horizontalTabScrollTarget(0, 300, 900, 0, -100, 0)).toBeNull();
    expect(horizontalTabScrollTarget(200, 300, 900, 2, 0, 1)).toBe(248);
  });
});
