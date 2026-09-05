// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { clearTerminalHistory, copyTerminalText, createTerminalMouseState, getTerminalGridPosition, getTerminalSelectionRange, pasteTerminalText, routeTerminalClipboardShortcut, routeTerminalControlShortcut, routeTerminalContextMenu, routeTerminalMouseDown, routeTerminalMouseMove, routeTerminalMouseUp } from './terminalInteractions';

describe('terminal right-click routing', () => {
  it('keeps a plain right-click in the frontend and blocks tmux mouse handling', () => {
    const event = {
      button: 2,
      ctrlKey: false,
      clientX: 20,
      clientY: 30,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    const openFrontendMenu = vi.fn();

    routeTerminalMouseDown(event);
    routeTerminalContextMenu(event, openFrontendMenu);

    // Do not cancel mousedown: Edge may then suppress the contextmenu event.
    // The contextmenu itself is still cancelled so the browser menu stays hidden.
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(2);
    expect(openFrontendMenu).toHaveBeenCalledWith({ x: 20, y: 30 });
  });

  it('reserves Ctrl+right-click for tmux without opening the frontend menu', () => {
    const target = document.createElement('div');
    const forwarded = vi.fn();
    target.addEventListener('mousedown', (event) => forwarded(event.button, event.ctrlKey, event.altKey));
    const event = {
      button: 2,
      ctrlKey: true,
      clientX: 20,
      clientY: 30,
      target,
      nativeEvent: new MouseEvent('mousedown', { button: 2, ctrlKey: true }),
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    const openFrontendMenu = vi.fn();

    routeTerminalMouseDown(event);
    routeTerminalContextMenu(event, openFrontendMenu);

    expect(event.preventDefault).toHaveBeenCalledTimes(2);
    // Capture-phase contextmenu ownership keeps xterm/browser context handling
    // from interfering after the tmux-bound mousedown.
    expect(event.stopPropagation).toHaveBeenCalledTimes(2);
    expect(forwarded).toHaveBeenCalledWith(2, false, true);
    expect(openFrontendMenu).not.toHaveBeenCalled();
  });

  it('swallows the Ctrl+right-click release so the tmux menu stays open', () => {
    const target = document.createElement('div');
    const forwarded = vi.fn();
    target.addEventListener('mouseup', (event) => forwarded(event.button, event.ctrlKey, event.altKey));
    const event = {
      button: 2,
      ctrlKey: true,
      clientX: 20,
      clientY: 30,
      target,
      nativeEvent: new MouseEvent('mouseup', { button: 2, ctrlKey: true }),
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };

    routeTerminalMouseUp(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    expect(forwarded).not.toHaveBeenCalled();
  });

  it('keeps the tmux menu open by consuming unsupported pointer movement', () => {
    const state = createTerminalMouseState();
    const target = document.createElement('div');
    const forwarded = vi.fn();
    const moveTmuxMenuAt = vi.fn();
    target.addEventListener('mousemove', (event) => forwarded(event.buttons, event.altKey));
    const down = {
      button: 2, ctrlKey: true, clientX: 20, clientY: 30, target,
      nativeEvent: new MouseEvent('mousedown', { button: 2, ctrlKey: true }),
      preventDefault: vi.fn(), stopPropagation: vi.fn(),
    };
    const move = {
      button: 0, buttons: 0, ctrlKey: false, clientX: 40, clientY: 50, target,
      nativeEvent: new MouseEvent('mousemove'),
      preventDefault: vi.fn(), stopPropagation: vi.fn(),
    };

    routeTerminalMouseDown(down, state);
    routeTerminalMouseMove(move, state, { moveTmuxMenuAt });

    expect(move.preventDefault).toHaveBeenCalledTimes(1);
    expect(move.stopPropagation).toHaveBeenCalledTimes(1);
    expect(forwarded).not.toHaveBeenCalled();
    expect(moveTmuxMenuAt).toHaveBeenCalledWith({ x: 40, y: 50 });
    expect(state.tmuxMenuActive).toBe(true);
  });

  it('selects a tmux menu item with a plain left click after Ctrl+right-click', () => {
    const state = createTerminalMouseState();
    state.tmuxMenuActive = true;
    const target = document.createElement('div');
    const releaseTmuxMenuAt = vi.fn();
    const event = {
      button: 0, ctrlKey: false, shiftKey: false, clientX: 40, clientY: 50, target,
      nativeEvent: new MouseEvent('mousedown', { button: 0 }),
      preventDefault: vi.fn(), stopPropagation: vi.fn(),
    };

    routeTerminalMouseDown(event, state, { releaseTmuxMenuAt });

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    expect(releaseTmuxMenuAt).toHaveBeenCalledWith({ x: 40, y: 50 });
    expect(state.tmuxMenuActive).toBe(false);
  });
});

describe('terminal text selection routing', () => {
  it('turns a plain left press into xterm force-selection without sending the original to tmux', () => {
    const target = document.createElement('div');
    const forwarded = vi.fn();
    const focusTerminal = vi.fn();
    target.addEventListener('mousedown', (event) => forwarded(event.button, event.shiftKey, event.detail));
    const event = {
      button: 0,
      ctrlKey: false,
      shiftKey: false,
      clientX: 20,
      clientY: 30,
      target,
      nativeEvent: new MouseEvent('mousedown', { button: 0 }),
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };

    routeTerminalMouseDown(event, createTerminalMouseState(), { focusTerminal });

    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    expect(focusTerminal).toHaveBeenCalledTimes(1);
    expect(forwarded).toHaveBeenCalledWith(0, true, 1);
  });

  it('keeps force-selection active while a plain left drag moves', () => {
    const state = createTerminalMouseState();
    const target = document.createElement('div');
    const forwarded = vi.fn();
    target.addEventListener('mousemove', (event) => forwarded(event.buttons, event.shiftKey));
    routeTerminalMouseDown({
      button: 0, ctrlKey: false, shiftKey: false, clientX: 20, clientY: 30, target,
      nativeEvent: new MouseEvent('mousedown', { button: 0 }),
      preventDefault: vi.fn(), stopPropagation: vi.fn(),
    }, state);
    const move = {
      button: 0, buttons: 1, ctrlKey: false, shiftKey: false, clientX: 60, clientY: 30, target,
      nativeEvent: new MouseEvent('mousemove', { buttons: 1 }),
      preventDefault: vi.fn(), stopPropagation: vi.fn(),
    };

    routeTerminalMouseMove(move, state);

    expect(move.stopPropagation).toHaveBeenCalledTimes(1);
    expect(forwarded).toHaveBeenCalledWith(1, true);
  });

  it('finishes force-selection on plain left release', () => {
    const state = createTerminalMouseState();
    state.selectionDragActive = true;
    const target = document.createElement('div');
    const forwarded = vi.fn();
    const focusTerminal = vi.fn();
    target.addEventListener('mouseup', (event) => forwarded(event.button, event.buttons, event.shiftKey));
    const event = {
      button: 0, buttons: 0, ctrlKey: false, shiftKey: false, clientX: 60, clientY: 30, target,
      nativeEvent: new MouseEvent('mouseup', { button: 0 }),
      preventDefault: vi.fn(), stopPropagation: vi.fn(),
    };

    routeTerminalMouseUp(event, state, { focusTerminal });

    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    expect(forwarded).toHaveBeenCalledWith(0, 0, true);
    expect(focusTerminal).toHaveBeenCalledTimes(1);
    expect(state.selectionDragActive).toBe(false);
  });

  it('recovers when a selection drag is released outside the terminal', () => {
    const state = createTerminalMouseState();
    state.selectionDragActive = true;
    const event = {
      button: 0, buttons: 0, ctrlKey: false, shiftKey: false, clientX: 60, clientY: 30,
      target: document.createElement('div'), nativeEvent: new MouseEvent('mousemove'),
      preventDefault: vi.fn(), stopPropagation: vi.fn(),
    };

    routeTerminalMouseMove(event, state);

    expect(state.selectionDragActive).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});

describe('terminal pointer coordinates', () => {
  it('maps and clamps a browser position to one-based terminal cells', () => {
    expect(getTerminalGridPosition({ x: 50, y: 25 }, { left: 0, top: 0, width: 100, height: 50 }, 10, 5)).toEqual({ col: 6, row: 3 });
    expect(getTerminalGridPosition({ x: 999, y: -10 }, { left: 0, top: 0, width: 100, height: 50 }, 10, 5)).toEqual({ col: 10, row: 1 });
  });

  it('creates a linear xterm range in either drag direction', () => {
    expect(getTerminalSelectionRange({ col: 5, row: 2 }, { col: 3, row: 4 }, 10)).toEqual({
      startColumn: 5, startRow: 2, length: 19,
    });
    expect(getTerminalSelectionRange({ col: 3, row: 4 }, { col: 5, row: 2 }, 10)).toEqual({
      startColumn: 5, startRow: 2, length: 19,
    });
  });
});

describe('terminal clipboard actions', () => {
  it('copies the current terminal selection on Ctrl+Shift+C keydown', () => {
    const copy = vi.fn();
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();

    const handledByTerminal = routeTerminalClipboardShortcut(
      {
        type: 'keydown',
        key: 'c',
        ctrlKey: true,
        shiftKey: true,
        altKey: false,
        metaKey: false,
        preventDefault,
        stopPropagation,
      },
      { copy },
    );

    expect(handledByTerminal).toBe(false);
    expect(copy).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(stopPropagation).toHaveBeenCalledTimes(1);
  });

  it('leaves Ctrl+Shift+V to the browser paste event instead of pasting twice', () => {
    const copy = vi.fn();

    const handledByTerminal = routeTerminalClipboardShortcut(
      { type: 'keydown', key: 'V', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false },
      { copy },
    );

    expect(handledByTerminal).toBe(true);
    expect(copy).not.toHaveBeenCalled();
  });

  it('copies the selection snapshot captured before the context menu opened', async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };

    const result = await copyTerminalText('selected before right-click', clipboard);

    expect(result).toBe('ok');
    expect(clipboard.writeText).toHaveBeenCalledWith('selected before right-click');
  });

  it('pastes clipboard text through the terminal paste API', async () => {
    const clipboard = { readText: vi.fn().mockResolvedValue('粘贴内容\n第二行') };
    const paste = vi.fn();

    const result = await pasteTerminalText(clipboard, paste);

    expect(result).toBe('ok');
    expect(paste).toHaveBeenCalledWith('粘贴内容\n第二行');
  });
});

describe('terminal clear action', () => {
  it('clears xterm and requests history removal for only this tab websocket', () => {
    const clear = vi.fn();
    const send = vi.fn();

    clearTerminalHistory(clear, send);

    expect(clear).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(send.mock.calls[0][0])).toEqual({ action: 'clear_history' });
  });
});

describe('terminal control keys', () => {
  it('sends Ctrl+C as ETX while leaving Enter to xterm', () => {
    const sendControl = vi.fn();

    const ctrlCHandledByXterm = routeTerminalControlShortcut(
      { type: 'keydown', key: 'c', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false },
      sendControl,
    );
    const enterHandledByXterm = routeTerminalControlShortcut(
      { type: 'keydown', key: 'Enter', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false },
      sendControl,
    );

    expect(ctrlCHandledByXterm).toBe(false);
    expect(sendControl).toHaveBeenCalledWith('\x03');
    expect(enterHandledByXterm).toBe(true);
  });
});
