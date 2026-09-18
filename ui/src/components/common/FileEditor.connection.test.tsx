// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import FileEditor from './FileEditor';
import { EditorView } from '@codemirror/view';

class Socket extends EventTarget {
  readyState: number = WebSocket.CONNECTING;
  messages: { action: string }[] = [];
  send(raw: string) {
    if (this.readyState !== WebSocket.OPEN) throw new DOMException('Still in CONNECTING state', 'InvalidStateError');
    this.messages.push(JSON.parse(raw));
  }
  open() { this.readyState = WebSocket.OPEN; this.dispatchEvent(new Event('open')); }
}
const props = { filePath: '/fixture.txt', fileName: 'fixture.txt', refreshMode: 'auto' as const, onRefreshModeChange: () => {}, onClose: () => {}, onSaved: () => {} };
afterEach(cleanup);
it('waits for OPEN and sends one read, never a write, after replacement or unmount', () => {
  const first = new Socket(), second = new Socket();
  const view = render(<FileEditor {...props} ws={first as unknown as WebSocket} />);
  expect(first.messages).toEqual([]);
  view.rerender(<FileEditor {...props} ws={second as unknown as WebSocket} />);
  act(() => first.open());
  expect(first.messages).toEqual([]);
  act(() => { second.open(); second.dispatchEvent(new Event('open')); });
  expect(second.messages.filter(m => m.action === 'read')).toHaveLength(1);
  expect(second.messages.some(m => m.action === 'write')).toBe(false);
  const third = new Socket();
  view.rerender(<FileEditor {...props} ws={third as unknown as WebSocket} />);
  view.unmount(); act(() => third.open());
  expect(third.messages).toEqual([]);
});
it('keeps edits made during reconnect and saves against their original revision', () => {
  const first = new Socket(); first.open();
  const view = render(<FileEditor {...props} refreshMode="manual" embedded ws={first as unknown as WebSocket} />);
  const content = (socket: Socket, text: string, revision: string) => act(() => socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'file_content', path: props.filePath, content: text, revision }) })));
  content(first, 'original', 'r1');
  const editor = () => EditorView.findFromDOM(view.container.querySelector('.cm-editor') as HTMLElement)!;
  act(() => editor().dispatch({ changes: { from: 0, to: editor().state.doc.length, insert: 'first edit' } }));
  const second = new Socket();
  view.rerender(<FileEditor {...props} refreshMode="manual" embedded ws={second as unknown as WebSocket} />);
  act(() => editor().dispatch({ changes: { from: 0, to: editor().state.doc.length, insert: 'newer unsaved edit' } }));
  act(() => second.open());
  content(second, 'someone else changed server', 'r2');
  expect(editor().state.doc.toString()).toBe('newer unsaved edit');
  fireEvent.click(view.container.querySelector('.file-editor-save')!);
  expect(second.messages.find(m => m.action === 'write')).toMatchObject({ content: 'newer unsaved edit', expected_revision: 'r1', force: false });
});
it('does not replay a pending save after replacing its socket and ignores old acknowledgments', () => {
  const first = new Socket(); first.open();
  let saved = 0;
  const view = render(<FileEditor {...props} refreshMode="manual" embedded ws={first as unknown as WebSocket} onSaved={() => saved++} />);
  act(() => first.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'file_content', path: props.filePath, content: 'draft', revision: 'r1' }) })));
  const button = view.container.querySelector('.file-editor-save') as HTMLButtonElement;
  fireEvent.click(button);
  expect(first.messages.filter(m => m.action === 'write')).toHaveLength(1);
  expect(button.disabled).toBe(true);
  const second = new Socket();
  view.rerender(<FileEditor {...props} refreshMode="manual" embedded ws={second as unknown as WebSocket} onSaved={() => saved++} />);
  expect(button.disabled).toBe(false);
  act(() => { first.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'write_done', path: props.filePath }) })); second.open(); });
  expect(saved).toBe(0);
  expect(second.messages.filter(m => m.action === 'write')).toHaveLength(0);
  expect(view.container.textContent).toContain('保存结果未确认');
});
it('names the real CodeMirror textbox and exposes keyboard scrolling', () => {
  const socket = new Socket(); socket.open();
  const view = render(<FileEditor {...props} embedded ws={socket as unknown as WebSocket} />);
  act(() => socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'file_content', path: props.filePath, content: 'text', revision: 'r1' }) })));
  const textbox = view.container.querySelector('.cm-content') as HTMLElement;
  expect(textbox.getAttribute('aria-label')).toBe(props.fileName);
  expect(textbox.tabIndex).toBe(0);
  const scroller = view.container.querySelector('.cm-scroller') as HTMLElement;
  expect(scroller.tabIndex).toBe(0);
  scroller.focus(); expect(document.activeElement).toBe(scroller);
});
it('requires explicit force before saving a legacy draft without a base revision', () => {
  const socket = new Socket(); socket.open();
  const view = render(<FileEditor {...props} refreshMode="manual" embedded initialDraft={{ content: 'legacy unsaved draft' }} ws={socket as unknown as WebSocket} />);
  act(() => socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'file_content', path: props.filePath, content: 'server changed', revision: 'r2' }) })));
  fireEvent.click(view.container.querySelector('.file-editor-save')!);
  expect(socket.messages.filter(m => m.action === 'write')).toHaveLength(0);
  expect(EditorView.findFromDOM(view.container.querySelector('.cm-editor') as HTMLElement)!.state.doc.toString()).toBe('legacy unsaved draft');
  fireEvent.click(view.container.querySelector('.file-editor-button.is-danger')!);
  expect(socket.messages.filter(m => m.action === 'write')).toEqual([expect.objectContaining({ content: 'legacy unsaved draft', force: true })]);
});
