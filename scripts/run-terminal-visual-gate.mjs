import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const health = () => JSON.parse(execFileSync('curl', ['-ks', 'https://192.168.11.87:9444/api/health'], { encoding: 'utf8' }));
const candidate = health(); assert.equal(candidate.environment, 'release-test');
const root = process.env.WEBTERM_QA_OUTPUT || `runtime/visual-gate-${candidate.version.slice(0, 7)}`;
await mkdir(root, { recursive: true });
const report = { candidate, cases: [], status: 'RUNNING' };
const cases = ['verify-peer-font-stability', 'verify-terminal-switch-stability', 'verify-cross-pane-move', 'verify-terminal-two-display', 'verify-shell-repeat', 'verify-claude-repeat', 'verify-claude-composer', 'verify-mobile'];
for (const phase of ['fresh', 'normal', 'hard']) {
  for (const name of cases) {
    assert.equal(health().version, candidate.version, 'Candidate changed mid-acceptance');
    const path = `${root}/${phase}/${name}`; await mkdir(path, { recursive: true });
    console.log(`START ${phase} ${name}`);
    const started = Date.now(); let log = '';
    const code = await new Promise((resolve, reject) => {
      const child = spawn('xvfb-run', ['-a', 'node', `scripts/${name}.mjs`], { env: { ...process.env, WEBTERM_QA_RELOAD: phase, WEBTERM_QA_OUTPUT: path } });
      child.stdout.on('data', data => { log += data; }); child.stderr.on('data', data => { log += data; });
      child.on('error', reject); child.on('close', resolve);
    });
    await writeFile(`${path}/runner.log`, log);
    report.cases.push({ phase, name, status: code === 0 ? 'PASS' : 'FAIL', elapsedMs: Date.now() - started, path });
    console.log(`${code === 0 ? 'PASS' : 'FAIL'} ${phase} ${name}`);
    if (code !== 0) { report.status = 'FAIL'; await writeFile(`${root}/report.json`, JSON.stringify(report, null, 2)); throw new Error(`Failed ${phase}/${name}; evidence ${path}/runner.log`); }
    await writeFile(`${root}/report.json`, JSON.stringify(report, null, 2));
  }
}
report.status = 'PASS (automated matrix only; requires visual artifact review and physical-device disclosure)';
await writeFile(`${root}/report.json`, JSON.stringify(report, null, 2));
