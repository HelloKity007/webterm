// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DualPaneSftp from "./DualPaneSftp";
import { setLang } from "../../i18n";

vi.mock("./SftpPanel", () => ({
  default: (props: {
    endpointId: string;
    localMode?: boolean;
    onSelectionChange?: (paths: string[]) => void;
    onPathChange?: (path: string) => void;
  }) => (
    <div>
      <span>{props.endpointId}</span>
      <button
        onClick={() => {
          props.onPathChange?.(props.localMode ? "/home/demo" : "/var/log");
          props.onSelectionChange?.([
            props.localMode ? "/home/demo/a.txt" : "/var/log/app.log",
          ]);
        }}
      >
        select-{props.endpointId}
      </button>
    </div>
  ),
}));

describe("DualPaneSftp transfer", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("selects the first remote endpoint when connections load asynchronously", async () => {
    setLang("en");
    const { rerender } = render(<DualPaneSftp connections={[]} />);
    expect(screen.queryByText("remote:7")).toBeNull();
    rerender(<DualPaneSftp connections={[{ id: 7, name: "server-7" }]} />);
    expect(await screen.findByText("remote:7")).toBeTruthy();
    expect(screen.getByText("server-7")).toBeTruthy();
  });

  it("transfers selected remote files to the current local directory", async () => {
    setLang("en");
    localStorage.setItem("token", "test-token");
    const request = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({ succeeded: ["/var/log/app.log"], failed: [] }),
      });
    vi.stubGlobal("fetch", request);
    render(<DualPaneSftp connections={[{ id: 7, name: "server-7" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "select-remote:7" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Transfer to the right" }),
    );
    await waitFor(() => expect(request).toHaveBeenCalledOnce());
    const [, options] = request.mock.calls[0];
    expect(JSON.parse(options.body)).toMatchObject({
      source: { kind: "sftp", conn_id: 7, path: "/var/log/app.log" },
      destination: { kind: "local", path: "/home/app.log" },
      move: false,
    });
  });

  it("keeps a failed transfer visible and offers retry", async () => {
    setLang("en");
    const request = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          failed: [{ path: "/var/log/app.log", error: "denied" }],
        }),
      });
    vi.stubGlobal("fetch", request);
    render(<DualPaneSftp connections={[{ id: 7, name: "server-7" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "select-remote:7" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Transfer to the right" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain("denied");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  });
});
