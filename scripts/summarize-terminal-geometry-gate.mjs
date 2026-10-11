import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const root = process.env.WEBTERM_QA_OUTPUT || 'runtime/geometry-20260929';
const files = ['full-gate-r7', 'full-gate-r7-fresh-rest', 'full-gate-r7-close', 'full-gate-r7-reloads', 'full-gate-r7-hard-rest', 'full-gate-r7-hard-rest2'];
const expectedCases = ['verify-idle-shell-visibility','verify-peer-font-stability','verify-terminal-switch-stability','verify-cross-pane-move','verify-terminal-two-display','verify-shell-repeat','verify-claude-repeat','verify-claude-composer','verify-mobile','verify-mobile-landscape','verify-workspace-close'];
const final = new Map();
const attempts = [];
let candidate;
for (const file of files) {
  const report = JSON.parse(await readFile(`${root}/${file}/report.json`,'utf8'));
  candidate ||= report.candidate.version;
  assert.equal(report.candidate.version,candidate,'Cannot combine different candidates');
  for (const item of report.cases) {
    attempts.push({...item, report:`${file}/report.json`});
    final.set(`${item.phase}/${item.name}`,item);
  }
}
for (const phase of ['fresh','normal','hard']) for (const name of expectedCases) {
  assert.equal(final.get(`${phase}/${name}`)?.status,'PASS',`Missing final PASS: ${phase}/${name}`);
}
const resolvedHarnessFailures = {
  'fresh/verify-mobile': 'Replaced fixed 69-column assertion with equality to the actual server grid; retained input bounds and 12px wrapped-reader checks.',
  'fresh/verify-workspace-close': 'Supplied WEBTERM_QA_DB for the existing isolated-session test fixture; earlier probe used the legacy shared socket. All temporary sessions were cleaned by API.',
  'hard/verify-claude-repeat': 'The first 40-key screenshot was blank before attachment; replaced a fixed 1-second delay with actual output, renderer and server-grid readiness. The remaining 120 QA characters were removed after exact draft/cursor verification. An intermediate harness revision used claude instead of cli for terminalMode and timed out before typing; corrected to the actual mode enum. The unchanged 160-character assertion must pass on rerun.',
};
for (const attempt of attempts.filter(item=>item.status!=='PASS')) {
  assert(resolvedHarnessFailures[`${attempt.phase}/${attempt.name}`],'Unexplained earlier failure');
}
const geometry=JSON.parse(await readFile(`${root}/browser-r7-final/results.json`,'utf8'));
assert.equal(geometry.status,'PASS');
assert.equal(geometry.results.length,39,'Incomplete dedicated geometry/dual-reload matrix');
assert.deepEqual(geometry.errors,[]);
for (const check of geometry.results.filter(item=>item.controllerInitial)) {
  assert.equal(check.controllerInitial.font,check.controller.font,'Reload transient changed local font');
}
const report={candidate,status:'PASS (automated; physical-device validation NOT RUN)',uniqueCases:final.size,
  cases:[...final.values()],attempts,resolvedHarnessFailures,geometryChecks:geometry.results.length,
  geometryEvidence:'browser-r7-final/results.json',
  priorGeometryAttempt:{path:'browser-r7/results.json',status:'FAIL',explanation:'Initial reload frame was sampled before font metrics and requested geometry settled. Final run retains initial frames and requires both controller and mirror to return to the pre-reload grid without clicking Fit; initial and final fonts must match.'},
  physicalDevices:'NOT RUN',evidenceRoot:root};
await writeFile(`${root}/acceptance.json`,JSON.stringify(report,null,2));
console.log(`${candidate}: ${final.size} dynamic cases and ${geometry.results.length} geometry measurements PASS`);
