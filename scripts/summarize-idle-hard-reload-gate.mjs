import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

const root='runtime/geometry-20260929';
const read=async name=>JSON.parse(await readFile(`${root}/${name}`,'utf8'));
const version='geometry-20260929-r10-snapshot';
const matrix=await read('idle-full-r10-after206-closed/report.json');
assert.equal(matrix.candidate.version,version);
assert.equal(matrix.scope,'full matrix');
assert(matrix.status.startsWith('PASS'));
const names=['verify-idle-shell-visibility','verify-peer-font-stability','verify-terminal-switch-stability','verify-cross-pane-move','verify-terminal-two-display','verify-shell-repeat','verify-claude-repeat','verify-claude-composer','verify-mobile','verify-mobile-landscape','verify-workspace-close'];
assert.equal(matrix.cases.length,33);
for(const phase of ['fresh','normal','hard']) for(const name of names) {
  const records=matrix.cases.filter(item=>item.phase===phase && item.name===name);
  assert.equal(records.length,1,`${phase}/${name} missing or duplicated`);
  assert.equal(records[0].status,'PASS',`${phase}/${name}`);
}
const native=await read('claude-idle-r10-native-after206-closed/results.json');
assert.equal(native.candidate.version,version);
assert.equal(native.status,'PASS');
assert.equal(native.postNavigationInput,false);
assert.deepEqual(native.errors,[]);
const phases=new Set(native.rounds.filter(item=>item.phase.startsWith('hard-')).map(item=>item.phase));
assert.equal(phases.size,10);
for(const phase of phases) {
  for(const delay of [3000,6000]) {
    const item=native.rounds.find(item=>item.phase===phase && item.delay===delay);
    assert(item,`${phase} missing ${delay}ms content observation`);
    const {state}=item;
    assert.equal(state.cols,+state.dataset.requestedCols);
    assert.equal(state.rows,+state.dataset.requestedRows);
    assert(state.rules.length>=2);
    assert(state.rules.slice(-2).every(width=>width>=state.cols-2),'Actual composer is narrower than the grid');
  }
}
const automatic=await read('idle-auto-r10-stable/results.json');
assert.equal(automatic.candidate.version,version);
assert.equal(automatic.status,'PASS'); assert.equal(automatic.results.length,9); assert.deepEqual(automatic.errors,[]);
const geometry=await read('idle-geometry-r10-traced/results.json');
assert.equal(geometry.candidate.version,version);
assert.equal(geometry.status,'PASS'); assert.equal(geometry.results.length,39); assert.deepEqual(geometry.errors,[]);
for(const item of geometry.results.filter(item=>item.controllerInitial)) assert.equal(item.controllerInitial.font,item.controller.font);
const dualHost=await read('dual-host-r10-after206-closed/results.json');
assert.equal(dualHost.candidate.version,version);
assert.equal(dualHost.status,'PASS'); assert.equal(dualHost.samples.length,20); assert.deepEqual(dualHost.errors,[]);
for(const sample of dualHost.samples) assert(sample.controller.focus && sample.mirror.focus);
const controlled=await read('snapshot-r10-green-final/results.json');
assert.equal(controlled.results.length,4);
for(const item of controlled.results) assert(item.pass && item.currentFirstRow && item.currentComposer && item.currentStatusline);
const health=JSON.parse(execFileSync('curl',['-ks','https://192.168.11.87:9444/api/health'],{encoding:'utf8'}));
assert.equal(health.environment,'release-test'); assert.equal(health.version,version);
const sha256=execFileSync('sha256sum',[`${root}/webterm-r10`],{encoding:'utf8'}).split(/\s/)[0];
assert.equal(sha256,'4cac917b56d710df998ef42694770726def2ac9c0d31c3f55fc237ecefb0d753');
await writeFile(`${root}/idle-r10-after206-acceptance.json`,JSON.stringify({candidate:version,sha256,status:'PASS (automated; physical devices and native Windows NOT RUN)',
  dynamicCases:matrix.cases,dynamicEvidence:'idle-full-r10-after206-closed/report.json',nativeReloads:phases.size,nativeEvidence:'claude-idle-r10-native-after206-closed/results.json',postNavigationInput:false,
  automaticRecords:9,automaticEvidence:'idle-auto-r10-stable/results.json',automaticPriorFailures:[
    {path:'idle-auto-r9/results.json',status:'FAIL',reason:'Panel 7 reflowed below the viewport after restoring the small window; the product gates foreground takeover on viewport intersection. Final harness scrolls the target into view before requiring controller fill; native no-input refresh harness is unchanged.'},
    {path:'idle-auto-r9-visible/results.json',status:'FAIL',reason:'Background-control check observed the preceding peer grid during rapid focus handover. That attempt lacked a frame trace, so its exact interleaving is not proven. Final harness requires 500ms of continuous rendered/grid alignment before measuring ownership stability, keeps the unchanged background-resize assertions, and records safe WebSocket geometry metadata.'}
  ],geometryRecords:39,geometryEvidence:'idle-geometry-r10-traced/results.json',geometryPriorFailure:{
    path:'idle-geometry-r9-traced/panel-readiness-failure.json',status:'FAIL',
    reason:'Accepted snapshot geometry was discarded together with pixels by a Bash history reader. r10 emits only accepted coherent geometry independently and retains latest metadata through frontend history replay; stale snapshots remain rejected.'
  },controlledCounterexamples:4,dualHostFocusSamples:20,dualHostEvidence:'dual-host-r10-after206-closed/results.json',
  retainedIntermittentFailure:{path:'idle-full-r10/hard/verify-claude-composer/results.json',status:'FAIL',
    context:'User confirmed another 9444 page on host 206 and closed it; the persistent 104-column attachment subsequently disappeared. Exact original frame origin was not traced, so exclusive causality is not proven. New full matrix is independent and does not overwrite this failure.'},
  previousFailure:'claude-idle-r8-native/results.json',physicalDevices:'NOT RUN',nativeWindows:'NOT RUN'},null,2));
console.log(`${version}: 33 dynamic cases, 10 native idle hard reloads, 9 automatic-fit records, 39 geometry records and 4 controlled counterexamples PASS`);
