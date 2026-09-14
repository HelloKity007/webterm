// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FileList from "./FileList";
import type { SftpFile } from "./SftpPanel";
import { setLang } from "../../i18n";
import { sizeFormat, timeFormat } from "./fileFormat";

const file = (index: number, directory = false): SftpFile => ({
  name: `item-${String(index).padStart(5, "0")}${directory ? "" : ".log"}`,
  path: `/item-${String(index).padStart(5, "0")}${directory ? "" : ".log"}`,
  size: index * 1024,
  mode: directory ? 0o755 : 0o644,
  mod_time: "2026-09-14T10:20:00Z",
  is_dir: directory,
  is_link: false,
});

const handlers = () => ({
  onNavigate: vi.fn(),
  onDelete: vi.fn(),
  onRename: vi.fn(),
  onMkdir: vi.fn(),
  onUpload: vi.fn(),
  onEdit: vi.fn(),
  onChmod: vi.fn(),
  endpointId: "remote:1",
  clipboard: null,
  onClipboardChange: vi.fn(),
  onFileOperation: vi.fn(),
});

describe("FileList", () => {
  beforeEach(() => {
    setLang("en");
    vi.restoreAllMocks();
  });
  afterEach(cleanup);

  it("formats large sizes and invalid timestamps safely", () => {
    expect(sizeFormat(3 * 1024 ** 3)).toBe("3.0 GB");
    expect(timeFormat("invalid")).toBe("—");
  });

  it("filters files without losing directory-first ordering", () => {
    render(
      <FileList
        files={[file(20), file(2, true), file(1)]}
        loading={false}
        currentPath="/"
        {...handlers()}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Filter files" }), {
      target: { value: "00020" },
    });
    expect(screen.getByText("item-00020.log")).toBeTruthy();
    expect(screen.queryByText("item-00001.log")).toBeNull();
  });

  it("supports additive selection and confirmed keyboard deletion", () => {
    const actions = handlers();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <FileList
        files={[file(1), file(2), file(3)]}
        loading={false}
        currentPath="/"
        {...actions}
      />,
    );
    const rows = screen.getAllByRole("option");
    fireEvent.click(rows[0]);
    fireEvent.click(rows[1], { ctrlKey: true });
    expect(rows[0].getAttribute("aria-selected")).toBe("true");
    expect(rows[1].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(rows[1], { key: "Delete" });
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(actions.onDelete).toHaveBeenCalledTimes(2);
  });

  it("does not delete when confirmation is declined", () => {
    const actions = handlers();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <FileList
        files={[file(1)]}
        loading={false}
        currentPath="/"
        {...actions}
      />,
    );
    const row = screen.getByRole("option");
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: "Delete" });
    expect(actions.onDelete).not.toHaveBeenCalled();
  });

  it("confirms an inline rename without opening the selected directory", () => {
    const actions = handlers();
    render(
      <FileList
        files={[file(1, true)]}
        loading={false}
        currentPath="/"
        {...actions}
      />,
    );
    const row = screen.getByRole("option");
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: "F2" });
    const editor = screen.getByRole("textbox", { name: "Folder Name" });
    fireEvent.change(editor, { target: { value: "renamed" } });
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(actions.onRename).toHaveBeenCalledWith("/item-00001", "renamed");
    expect(actions.onNavigate).not.toHaveBeenCalled();
  });

  it("keeps the DOM bounded for a 10k-entry directory", () => {
    render(
      <FileList
        files={Array.from({ length: 10_000 }, (_, index) => file(index))}
        loading={false}
        currentPath="/"
        {...handlers()}
      />,
    );
    expect(screen.getAllByRole("option").length).toBeLessThan(200);
    expect(screen.getByText("10000 items")).toBeTruthy();
  });

  it("copies a selection and pastes only on the same endpoint", () => {
    const actions = handlers();
    const { rerender } = render(
      <FileList
        files={[file(1), file(2)]}
        loading={false}
        currentPath="/target"
        {...actions}
      />,
    );
    fireEvent.click(screen.getAllByRole("option")[1]);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(actions.onClipboardChange).toHaveBeenCalledWith({
      kind: "copy",
      paths: ["/item-00001.log"],
      endpointId: "remote:1",
    });
    rerender(
      <FileList
        files={[file(1)]}
        loading={false}
        currentPath="/target"
        {...actions}
        clipboard={{ kind: "copy", paths: ["/source"], endpointId: "remote:1" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Paste/ }));
    expect(actions.onFileOperation).toHaveBeenCalledWith(
      "copy",
      ["/source"],
      "/target",
    );
  });

  it("disables paste across endpoints instead of reporting success", () => {
    const actions = handlers();
    render(
      <FileList
        files={[]}
        loading={false}
        currentPath="/"
        {...actions}
        clipboard={{ kind: "move", paths: ["/source"], endpointId: "remote:2" }}
      />,
    );
    expect(
      (screen.getByRole("button", { name: /Paste/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(actions.onFileOperation).not.toHaveBeenCalled();
  });
});
