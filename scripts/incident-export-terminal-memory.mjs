import { request } from '../ui/node_modules/playwright/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// Incident-only, authenticated read of the existing history fallback. Never
// opens a browser/terminal or creates, deletes, renames or attaches a session.
const origin = 'https://192.168.11.87:9443';
const output = `runtime/incident-20260917-production-tmux/memory-${Date.now()}`;
if (!process.env.WEBTERM_INCIDENT_USER || !process.env.WEBTERM_INCIDENT_PASSWORD) throw new Error('Incident credentials required via environment');
const sessions = execFileSync('/usr/bin/tmux', ['list-sessions', '-F', '#{session_name}'], { encoding: 'utf8' });
if (sessions.split('\n').some(name => name.includes('-999999-999999-'))) throw new Error('Sentinel target unexpectedly exists; refusing capture');
await mkdir(output, { recursive: true, mode: 0o700 });
const api = await request.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
const report = { at: new Date().toISOString(), source: origin, items: [], output };
try {
  const health = await (await api.get('/api/health')).json();
  if (health.environment !== 'production' || health.version !== '8d63f1a5eb463a94be13331f4b025e5dc0704d12') throw new Error('Unexpected production version; re-audit fallback implementation');
  report.health = health;
  const loginResponse = await api.post('/api/auth/login', { data: {
    username: process.env.WEBTERM_INCIDENT_USER, password: process.env.WEBTERM_INCIDENT_PASSWORD,
  } });
  if (!loginResponse.ok()) throw new Error(`Login status ${loginResponse.status()}; no retries`);
  const login = await loginResponse.json();
  const headers = { Authorization: `Bearer ${login.token}` };
  const layoutResponse = await api.get('/api/layout', { headers });
  if (!layoutResponse.ok()) throw new Error(`Layout status ${layoutResponse.status()}`);
  const layout = await layoutResponse.json();
  await writeFile(`${output}/layout.json`, JSON.stringify(layout, null, 2), { mode: 0o600 });
  for (const workspace of layout.layout.workspaceTabs) {
    for (const pane of Object.values(workspace.layout.panes)) {
      for (const tab of pane.tabs) {
        if (tab.type !== 'ssh') continue;
        const query = new URLSearchParams({ terminal_id: tab.id, workspace_index: '999999', panel_number: '999999' });
        const response = await api.get(`/api/terminal-history/${tab.connId}?${query}`, { headers, timeout: 30000 });
        const item = { workspace: workspace.index, panel: tab.labelNumber, terminalID: tab.id, connection: tab.connId,
          at: new Date().toISOString(), status: response.status() };
        if (response.ok()) {
          const payload = await response.json();
          const bytes = Buffer.from(payload.data, 'base64');
          item.bytes = bytes.length;
          item.sha256 = createHash('sha256').update(bytes).digest('hex');
          item.file = `w${workspace.index}-p${tab.labelNumber}-${report.items.length}.ansi`;
          await writeFile(`${output}/${item.file}`, bytes, { mode: 0o600 });
        }
        report.items.push(item);
        await writeFile(`${output}/manifest.json`, JSON.stringify(report, null, 2), { mode: 0o600 });
        console.log(JSON.stringify({ workspace: item.workspace, panel: item.panel, status: item.status, bytes: item.bytes }));
      }
    }
  }
} finally {
  await api.dispose();
  await writeFile(`${output}/manifest.json`, JSON.stringify(report, null, 2), { mode: 0o600 });
}
console.log(JSON.stringify({ output, recoveredBuffers: report.items.filter(item => item.bytes > 0).length }));
