// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ContextMenu from './ContextMenu';

describe('ContextMenu', () => {
  it('closes when an outside surface stops the mouse event from bubbling', () => {
    const onClose = vi.fn();
    render(
      <div data-testid="outside" onMouseDownCapture={(event) => event.stopPropagation()}>
        <ContextMenu x={10} y={10} items={[{ label: 'Copy', action: vi.fn() }]} onClose={onClose} />
      </div>,
    );

    fireEvent.mouseDown(screen.getByTestId('outside'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('waits for an asynchronous action before closing', async () => {
    let finishAction: () => void = () => {};
    const action = vi.fn(() => new Promise<void>((resolve) => { finishAction = resolve; }));
    const onClose = vi.fn();
    render(<ContextMenu x={10} y={10} items={[{ label: 'Paste', action }]} onClose={onClose} />);

    fireEvent.click(screen.getByText('Paste'));

    expect(action).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    finishAction();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
