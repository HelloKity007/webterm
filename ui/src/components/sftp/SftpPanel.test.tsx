// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SftpPanel from "./SftpPanel";

const ticketURL = vi
  .fn()
  .mockResolvedValue("ws://localhost/ws/local-fs?ticket=test");

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

describe("SftpPanel local endpoint", () => {
  afterEach(() => {
    cleanup();
    ticketURL.mockClear();
    MockWebSocket.instances = [];
    vi.unstubAllGlobals();
  });

  it("opens the local filesystem websocket without a remote connection id", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket);
    render(<SftpPanel localMode />);

    await waitFor(() =>
      expect(ticketURL).toHaveBeenCalledWith("/ws/local-fs", {
        endpoint: "local-fs",
      }),
    );
  });

  it("closes the active local socket when the panel unmounts", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket);
    const view = render(<SftpPanel localMode />);
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));

    view.unmount();

    expect(MockWebSocket.instances[0].close).toHaveBeenCalledOnce();
  });
});
