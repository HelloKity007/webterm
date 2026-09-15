// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SftpPanel from "./SftpPanel";

const ticketURL = vi
  .fn()
  .mockResolvedValue("ws://localhost/ws/sftp/7?ticket=test");

vi.mock("../../api/wsTicket", () => ({
  websocketTicketURL: (...args: unknown[]) => ticketURL(...args),
  WebSocketAuthError: class WebSocketAuthError extends Error {},
}));

vi.mock("./FileList", () => ({ default: () => <div>files</div> }));

class MockWebSocket {
  static OPEN = 1;
  static instances: MockWebSocket[] = [];
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: (() => void) | null = null;
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
});
