import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('../ui/node_modules/playwright');
const XLSX = require('../ui/node_modules/@stackline/xlsx');
const JSZip = require('../ui/node_modules/jszip');
const target = new URL(process.env.WEBTERM_QA_URL || 'https://192.168.11.87:9444/');
const connectionID = Number(process.env.WEBTERM_QA_REMOTE_CONNECTION_ID || 0);
assert.equal(target.protocol, 'https:', 'Preview QA requires HTTPS');
assert.equal(target.port, '9444', 'Preview QA only permits release-test');
assert(Number.isSafeInteger(connectionID) && connectionID > 0,
  'Set WEBTERM_QA_REMOTE_CONNECTION_ID to a dedicated disposable SFTP connection');

const runID = `${Date.now()}-${randomUUID().slice(0, 8)}`;
const prefix = `webterm-preview-qa-${runID}`;
let paths = [];
const output = resolve(process.env.WEBTERM_QA_OUTPUT || `runtime/file-preview-qa/${runID}`);
await mkdir(output, { recursive: true, mode: 0o700 });
const report = { status: 'RUNNING', target: target.origin, connectionID, checks: [], diagnostics: { pageErrors: [], consoleErrors: [], failedResponses: [] }, screenshots: [] };
const pass = (name, evidence) => report.checks.push({ name, status: 'PASS', evidence });
const redact = (message) => String(message).replace(/([?&](?:ticket|token)=)[^&\s]*/gi, '$1[redacted]').slice(0, 800);

function pdfFixture() {
  const text = 'WebTerm PDF preview QA';
  const objects = [
    '1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj',
    '2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj',
    '3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources<< /Font<< /F1 4 0 R >> >> /Contents 5 0 R >>endobj',
    '4 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj',
  ];
  const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
  objects.push(`5 0 obj<< /Length ${Buffer.byteLength(stream)} >>stream\n${stream}\nendstream\nendobj`);
  let result = '%PDF-1.4\n'; const offsets = [0];
  for (const object of objects) { offsets.push(Buffer.byteLength(result)); result += `${object}\n`; }
  const xref = Buffer.byteLength(result);
  result += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  result += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  return Buffer.from(`${result}trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}

async function docxFixture() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.folder('_rels').file('.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.folder('word').file('document.xml', '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>WebTerm DOCX preview QA</w:t></w:r></w:p><w:sectPr/></w:body></w:document>');
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function deleteFixture(page, path) {
  await page.evaluate(async ({ connectionID, path }) => {
    const token = localStorage.getItem('token') || '';
    const response = await fetch('/api/ws-tickets', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ endpoint: 'sftp', conn_id: connectionID }) });
    if (!response.ok) throw new Error(`cleanup ticket: ${response.status}`);
    const { ticket } = await response.json();
    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/sftp/${connectionID}?ticket=${encodeURIComponent(ticket)}`);
    await new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => reject(new Error('cleanup timeout')), 10000);
      socket.onerror = () => { clearTimeout(timer); reject(new Error('cleanup socket')); };
      socket.onopen = () => socket.send(JSON.stringify({ action: 'delete', path }));
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'delete_done' || (message.type === 'error' && /not found|not exist/i.test(message.error || ''))) { clearTimeout(timer); socket.close(); resolvePromise(); }
        else if (message.type === 'error') { clearTimeout(timer); socket.close(); reject(new Error(message.error)); }
      };
    });
  }, { connectionID, path });
}

