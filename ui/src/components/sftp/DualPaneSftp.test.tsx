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
  default: ({ fileName, initialDraft }: { fileName: string; initialDraft?: { content: string } }) => <div>editor:{fileName}{initialDraft ? `:${initialDraft.content}` : ""}</div>,
}));

describe("Remote file workbench", () => {
  afterEach(() => { cleanup(); window.localStorage.clear(); vi.restoreAllMocks(); });

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

  it("reorders tabs by drag and maps vertical wheel input to the tab strip", async () => {
    setLang("en");
    render(<DualPaneSftp connections={[{ id: 7, name: "server-7" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "open-log" }));
    fireEvent.click(screen.getByRole("button", { name: "open-config" }));
    const strip = document.querySelector<HTMLElement>('.file-editor-tabs')!;
    strip.scrollLeft = 0;
    fireEvent.wheel(strip, { deltaY: 120, deltaX: 0 });
    expect(strip.scrollLeft).toBe(120);

    const transfer = {
      effectAllowed: "",
      dropEffect: "",
      value: "",
      setData: (_type: string, value: string) => { transfer.value = value; },
      getData: () => transfer.value,
    };
    const log = screen.getByRole("tab", { name: /app\.log/ }).parentElement!;
    const config = screen.getByRole("tab", { name: /app\.conf/ }).parentElement!;
    fireEvent.dragStart(config, { dataTransfer: transfer });
    fireEvent.dragOver(log, { dataTransfer: transfer });
    fireEvent.drop(log, { dataTransfer: transfer });
    expect([...strip.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual(["app.conf", "app.log"]);
  });

  it("moves a tab when dropped anywhere in the other editor group", async () => {
    setLang("en");
    render(<DualPaneSftp connections={[{ id: 7, name: "server-7" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "open-log" }));
    fireEvent.click(screen.getByRole("button", { name: "Split editor" }));
    const transfer = {
      effectAllowed: "",
      dropEffect: "",
      value: "",
      setData: (_type: string, value: string) => { transfer.value = value; },
      getData: () => transfer.value,
    };
    const tab = screen.getByRole("tab", { name: /app\.log/ }).parentElement!;
    const secondary = document.querySelector<HTMLElement>('[data-editor-group="secondary"]')!;
    fireEvent.dragStart(tab, { dataTransfer: transfer });
    fireEvent.dragOver(secondary, { dataTransfer: transfer });
    fireEvent.drop(secondary, { dataTransfer: transfer });
    expect(secondary.textContent).toContain("app.log");
    expect(document.querySelector('[data-editor-group="primary"]')?.textContent).not.toContain("app.log");
  });

  it("restores open files, their groups and active state after a reload", async () => {
    setLang("en");
    window.localStorage.setItem("webterm:file-workbench:v1", JSON.stringify({
      version: 1,
      connectionId: 7,
      tabs: [
        { id: "ignored", path: "/var/log/app.log", name: "app.log", revision: "one", group: "primary", refreshMode: "manual", dirty: false },
        { id: "ignored", path: "/etc/app.conf", name: "app.conf", revision: "two", group: "secondary", refreshMode: "auto", dirty: true, draft: { content: "saved locally", baseRevision: "two" } },
      ],
      active: { primary: "file:/var/log/app.log", secondary: "file:/etc/app.conf" },
      focusedGroup: "secondary",
      split: true,
    }));
    render(<DualPaneSftp connections={[{ id: 7, name: "server-7" }]} />);
    expect(await screen.findByRole("tab", { name: /app\.log/ })).toBeTruthy();
    expect(document.querySelector('[data-editor-group="secondary"]')?.textContent).toContain("app.conf");
    expect(screen.getByRole("tab", { name: /app\.conf/ }).getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector('.file-workbench')?.classList.contains("is-split")).toBe(true);
    expect(screen.getByText("editor:app.conf:saved locally")).toBeTruthy();
  });

  it("writes the latest workspace state during page unload", () => {
    setLang("en");
    render(<DualPaneSftp connections={[{ id: 7, name: "server-7" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "open-log" }));
    fireEvent(window, new Event("pagehide"));
    const saved = JSON.parse(window.localStorage.getItem("webterm:file-workbench:v1") || "null");
    expect(saved.tabs.map((tab: { name: string }) => tab.name)).toEqual(["app.log"]);
    expect(saved.active.primary).toBe("file:/var/log/app.log");
  });

  it("persists files opened after connections arrive asynchronously", () => {
    setLang("en");
    const { rerender } = render(<DualPaneSftp connections={[]} />);
    rerender(<DualPaneSftp connections={[{ id: 7, name: "server-7" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "open-log" }));
    const saved = JSON.parse(window.localStorage.getItem("webterm:file-workbench:v1") || "null");
    expect(saved.connectionId).toBe(7);
    expect(saved.tabs.map((tab: { name: string }) => tab.name)).toEqual(["app.log"]);
  });
});
