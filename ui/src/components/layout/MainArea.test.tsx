// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MainArea from './MainArea';

const layoutState = { activeModule: 'ssh', drainTabQueue: () => [] };
vi.mock('../../store/layout', () => ({ useLayoutStore: (selector: (state: typeof layoutState) => unknown) => selector(layoutState) }));
vi.mock('../../store/connections', () => ({ useConnectionStore: (selector: (state: { connections: never[] }) => unknown) => selector({ connections: [] }) }));
vi.mock('./SplitPane', () => ({
  default: ({ onActiveSshChange }: { onActiveSshChange: (connId: number, tabId: string) => void }) => (
    <button data-testid="activate-ssh" onClick={() => onActiveSshChange(7, 'tab-7')} />
  ),
}));
vi.mock('../sftp/SftpPanel', () => ({ default: () => <div data-testid="right-sidebar" /> }));
vi.mock('../sftp/DualPaneSftp', () => ({ default: () => <div /> }));
vi.mock('../config/ConfigPage', () => ({ default: () => <div /> }));
vi.mock('./TabBar', () => ({ default: () => <div /> }));

describe('MainArea default panels', () => {
  it('opens an SSH tab with the right SFTP sidebar collapsed', () => {
    render(<MainArea />);
    fireEvent.click(screen.getByTestId('activate-ssh'));

    expect(screen.getByTestId('right-sidebar').parentElement?.style.width).toBe('0px');
  });
});
