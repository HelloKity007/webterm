// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MainArea from './MainArea';
import { useWorkspaceChromeStore } from '../../store/layout';

const layoutState = { activeModule: 'ssh', drainTabQueue: () => [] };
vi.mock('../../store/layout', async (importOriginal) => ({ ...await importOriginal<typeof import('../../store/layout')>(), useLayoutStore: (selector: (state: typeof layoutState) => unknown) => selector(layoutState) }));
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
  afterEach(() => { cleanup(); useWorkspaceChromeStore.setState({ filesExpanded: false }); });
  it('opens an SSH tab with the left SFTP sidebar collapsed, then toggles without remounting it', () => {
    render(<MainArea />);
    fireEvent.click(screen.getByTestId('activate-ssh'));

    expect(screen.getByTestId('right-sidebar').parentElement?.style.width).toBe('0px');
    const panel = screen.getByTestId('right-sidebar');
    expect(panel.parentElement?.style.order).toBe('-1');
    act(() => useWorkspaceChromeStore.getState().toggleFiles());
    expect(panel.parentElement?.style.width).toBe('260px');
    expect(panel.parentElement?.hasAttribute('inert')).toBe(false);
    act(() => useWorkspaceChromeStore.getState().toggleFiles());
    expect(screen.getByTestId('right-sidebar')).toBe(panel);
    expect(panel.parentElement?.style.width).toBe('0px');
    expect(panel.parentElement?.hasAttribute('inert')).toBe(true);
  });
});
