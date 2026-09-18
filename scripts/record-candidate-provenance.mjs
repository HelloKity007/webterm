import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const candidate = await (await fetch('http://127.0.0.1:8889/api/health')).json();
assert.equal(candidate.environment, 'release-test');
const output = process.env.WEBTERM_QA_OUTPUT || `runtime/candidate-${candidate.version}`;
const paths = [...new Set(git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0'))]
  .filter(path => path.endsWith('.go') || /^ui\/(src\/|package(-lock)?\.json$|vite\.config)/.test(path))
  .sort();
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = {};
for (const path of paths) sources[path] = sha(await readFile(path));
async function filesUnder(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.sort((a, b) => a.name.localeCompare(b.name)).map(async entry => {
    const path = `${root}/${entry.name}`;
    return entry.isDirectory() ? filesUnder(path) : [path];
  }));
  return nested.flat();
}
const frontendAssets = {};
for (const path of await filesUnder('frontend/dist')) frontendAssets[path] = sha(await readFile(path));
const report = {
  capturedAt: new Date().toISOString(), candidate,
  branch: git('branch', '--show-current'), head: git('rev-parse', 'HEAD'),
  worktreeStatus: git('status', '--short'),
  binarySha256: sha(await readFile('runtime/release/webterm')),
  sourceManifestSha256: sha(JSON.stringify(sources)), sources,
  frontendManifestSha256: sha(JSON.stringify(frontendAssets)), frontendAssets,
  scope: 'Current test binary, frontend assets, and committed source hashes; not a signed-off release',
};
await mkdir(output, { recursive: true });
await writeFile(`${output}/provenance.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ candidate, binarySha256: report.binarySha256, files: paths.length, artifact: `${output}/provenance.json` }));
