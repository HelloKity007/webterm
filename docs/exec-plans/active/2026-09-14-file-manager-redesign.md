# WebTerm file manager redesign execution plan

Date: 2026-09-14  
Branch: `dev-1.1.0`  
Release boundary: test `9444` only until the user separately approves production `9443`.

## Outcome

Replace the current basic SFTP/local file lists with a cohesive, remote-only
file workspace while preserving terminal directory following, existing connection
authorization, the SSH/SFTP pool, and the accepted terminal/mobile behavior.

Primary product reference: FileBrowser Quantum stable 1.5.x. Cloudreve transfer
workflows, Filestash's provider boundary, and SFTPGo's path/security practices are
references only; GPL/AGPL/proprietary UI code must not be copied.

## Design direction

The file manager is a precise operations workspace, not a generic cloud-drive
dashboard. It stays within WebTerm's botanical green shell but the working surface
uses cool, low-glare slate so file names, selection and transfer state remain clear
during long sessions.

### Tokens

- `workbench`: `#18201c` — file table working surface
- `workbench-raised`: `#222c26` — toolbar and secondary surfaces
- `chrome`: `#bfdcbe` — integration with the existing WebTerm shell
- `selection`: `#4f8f55` — selection, focus and completed activity
- `transfer`: `#4d86a8` — active transfer state
- `danger`: `#c65d5d` — destructive state only
- Type: existing Fira Sans/system stack for UI; tabular numerals and the system
  monospace stack only for paths, sizes and transfer measurements.

### Layout

```text
+ Remote connection +------------------------------------------------+
| explorer: path, search, file rows | editor tabs / split editor     |
| explorer: upload/download/actions | persistent remote file content |
+---------------------------------------------------------------------+

The browser transfers files directly to the selected remote endpoint. It never
labels the WebTerm host filesystem as the browser's local Windows filesystem.
```

Alignment is left-led. Numeric metadata aligns right. Borders communicate table,
split and task boundaries; decoration does not compete with the content.

### Interaction principles

1. The current path, current selection and transfer state are always visible.
2. Common operations need one gesture; dangerous operations need explicit scope.
3. Mouse, keyboard and touch reach the same capabilities.
4. Empty, loading, disconnected and failed states explain the next available act.
5. Large directories and files must not freeze the interface or scale server memory
   with object size.

Self-critique: the initial dual-pane transfer concept was misleading for browser
users because its “local” pane was actually the WebTerm host. The revised layout
makes the persistent editor workbench the memorable relationship and reserves the
left rail for remote navigation only.

## Work packages and evidence

### WP1 — provider and transfer safety

- Stream SFTP downloads and uploads; preserve authentication and pool semantics.
- Add safe recursive file operations and typed failures.
- Define local/SFTP operation parity without silently widening local access.
- Unit tests cover malformed input, ownership, streaming and recursive behavior.

Evidence: focused Go tests, full `go test ./...`, race-sensitive tests where feasible,
and memory measurements during large transfer.

### WP2 — file workspace UI/UX

- Rebuild toolbar, breadcrumb, table, status and empty/error/loading states.
- Add filtering, selection, range/multi-select, keyboard navigation and batch actions.
- Add copy/cut/paste within one remote endpoint; upload/download bridge the
  browser and that endpoint without exposing a host-local filesystem.
- Add responsive single-pane/mobile behavior and accessible labels/focus.
- Keep editing, upload/download, chmod, rename, mkdir and directory following.

Evidence: component tests, typecheck/build/lint, screenshots at 375/768/1440 widths,
keyboard flow and axe checks.

### WP3 — scale and resilient tasks

- Incremental/virtualized directory rendering without adding a second UI framework.
- Transfer queue with progress, error, retry/cancel and concurrency control.
- Large-file and weak-network behavior; resumability only after a protocol/security
  spike proves bounded storage, ownership and cleanup.

Evidence: 10k and 50k entry render/interaction benchmark; 1GB and 10GB streamed
transfer or sparse-file equivalent; disconnect/reconnect tests; bounded memory.

### WP4 — integration, staging and release gate

- Run complete UI and Go suites, lint, build and security checks.
- Commit candidate, deploy only to `9444`, verify health SHA/environment.
- Perform real-browser functional, visual, responsive, accessibility and performance
  acceptance, including the mandatory full terminal dynamic visual regression after
  normal and hard refresh.
- Record all PASS/FAIL/NOT RUN evidence under `docs/qa/`.
- Report candidate SHA, evidence and limitations. Do not approve/promote/restart
  production `9443` without a new explicit user authorization.

## Definition of done

- Existing accepted SFTP and terminal behavior has no regression.
- The redesigned file manager passes mouse, keyboard and responsive workflows.
- Streaming and large-directory targets have direct measurements, not inference.
- Security tests cover authorization, path handling, symlinks and dangerous actions.
- Test deployment `9444` identifies the exact candidate SHA and passes the complete
  release checklist.
- Production release remains a separate explicit decision.
