// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DualPaneSftp from "./DualPaneSftp";
import { setLang } from "../../i18n";

vi.mock("./SftpPanel", () => ({
  default: (props: { endpointId: string; onOpenFile?: (file: { path: string; name: string; revision?: string }) => void }) => (
    <div>
      <span>{props.endpointId}</span>
      <button onClick={() => props.onOpenFile?.({ path: "/var/log/app.log", name: "app.log", revision: "one" })}>open-log</button>
      <button onClick={() => props.onOpenFile?.({ path: "/etc/app.conf", name: "app.conf", revision: "two" })}>open-config</button>
    </div>
  ),
}));

vi.mock("../common/FileEditor", () => ({
  default: ({ fileName }: { fileName: string }) => <div>editor:{fileName}</div>,
}));

describe("Remote file workbench", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("selects the first remote endpoint when connections load asynchronously", () => {
    setLang("en");
    const { rerender } = render(<DualPaneSftp connections={[]} />);
    expect(screen.queryByText("remote:7")).toBeNull();
    rerender(<DualPaneSftp connections={[{ id: 7, name: "server-7" }]} />);
    expect(screen.getByText("remote:7")).toBeTruthy();
    expect(screen.getByText("Remote files")).toBeTruthy();
    expect(screen.queryByText("Local")).toBeNull();
  });

  it("opens remote files as persistent editor tabs instead of a transfer pane", async () => {
    setLang("en");
    render(<DualPaneSftp connections={[{ id: 7, name: "server-7" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "open-log" }));
    fireEvent.click(screen.getByRole("button", { name: "open-config" }));
    expect(await screen.findByRole("tab", { name: /app\.log/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /app\.conf/ })).toBeTruthy();
  });

  it("routes new files to the editor column the operator focused after splitting", async () => {
    setLang("en");
    render(<DualPaneSftp connections={[{ id: 7, name: "server-7" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Split editor" }));
    fireEvent.mouseDown(document.querySelector('[data-editor-group="secondary"]')!);
    fireEvent.click(screen.getByRole("button", { name: "open-log" }));
    const secondary = document.querySelector('[data-editor-group="secondary"]')!;
    expect(secondary.textContent).toContain("app.log");
  });

  it("moves active tabs between split editors and exposes scroll controls", async () => {
    setLang("en");
    render(<DualPaneSftp connections={[{ id: 7, name: "server-7" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "open-log" }));
    fireEvent.click(screen.getByRole("button", { name: "Split editor" }));
    fireEvent.click(screen.getByRole("button", { name: "Move active file to the other editor" }));
    expect(document.querySelector('[data-editor-group="secondary"]')?.textContent).toContain("app.log");
    expect(screen.getAllByRole("button", { name: "Scroll tabs left" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Scroll tabs right" })).toHaveLength(2);
  });

  it("moves through tabs with arrow keys", async () => {
    setLang("en");
    render(<DualPaneSftp connections={[{ id: 7, name: "server-7" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "open-log" }));
    fireEvent.click(screen.getByRole("button", { name: "open-config" }));
    const config = screen.getByRole("tab", { name: /app\.conf/ });
    fireEvent.keyDown(config, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: /app\.log/ }).getAttribute("aria-selected")).toBe("true");
  });
});
