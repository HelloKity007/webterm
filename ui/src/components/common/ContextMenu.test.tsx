// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ContextMenu from './ContextMenu';

describe('ContextMenu', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

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

  it('measures itself and opens above a bottom-of-viewport click point', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 140, height: 120, top: 0, left: 0, right: 140, bottom: 120, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    const viewportHeight = window.innerHeight;

    render(<ContextMenu x={40} y={viewportHeight - 10} items={[{ label: 'Copy', action: vi.fn() }]} onClose={vi.fn()} />);

    const menu = screen.getByText('Copy').parentElement as HTMLElement;
    expect(menu.style.top).toBe(`${viewportHeight - 10 - 120}px`);
    expect(menu.style.visibility).toBe('visible');
    expect(parseFloat(menu.style.top) + 120).toBeLessThanOrEqual(viewportHeight - 8);
  });
});
