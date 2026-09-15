// @vitest-environment jsdom
import { act, render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PersistentTerminalTab from './PersistentTerminalTab';
import { discardPersistentTerminal } from './persistentTerminalStore';

vi.mock('./TerminalTab', () => ({ default: () => <textarea aria-label="preserved terminal" defaultValue="draft" /> }));
afterEach(async () => {
  await act(async () => { cleanup(); });
  discardPersistentTerminal('move-test');
  discardPersistentTerminal('workspace-switch-test');
});

describe('terminal ownership during cross-pane move', () => {
  it('moves the exact terminal DOM without losing its current content', async () => {
    const Layout = ({ moved }: { moved: boolean }) => <>
      <section>{!moved && <PersistentTerminalTab connId={1} myTabId="move-test" />}</section>
      <section>{moved && <PersistentTerminalTab connId={1} myTabId="move-test" />}</section>
    </>;
    const view = render(<Layout moved={false} />);
    const original = await screen.findByLabelText('preserved terminal');
    (original as HTMLTextAreaElement).value = 'unsubmitted content';
    await act(async () => { view.rerender(<Layout moved />); });
    expect(screen.getByLabelText('preserved terminal')).toBe(original);
    expect((original as HTMLTextAreaElement).value).toBe('unsubmitted content');
    await act(async () => { view.rerender(<Layout moved={false} />); });
    expect(screen.getByLabelText('preserved terminal')).toBe(original);
  });

  it('keeps browser-owned shell state through a workspace hide and return', async () => {
    const Layout = ({ visible }: { visible: boolean }) => visible
      ? <PersistentTerminalTab connId={1} myTabId="workspace-switch-test" />
      : <div>other workspace</div>;
    const view = render(<Layout visible />);
    const original = await screen.findByLabelText('preserved terminal');
    (original as HTMLTextAreaElement).value = 'middle scrollback marker';
    await act(async () => { view.rerender(<Layout visible={false} />); });
    await act(async () => { view.rerender(<Layout visible />); });
    expect(screen.getByLabelText('preserved terminal')).toBe(original);
    expect((original as HTMLTextAreaElement).value).toBe('middle scrollback marker');
  });
});
