# F1 — Preview is an extension point, not a replacement boundary

WebTerm's current workbench owns remote SFTP browsing, conflict-aware writes, drafts, tabs, split groups and persisted UI state. A third-party viewer should receive a short-lived preview source and report only display lifecycle events. It must not become the owner of remote paths, save semantics, tab state or permissions.

Evidence: source 01 exposes a container viewer API for `File | Blob | URL | ArrayBuffer`; source 05 requires a separate document-storage integration; the current `FileEditor.tsx` is a CodeMirror text editor over an SFTP WebSocket and its parent (`DualPaneSftp.tsx`) owns tab state.

