# F2 — The robust choice is layered, with no universal renderer promised

Use native browser rendering for images/audio/video, CodeMirror for text, PDF.js for PDF, docx-preview for DOCX and a virtualized data grid backed by SheetJS for spreadsheets. Use a separate conversion service only for requested complex formats. The claims of universal viewers are useful routing/fallback coverage, but their own documentation says complex proprietary formats need dedicated renderers or server-side conversion.

Evidence: sources 01, 02, 03, 04, 05 and 06.