let browser; let context; let page; let expectedRejectedPreview = false;
try {
  browser = await chromium.launch({ headless: process.env.WEBTERM_QA_HEADED !== '1', executablePath: process.env.WEBTERM_QA_CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
  page = await context.newPage();
  page.on('pageerror', (error) => report.diagnostics.pageErrors.push(redact(error.message)));
  page.on('console', (message) => { if (message.type() === 'error' && !(expectedRejectedPreview && /401/.test(message.text()))) report.diagnostics.consoleErrors.push(redact(message.text())); });
  page.on('response', (response) => { const url = new URL(response.url()); if (url.origin === target.origin && response.status() >= 400 && !url.pathname.endsWith('/api/auth/test-session') && !(expectedRejectedPreview && response.status() === 401 && url.pathname.includes('/api/sftp/preview/'))) report.diagnostics.failedResponses.push({ status: response.status(), path: url.pathname }); });
  const session = await context.request.post(new URL('/api/auth/test-session', target).href);
  assert.equal(session.status(), 200, 'release-test did not provide a test session');
  const { token } = await session.json(); assert.equal(typeof token, 'string');
  await page.addInitScript((value) => localStorage.setItem('token', value), token);
  await page.goto(target.origin, { waitUntil: 'domcontentloaded' });
  await page.locator('.activity-files').click();
  const workspace = page.locator('[data-testid="file-workspace"]'); await workspace.waitFor();
  await workspace.locator('.sftp-shell').waitFor({ timeout: 15000 });
  const pane = workspace.locator('.file-explorer');
  const follow = pane.getByRole('button', { name: /跟随|Follow/ });
  if (await follow.getAttribute('aria-pressed') === 'true') {
    await follow.click();
    // A prior OSC-7 follow update is queued with a zero-delay timer. Let its
    // cleanup settle before navigating this isolated browser test fixture.
    await page.waitForTimeout(300);
  }
  await pane.locator('.sftp-path').waitFor({ timeout: 15000 });
  await pane.locator('.sftp-file-list').waitFor({ timeout: 15000 });
  await pane.locator('.sftp-path').fill('/tmp'); await pane.locator('.sftp-path').press('Enter');
  await page.waitForFunction(() => document.querySelector('.file-explorer .sftp-path')?.value === '/tmp');
  paths = [`/tmp/${prefix}.pdf`, `/tmp/${prefix}.docx`, `/tmp/${prefix}.xlsx`];
  const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Preview', 'Value'], ['browser preview', 42]]), 'Preview');
  const fixtures = [
    { path: paths[0], mimeType: 'application/pdf', buffer: pdfFixture() },
    { path: paths[1], mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: await docxFixture() },
    { path: paths[2], mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) },
  ];
  for (const fixture of fixtures) {
    const response = await context.request.post(new URL('/api/sftp/upload', target).href, {
      headers: { Authorization: `Bearer ${token}` },
      multipart: { conn_id: String(connectionID), path: fixture.path, file: { name: fixture.path.split('/').pop(), mimeType: fixture.mimeType, buffer: fixture.buffer } },
    });
    assert.equal(response.status(), 200, `fixture upload failed for ${fixture.path.split('/').pop()}: ${redact(await response.text())}`);
  }
  await pane.getByRole('button', { name: /刷新|Refresh/ }).click();
  await page.waitForTimeout(300);
  const rowFor = (name) => pane.locator('[data-file-row]').filter({ has: page.locator('.sftp-file-name', { hasText: name }) }).first();
  const filter = pane.getByRole('textbox', { name: /筛选文件|Filter files/ });
  for (const name of paths.map((path) => path.split('/').pop())) { await filter.fill(name); await rowFor(name).waitFor({ timeout: 15000 }); }
  await filter.fill('');
  pass('The real remote SFTP workspace uploaded only random, exact-name preview fixtures', { files: paths.map((path) => path.split('/').pop()) });

  const openPreview = async (name) => {
    await filter.fill(name);
    const row = rowFor(name); await row.click({ button: 'right' }); await page.getByText(/^(预览|Preview)$/).click();
    await page.locator('.file-preview').waitFor();
  };
  await openPreview(`${prefix}.pdf`);
  await page.locator('.file-preview canvas').evaluate((canvas) => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('PDF canvas did not render')), 15000); const observer = new MutationObserver(() => { if (canvas.width > 0 && canvas.height > 0) { clearTimeout(timer); observer.disconnect(); resolve(); } }); observer.observe(canvas, { attributes: true }); if (canvas.width > 0 && canvas.height > 0) { clearTimeout(timer); observer.disconnect(); resolve(); } }));
  const previewURL = await page.locator('.file-preview img, .file-preview audio, .file-preview video').count();
  assert.equal(previewURL, 0, 'PDF preview unexpectedly uses a media fallback');
  await page.screenshot({ path: resolve(output, 'pdf-preview.png') }); report.screenshots.push('pdf-preview.png');
  pass('PDF is rendered on-demand to a browser canvas', { canvas: true });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.activity-files').click();
  await page.locator('.file-preview canvas').waitFor({ timeout: 15000 });
  pass('The opened preview tab survives a browser reload and renews its scoped source', { persisted: true });
  await page.getByRole('button', { name: /关闭|Close/ }).first().click();
  const reloadFollow = pane.getByRole('button', { name: /跟随|Follow/ });
  if (await reloadFollow.getAttribute('aria-pressed') === 'true') { await reloadFollow.click(); await page.waitForTimeout(300); }
  await pane.locator('.sftp-path').fill('/tmp'); await pane.locator('.sftp-path').press('Enter');
  await page.waitForFunction(() => document.querySelector('.file-explorer .sftp-path')?.value === '/tmp');

  await openPreview(`${prefix}.docx`);
  await page.getByText('WebTerm DOCX preview QA').waitFor({ timeout: 15000 });
  pass('DOCX is rendered in the browser preview surface', { renderedText: true });
  await page.getByRole('button', { name: /关闭|Close/ }).first().click();

  await openPreview(`${prefix}.xlsx`);
  await page.getByText('browser preview').waitFor({ timeout: 15000 });
  pass('XLSX is rendered with a bounded sheet table', { renderedCell: 'browser preview' });
  expectedRejectedPreview = true;
  const security = await page.evaluate(async ({ connectionID, xlsxPath, pdfPath }) => {
    const ticketResponse = await fetch('/api/ws-tickets', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token') || ''}` }, body: JSON.stringify({ endpoint: 'sftp-preview', conn_id: connectionID, path: xlsxPath }) });
    const { ticket } = await ticketResponse.json();
    const makeURL = (path) => `/api/sftp/preview/${connectionID}?path=${encodeURIComponent(path)}&ticket=${encodeURIComponent(ticket)}`;
    const ranged = await fetch(makeURL(xlsxPath), { headers: { Range: 'bytes=0-31' } });
    const wrongPath = await fetch(makeURL(pdfPath));
    return {
      storageHasTicket: Object.keys(localStorage).some((key) => /ticket/i.test(key)),
      ticketStatus: ticketResponse.status,
      rangeStatus: ranged.status,
      cacheControl: ranged.headers.get('cache-control'),
      contentType: ranged.headers.get('content-type'),
      wrongPathStatus: wrongPath.status,
    };
  }, { connectionID, xlsxPath: paths[2], pdfPath: paths[0] });
  expectedRejectedPreview = false;
  assert.equal(security.storageHasTicket, false, 'a preview ticket was persisted in localStorage');
  assert.equal(security.ticketStatus, 200, 'browser did not issue a scoped preview ticket');
  assert.equal(security.rangeStatus, 206, 'preview endpoint did not honor HTTP Range');
  assert.equal(security.cacheControl, 'no-store', 'preview response may be cached');
  assert.match(security.contentType || '', /spreadsheetml|octet-stream/, 'preview content type is unsafe or unknown');
  assert([401, 403].includes(security.wrongPathStatus), 'a preview ticket was accepted for a different path');
  pass('Preview tickets are path-bound, no-store and Range-capable without browser persistence', { localStorageTicketKeys: false, rangeStatus: security.rangeStatus, wrongPathStatus: security.wrongPathStatus });
  await page.screenshot({ path: resolve(output, 'xlsx-preview.png') }); report.screenshots.push('xlsx-preview.png');
  await page.getByRole('button', { name: /关闭|Close/ }).first().click();
  assert.deepEqual(report.diagnostics.pageErrors, [], 'browser page errors emitted');
  assert.deepEqual(report.diagnostics.consoleErrors, [], 'browser console errors emitted');
  assert.deepEqual(report.diagnostics.failedResponses, [], 'same-origin HTTP failures emitted');
  pass('Preview interaction has clean browser/network diagnostics', report.diagnostics);
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.failure = redact(error instanceof Error ? error.message : error);
  if (page) await page.screenshot({ path: resolve(output, 'failure.png') }).then(() => report.screenshots.push('failure.png')).catch(() => {});
  process.exitCode = 1;
} finally {
  for (const path of paths) if (page) await deleteFixture(page, path).catch((error) => { report.cleanup ||= []; report.cleanup.push({ path: path.replace(/^.*\//, ''), error: redact(error.message) }); });
  await context?.close().catch(() => {}); await browser?.close().catch(() => {});
  await writeFile(resolve(output, 'result.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2)); console.log(`Artifacts: ${output}`);
}
