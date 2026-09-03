// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TabBar from './TabBar';

describe('TabBar', () => {
  it('lets an authorized caller add another managed local SSH session', () => {
    const onQuickConnect = vi.fn();
    render(<TabBar
      tabs={[{ id: 'ssh-1', type: 'ssh', title: '本机', connId: 1 }]}
      activeTabId="ssh-1"
      onSelectTab={() => {}}
      onCloseTab={() => {}}
      quickConnect={{ label: '新增本机会话', onClick: onQuickConnect }}
    />);

    fireEvent.click(screen.getByRole('button', { name: '新增本机会话' }));

    expect(onQuickConnect).toHaveBeenCalledOnce();
  });
});
