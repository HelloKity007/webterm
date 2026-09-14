// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MainArea from './MainArea';

const layoutState: { activeModule: 'ssh' | 'files' | 'sftp'; drainTabQueue: () => never[] } = {
  activeModule: 'ssh',
  drainTabQueue: () => [],
};
vi.mock('../../store/layout', async (importOriginal) => ({ ...await importOriginal<typeof import('../../store/layout')>(), useLayoutStore: (selector: (state: typeof layoutState) => unknown) => selector(layoutState) }));
const { fetchConnections } = vi.hoisted(() => ({ fetchConnections: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../store/connections', () => ({ useConnectionStore: (selector: (state: { connections: never[]; fetchConnections: typeof fetchConnections }) => unknown) => selector({ connections: [], fetchConnections }) }));
vi.mock('./SplitPane', () => ({ default: () => <div data-testid="terminal-workspace" /> }));
vi.mock('../sftp/DualPaneSftp', () => ({ default: () => <div data-testid="dual-pane-files" /> }));
vi.mock('../config/ConfigPage', () => ({ default: () => <div /> }));
vi.mock('./TabBar', () => ({ default: () => <div /> }));

describe('MainArea unified file workspace', () => {
  afterEach(() => { cleanup(); layoutState.activeModule = 'ssh'; fetchConnections.mockClear(); });

  it('keeps SSH focused on the terminal without mounting the removed SSH file sidebar', () => {
    render(<MainArea />);

    expect(screen.getByTestId('terminal-workspace').parentElement?.parentElement?.style.display).toBe('flex');
    expect(document.querySelector('.ssh-files-sidebar')).toBeNull();
    expect(document.querySelector('.ssh-files-resize')).toBeNull();
  });

  it('renders the dual-pane manager for the new files module', () => {
    layoutState.activeModule = 'files';
    render(<MainArea />);

    expect(screen.getByTestId('file-workspace').style.display).toBe('flex');
    expect(screen.getByTestId('dual-pane-files')).toBeTruthy();
    expect(fetchConnections).toHaveBeenCalledOnce();
  });

  it('maps a legacy persisted sftp module to the file workspace instead of a blank view', () => {
    layoutState.activeModule = 'sftp';
    render(<MainArea />);

    expect(screen.getByTestId('file-workspace').style.display).toBe('flex');
  });
});
