import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const root='runtime/geometry-20260929';
const files=['auto-full-r8','auto-full-r8-fresh-rest','auto-full-r8-reloads'];
const expected=['verify-idle-shell-visibility','verify-peer-font-stability','verify-terminal-switch-stability','verify-cross-pane-move','verify-terminal-two-display','verify-shell-repeat','verify-claude-repeat','verify-claude-composer','verify-mobile','verify-mobile-landscape','verify-workspace-close'];
const final=new Map(),attempts=[];
let candidate;
for(const file of files) {
  const report=JSON.parse(await readFile(`${root}/${file}/report.json`,'utf8'));
  candidate ||= report.candidate.version;
  assert.equal(report.candidate.version,candidate);
  for(const item of report.cases) {
    const attempt={...item,report:`${file}/report.json`}; attempts.push(attempt);
    final.set(`${item.phase}/${item.name}`,attempt);
    if(item.status!=='PASS') {
      assert.equal(`${file}/${item.phase}/${item.name}`,'auto-full-r8/fresh/verify-claude-repeat','Unexplained failure');
      const log=await readFile(`${item.path}/runner.log`,'utf8');
      assert(log.includes('Composer boundary not found'),'Unexplained Claude failure');
    }
  }
}
for(const phase of ['fresh','normal','hard']) for(const name of expected) assert.equal(final.get(`${phase}/${name}`)?.status,'PASS',`${phase}/${name}`);
const automatic=JSON.parse(await readFile(`${root}/auto-r8-real-focus2/results.json`,'utf8'));
assert.equal(automatic.status,'PASS'); assert.equal(automatic.results.length,9); assert.deepEqual(automatic.errors,[]);
const geometry=JSON.parse(await readFile(`${root}/auto-geometry-r8-passive/results.json`,'utf8'));
assert.equal(geometry.status,'PASS'); assert.equal(geometry.results.length,39); assert.deepEqual(geometry.errors,[]);
for(const record of geometry.results.filter(item=>item.controllerInitial)) assert.equal(record.controllerInitial.font,record.controller.font);
await writeFile(`${root}/automatic-acceptance.json`,JSON.stringify({candidate,status:'PASS (automated; physical devices NOT RUN)',cases:[...final.values()],attempts,
  automaticRecords:9,geometryRecords:39,resolvedHarnessFailure:'Initial fresh Claude composer capture occurred during automatic resize redraw, before typing. Waits now require the requested grid and a complete composer/cursor boundary; the 160-character assertion is unchanged.',
  geometryEvidence:'auto-geometry-r8-passive/results.json',
  priorGeometryAttempt:{path:'auto-geometry-r8/results.json',status:'FAIL',explanation:'The old background-reload probe clicked a tab after reload, which is now an intentional automatic-fit activation. Final probe reads the restored active tab without clicking and explicitly requires background/foreground focus states before checking ownership.'},
  physicalDevices:'NOT RUN'},null,2));
console.log(`${candidate}: 33 dynamic cases, 9 automatic-fit records and 39 geometry records PASS`);
