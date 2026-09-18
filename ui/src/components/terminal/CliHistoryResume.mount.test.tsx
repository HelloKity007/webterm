// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Terminal } from '@xterm/xterm';
import CliHistoryResume from './CliHistoryResume';

afterEach(() => { cleanup(); document.body.replaceChildren(); vi.unstubAllGlobals(); });

it('attaches a restored reading hint when the terminal is created after its child mounts', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  const root = document.createElement('div');
  const surface = document.createElement('div');
  const terminalScreen = document.createElement('div');
  terminalScreen.className = 'xterm-screen';
  surface.dataset.terminalMode = 'cli';
  surface.append(terminalScreen); root.append(surface); document.body.append(root);
  Object.defineProperty(root, 'clientHeight', { value: 500 });
  root.getBoundingClientRect = () => new DOMRect(0, 0, 500, 500);
  terminalScreen.getBoundingClientRect = () => new DOMRect(0, 50, 500, 300);
  const terminalRef = { current: null as Terminal | null };
  const surfaceRef = { current: surface };
  const view = render(<CliHistoryResume terminalRef={terminalRef} surfaceRef={surfaceRef}
    active revision={0} onResume={() => {}} />);
  expect(screen.queryByRole('button')).toBeNull();
  const lines = ['history', 'more history', '─────────', '❯ draft', '─────────'];
  terminalRef.current = {
    rows: 5, element: surface,
    buffer: { active: { viewportY: 0, getLine: (row: number) => ({ translateToString: () => lines[row] }) } },
    onRender: () => ({ dispose() {} }),
  } as unknown as Terminal;
  view.rerender(<CliHistoryResume terminalRef={terminalRef} surfaceRef={surfaceRef}
    active revision={1} onResume={() => {}} />);
  await waitFor(() => expect(screen.queryByRole('button')).not.toBeNull());
  expect(screen.getByRole('button').style.top).toBe('143px');
});
