# Source 05 — ONLYOFFICE Docs / DocumentServer

- URLs: https://github.com/ONLYOFFICE/DocumentServer ; https://api.onlyoffice.com/docs/docs-api/get-started/how-it-works/ ; https://helpcenter.onlyoffice.com/docs/installation/docs-community-sys-reqs-linux.aspx
- Type: primary repository and official documentation
- Accessed: 2026-09-22
- Credibility / recency / bias: high / high / vendor documentation

> “document manager and document storage service must be provided by an integrator.”

> “Document editing service downloads a document from [storage] using the `url` supplied in the editor `config`.”

> “less than 100 [concurrent users] ... 4 GB RAM, 40 GB ...”

It is AGPL-3.0 in this repository and supports real-time editing for document, spreadsheet, presentation, form and PDF workflows. Its official API requires an integrator to expose an absolute document URL and receive save callbacks; that is an integration architecture distinct from WebTerm's SFTP WebSocket transport.

