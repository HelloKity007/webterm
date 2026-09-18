import assert from 'node:assert/strict';
import https from 'node:https';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const origin = 'https://192.168.11.87:9444';
const size = 256 * 1024 * 1024;
// Declared before measurement: server RSS growth <=128MiB; QA Node <=96MiB.
const limits = { serverRSSDelta: 128 * 1024 * 1024, clientRSSDelta: 96 * 1024 * 1024 };
const output = `runtime/large-http-transfer-${Date.now()}`;
await mkdir(output, { recursive: true, mode: 0o700 });
const fixture = await mkdtemp(join(tmpdir(), 'webterm-owned-http-transfer-'));
let token = '', timer, report = { status: 'RUNNING', origin, size, limits, fixture, stages: [] };
const api = (path, method = 'GET', body) => new Promise((resolve, reject) => {
  const req = https.request(origin + path, { method, rejectUnauthorized: false, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) } }, res => {
    let text = ''; res.on('data', b => { text += b; }); res.on('end', () => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} ${path.split('?')[0]}`));
      try { resolve(JSON.parse(text)); } catch (e) { reject(e); }
    });
  }); req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
});
const hashFile = async file => { const h = createHash('sha256'); for await (const chunk of createReadStream(file)) h.update(chunk); return h.digest('hex'); };
const rss = async pid => Number((await readFile(`/proc/${pid}/status`, 'utf8')).match(/^VmRSS:\s+(\d+)/m)[1]) * 1024;
const stagingDisk = async () => {
  const names = (await readdir(tmpdir())).filter(n => n.startsWith('webterm-sftp-upload-'));
  const sizes = await Promise.all(names.map(n => stat(join(tmpdir(), n)).then(s => s.size).catch(() => 0)));
  return sizes.reduce((a, b) => a + b, 0);
};
const upload = async (source, destination, cancelAt, cancelCopy = false) => {
  const boundary = `webterm-${randomBytes(12).toString('hex')}`;
  const header = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="conn_id"\r\n\r\n2\r\n--${boundary}\r\nContent-Disposition: form-data; name="path"\r\n\r\n${destination}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="fixture.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`);
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  let sent = 0;
  let bodyFinished = false, copyObserved = null, copyPoll;
  const req = https.request(origin + '/api/sftp/upload', { method: 'POST', rejectUnauthorized: false, headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': header.length + size + footer.length } });
  const response = new Promise((resolve, reject) => { req.on('response', res => { let body = ''; res.on('data', c => { body += c; }); res.on('end', () => resolve({ status: res.statusCode, body })); }); req.on('error', reject); });
  response.catch(() => {});
  req.once('finish', () => { bodyFinished = true; });
  if (cancelCopy) copyPoll = setInterval(async () => {
    if (!bodyFinished || copyObserved) return;
    for (const name of (await readdir(dirname(destination))).filter(n => n.startsWith('.webterm-upload-') && n.endsWith('.partial'))) {
      const size = await stat(join(dirname(destination), name)).then(s => s.size).catch(() => 0);
      if (size > 0 && !copyObserved) {
        copyObserved = { bytes: size, bodyFinished };
        req.destroy(new Error('OWNED_REMOTE_COPY_CANCEL')); break;
      }
    }
  }, 5);
  try {
    await pipeline(Readable.from((async function* () { yield header; for await (const chunk of createReadStream(source)) { sent += chunk.length; if (cancelAt && sent >= cancelAt) throw new Error('OWNED_STAGING_CANCEL'); yield chunk; } yield footer; })()), req);
    const result = await response;
    assert.equal(result.status, 200, `upload failed status ${result.status}`);
    assert(!cancelCopy, 'Remote copy completed before cancellation could be observed');
    return { sent, status: result.status };
  } catch (error) {
    if (cancelAt && error.message === 'OWNED_STAGING_CANCEL') return { sent, cancelled: true };
    if (cancelCopy && error.message === 'OWNED_REMOTE_COPY_CANCEL') return { sent, cancelled: true, copyObserved };
    throw error;
  } finally { clearInterval(copyPoll); }
};
try {
  report.health = await api('/api/health'); assert.equal(report.health.environment, 'release-test');
  assert.equal(report.health.version, process.env.WEBTERM_QA_EXPECT_VERSION || 'e388c5a-strict-diagnostic13');
  token = (await api('/api/auth/test-session', 'POST')).token; assert(token);
  const source = join(fixture, 'source.bin'), target = join(fixture, 'target.bin'), cancelledTarget = join(fixture, 'cancelled.bin');
  const block = Buffer.alloc(64 * 1024); for (let i = 0; i < block.length; i++) block[i] = (i * 31 + 17) % 251;
  await pipeline(Readable.from((async function* () { for (let i = 0; i < size / block.length; i++) yield block; })()), createWriteStream(source, { mode: 0o600 }));
  const expected = await hashFile(source);
  const pid = Number((await readFile('runtime/webterm-release.pid', 'utf8')).trim());
  const baseline = { server: await rss(pid), client: process.memoryUsage().rss, stagingDiskBytes: await stagingDisk() };
  const samples = []; timer = setInterval(async () => { try { samples.push({ at: Date.now(), server: await rss(pid), client: process.memoryUsage().rss, stagingDiskBytes: await stagingDisk() }); } catch {} }, 100);
  let start = Date.now(); await upload(source, target);
  assert.equal(await hashFile(target), expected);
  report.stages.push({ name: '256MiB multipart upload via real SFTP', status: 'PASS', milliseconds: Date.now() - start, sha256: expected });
  const ticket = await api('/api/ws-tickets', 'POST', { endpoint: 'sftp-download', conn_id: 2 });
  const downloaded = createHash('sha256'); let received = 0;
  await new Promise((resolve, reject) => { const req = https.get(origin + `/api/sftp/download/2?path=${encodeURIComponent(target)}&ticket=${encodeURIComponent(ticket.ticket)}`, { rejectUnauthorized: false }, res => { if (res.statusCode !== 200) { res.resume(); return reject(new Error(`download HTTP ${res.statusCode}`)); } res.on('data', c => { received += c.length; downloaded.update(c); }); res.on('end', resolve); res.on('error', reject); }); req.on('error', reject); });
  assert.equal(received, size); assert.equal(downloaded.digest('hex'), expected);
  report.stages.push({ name: '256MiB streamed HTTP download SHA', status: 'PASS', bytes: received });
  await writeFile(cancelledTarget, 'original remains', { mode: 0o600 }); const originalSHA = await hashFile(cancelledTarget);
  const cancelled = await upload(source, cancelledTarget, 4 * 1024 * 1024); assert(cancelled.cancelled);
  await new Promise(resolve => setTimeout(resolve, 1500));
  assert.equal(await hashFile(cancelledTarget), originalSHA);
  assert.equal((await readdir(fixture)).filter(n => n.endsWith('.partial')).length, 0);
  report.stages.push({ name: 'HTTP staging cancelled after 4MiB; original unchanged', status: 'PASS', ...cancelled });
  await upload(source, cancelledTarget); assert.equal(await hashFile(cancelledTarget), expected);
  report.stages.push({ name: 'explicit retry after staging cancellation', status: 'PASS' });
  await writeFile(cancelledTarget, 'original remains', { mode: 0o600 });
  const copyCancel = await upload(source, cancelledTarget, undefined, true);
  assert(copyCancel.copyObserved?.bodyFinished && copyCancel.copyObserved.bytes > 0);
  const cleanupDeadline = Date.now() + 5000;
  while ((await readdir(fixture)).some(n => n.endsWith('.partial')) && Date.now() < cleanupDeadline) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(await hashFile(cancelledTarget), originalSHA);
  assert.equal((await readdir(fixture)).filter(n => n.endsWith('.partial')).length, 0);
  report.stages.push({ name: 'HTTP cancel during proven second-hop SFTP copy', status: 'PASS', ...copyCancel });
  await upload(source, cancelledTarget); assert.equal(await hashFile(cancelledTarget), expected);
  assert.equal((await api('/api/health')).environment, 'release-test');
  report.stages.push({ name: 'explicit retry after second-hop cancellation; health', status: 'PASS' });
  clearInterval(timer);
  const peak = { server: Math.max(baseline.server, ...samples.map(s => s.server)), client: Math.max(baseline.client, ...samples.map(s => s.client)), stagingDiskBytes: Math.max(baseline.stagingDiskBytes, ...samples.map(s => s.stagingDiskBytes)) };
  report.memory = { baseline, peak, serverDelta: peak.server - baseline.server, clientDelta: peak.client - baseline.client, intervalMs: 100, samples };
  assert(report.memory.serverDelta <= limits.serverRSSDelta, 'server RSS delta exceeds declared threshold');
  assert(report.memory.clientDelta <= limits.clientRSSDelta, 'client RSS delta exceeds declared threshold');
  report.status = 'PASS_HTTP_NODE_ONLY';
  assert.equal(dirname(fixture), tmpdir()); assert(basename(fixture).startsWith('webterm-owned-http-transfer-'));
  await rm(fixture, { recursive: true }); report.fixtureCleaned = true;
} catch (error) { report.status = 'FAIL'; report.error = error.message; process.exitCode = 1; }
finally { clearInterval(timer); await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2), { mode: 0o600 }); }
console.log(JSON.stringify({ output, status: report.status, error: report.error, stages: report.stages, memory: report.memory && { serverDelta: report.memory.serverDelta, clientDelta: report.memory.clientDelta }, fixtureCleaned: report.fixtureCleaned }));
