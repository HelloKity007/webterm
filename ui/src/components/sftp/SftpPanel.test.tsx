// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SftpPanel from "./SftpPanel";

const ticketURL = vi
  .fn()
  .mockResolvedValue("ws://localhost/ws/sftp/7?ticket=test");

vi.mock("../../api/wsTicket", () => ({
  websocketTicketURL: (...args: unknown[]) => ticketURL(...args),
  WebSocketAuthError: class WebSocketAuthError extends Error {},
}));

vi.mock("./FileList", () => ({ default: ({ uploadReady }: { uploadReady?: boolean }) => <div data-testid="files" data-ready={String(uploadReady)}>files</div> }));

class MockWebSocket {
  static OPEN = 1;
  static instances: MockWebSocket[] = [];
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  send = vi.fn();
  close = vi.fn();

  url: string;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
}

describe("SftpPanel remote endpoint", () => {
  afterEach(() => {
    cleanup();
    ticketURL.mockClear();
    MockWebSocket.instances = [];
    vi.unstubAllGlobals();
  });

  it("opens only the selected remote filesystem websocket", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket);
    render(<SftpPanel connId={7} />);

    await waitFor(() =>
      expect(ticketURL).toHaveBeenCalledWith("/ws/sftp/7", {
        endpoint: "sftp", connId: 7,
      }),
    );
  });

  it("closes the active remote socket when the panel unmounts", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket);
    const view = render(<SftpPanel connId={7} />);
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));

    view.unmount();

    expect(MockWebSocket.instances[0].close).toHaveBeenCalledOnce();
  });

  it("uses the current path input value when navigating with Enter", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket);
    const view = render(<SftpPanel connId={7} />);
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];
    socket.onopen?.();
    socket.send.mockClear();
    const path = view.container.querySelector(".sftp-path") as HTMLInputElement;
    fireEvent.change(path, { target: { value: "/tmp/current-value" } });
    fireEvent.keyDown(path, { key: "Enter" });
    expect(socket.send).toHaveBeenCalledWith(
      JSON.stringify({ action: "list", path: "/tmp/current-value" }),
    );
  });
  it("retains confirmed directory on reconnect and enables upload only after the new listing completes", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket);
    const view = render(<SftpPanel connId={7} tabId="same-tab" />);
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const first = MockWebSocket.instances[0];
    expect(view.getByTestId('files').getAttribute('data-ready')).toBe('false');
    act(() => { first.onopen?.(); first.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ type:'file_list', path:'/owned/current', files:[] }) })); });
    expect(view.getByTestId('files').getAttribute('data-ready')).toBe('true');
    act(() => { first.readyState = 3; window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(2));
    expect((view.container.querySelector('.sftp-path') as HTMLInputElement).value).toBe('/owned/current');
    expect(view.getByTestId('files').getAttribute('data-ready')).toBe('false');
    const second = MockWebSocket.instances[1];
    act(() => second.onopen?.());
    expect(second.send).toHaveBeenCalledWith(JSON.stringify({ action:'list', path:'/owned/current' }));
    expect(second.send).not.toHaveBeenCalledWith(JSON.stringify({ action:'getwd' }));
    expect(view.getByTestId('files').getAttribute('data-ready')).toBe('false');
    act(() => second.onmessage?.(new MessageEvent('message',{data:JSON.stringify({type:'file_list',path:'/owned/current',files:[]})})));
    expect(view.getByTestId('files').getAttribute('data-ready')).toBe('true');
    view.rerender(<SftpPanel connId={8} tabId="same-tab" />);
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(3));
    act(() => MockWebSocket.instances[2].onopen?.());
    expect(MockWebSocket.instances[2].send).toHaveBeenCalledWith(JSON.stringify({action:'getwd'}));
    expect(view.getByTestId('files').getAttribute('data-ready')).toBe('false');
  });
});
