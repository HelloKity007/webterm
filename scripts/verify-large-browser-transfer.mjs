import assert from 'node:assert/strict';
import { chromium } from '../ui/node_modules/playwright/index.mjs';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const origin = process.env.WEBTERM_QA_ORIGIN || 'https://192.168.11.87:9444';
const expectedVersion = process.env.WEBTERM_QA_EXPECT_VERSION || '';
const output = resolve(process.env.WEBTERM_QA_OUTPUT || `runtime/large-browser-transfer-${Date.now()}`);
await mkdir(output, { recursive: true, mode: 0o700 });
const fixture = await mkdtemp(join(tmpdir(), 'webterm-owned-browser-transfer-'));
const local = join(fixture, 'local'), remote = join(fixture, 'remote');
await mkdir(local, { mode: 0o700 }); await mkdir(remote, { mode: 0o700 });
const source = join(local, 'payload.bin'), target = join(remote, 'payload.bin');
const block = Buffer.alloc(65536); for (let i=0;i<block.length;i++) block[i]=(i*31+17)%251;
await pipeline(Readable.from((async function*(){for(let i=0;i<4096;i++)yield block;})()), createWriteStream(source,{mode:0o600}));
const hash = async file => {const h=createHash('sha256');for await(const c of createReadStream(file))h.update(c);return h.digest('hex');};
const expected = await hash(source);
// Declared before browser measurement: renderer heap delta <=64MiB;
// sum RSS delta of owned browser processes <=384MiB (shared pages double counted).
const report={status:'RUNNING',fixture,expectedVersion,limits:{heapDelta:64*1024*1024,rssDelta:384*1024*1024},stages:[],samples:[],errors:[]};
const browser=await chromium.launch();const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true,viewport:{width:1440,height:1000}});
const bc=await browser.newBrowserCDPSession();let interval;
try {
 await context.addInitScript(({remote})=>{
  localStorage.setItem('webterm:file-workbench:v1',JSON.stringify({version:1,connectionId:2,tabs:[],active:{primary:null,secondary:null},focusedGroup:'primary',split:false}));
  window.__socketProbe=[];
  const Native=WebSocket;window.WebSocket=class extends Native{
   constructor(url,protocols){if(!/\/ws\/sftp\/2(?:\?|$)/.test(String(url)))throw new Error('QA refuses non-fixture terminal socket');super(url,protocols);this.addEventListener('message',e=>{const m=JSON.parse(e.data);window.__socketProbe.push({at:Date.now(),direction:'receive',type:m.type,path:m.path});});}
   send(raw){const m=JSON.parse(String(raw));if(!['list','ping','getwd'].includes(m.action))throw new Error('QA refuses SFTP write');window.__socketProbe.push({at:Date.now(),direction:'send',action:m.action,path:m.path});if(m.action==='list')m.path=remote;super.send(JSON.stringify(m));}
  };
  window.__transferProbe=[];
  const original=XMLHttpRequest.prototype.send;XMLHttpRequest.prototype.send=function(body){if(body instanceof FormData){const entry={at:Date.now(),path:body.get('path'),conn:body.get('conn_id')};window.__transferProbe.push(entry);if(entry.path!==remote+'/payload.bin'||entry.conn!=='2')throw new Error('QA refuses unowned upload '+JSON.stringify(entry));}return original.call(this,body);};
 },{remote});
 await context.route('**/api/layout',r=>r.fulfill({json:{schema_version:2,revision:1,layout:{workspaceTabs:[{id:'qa',index:1,name:'Transfer QA',layout:{tree:{type:'leaf',id:'empty'},panes:{empty:{tabs:[],activeTabId:null}},focusedPaneId:'empty'}}]}}}));
 await context.route('**/api/ws-tickets',r=>['sftp','sftp-download'].includes(r.request().postDataJSON().endpoint)?r.continue():r.fulfill({status:403,body:'{}'}));
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(origin,{waitUntil:'networkidle'});report.health=await page.evaluate(()=>fetch('/api/health').then(r=>r.json()));assert.equal(report.health.environment,'release-test');if(expectedVersion)assert.equal(report.health.version,expectedVersion);
 await page.locator('.activity-files').click();await page.locator('.sftp-file-list').waitFor();
 await page.waitForFunction(remote=>document.querySelector('.sftp-path-input')?.value===remote||[...document.querySelectorAll('input')].some(e=>e.value===remote),remote);
 const cdp=await context.newCDPSession(page);
 const sample=async()=>{const heap=await cdp.send('Runtime.getHeapUsage');const {processInfo}=await bc.send('SystemInfo.getProcessInfo');let rss=0;for(const p of processInfo){try{rss+=Number((await readFile(`/proc/${p.id}/status`,'utf8')).match(/^VmRSS:\s+(\d+)/m)[1])*1024;}catch{}}return{at:Date.now(),heap:heap.usedSize,rss};};
 report.baseline=await sample();interval=setInterval(async()=>{try{report.samples.push(await sample());}catch{}},250);
 const choose=async()=>{const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:/上传|Upload/}).first().click();await(await chooser).setFiles(source);};
 const happy=async()=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/sftp/upload'),{timeout:120000});await choose();assert.equal((await response).status(),200);assert.equal(await hash(target),expected);await page.locator('[data-file-row]').filter({hasText:'payload.bin'}).waitFor();};
 await happy();report.stages.push({name:'actual FileChooser 256MiB upload',status:'PASS',sha256:expected});
 const downloadEvent=page.waitForEvent('download',{timeout:120000});await page.locator('[data-file-row]').filter({hasText:'payload.bin'}).click({button:'right'});await page.getByText(/^(下载|Download)$/).last().click();
 const download=await downloadEvent;const saved=join(local,'download.bin');await download.saveAs(saved);assert.equal(await hash(saved),expected);report.stages.push({name:'UI context-menu download 256MiB SHA',status:'PASS'});
 // Slow only this owned page's network so user cancel can be exercised reliably.
 await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:20,downloadThroughput:20*1024*1024,uploadThroughput:4*1024*1024});
 await writeFile(target,'original');const originalSHA=await hash(target);
 await choose();await page.locator('.sftp-transfer button').click({timeout:10000});
 await page.waitForTimeout(1200);assert.equal(await hash(target),originalSHA);assert.equal((await readdir(remote)).filter(n=>n.endsWith('.partial')).length,0);
 report.stages.push({name:'real UI Cancel preserves original',status:'PASS'});
 await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});await happy();report.stages.push({name:'manual file reselection retry after Cancel',status:'PASS'});
 await writeFile(target,'original');await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:20,downloadThroughput:20*1024*1024,uploadThroughput:4*1024*1024});
 report.beforeOffline=await page.locator('input').evaluateAll(es=>es.filter(e=>e.type!=='file').map(e=>e.value));
 await choose();await page.waitForTimeout(300);await context.setOffline(true);await page.waitForTimeout(1000);await context.setOffline(false);
 report.afterOnline=await page.locator('input').evaluateAll(es=>es.filter(e=>e.type!=='file').map(e=>e.value));
 await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
 assert.equal(await hash(target),originalSHA);await happy();
 report.stages.push({name:'owned context offline then online; manual reselection retry',status:report.errors.length?'FAIL':'PASS',errors:[...report.errors]});
 await page.screenshot({path:join(output,'final.png')});report.samples.push(await sample());
 report.peak={heap:Math.max(report.baseline.heap,...report.samples.map(s=>s.heap)),rss:Math.max(report.baseline.rss,...report.samples.map(s=>s.rss))};
 assert(report.peak.heap-report.baseline.heap<=report.limits.heapDelta,'renderer heap threshold exceeded');assert(report.peak.rss-report.baseline.rss<=report.limits.rssDelta,'owned browser RSS threshold exceeded');
 report.probe=await page.evaluate(()=>({uploads:window.__transferProbe,sockets:window.__socketProbe}));
 assert.deepEqual(report.errors,[]);report.status='PASS';
}catch(e){report.status='FAIL';report.error=e.message;process.exitCode=1;}
finally{clearInterval(interval);await context.setOffline(false).catch(()=>{});await browser.close();report.memoryScope='250ms renderer Runtime heap plus sum RSS of CDP-owned Chromium processes; excludes Node/server/OS file cache; RSS double-counts shared pages';await writeFile(join(output,'report.json'),JSON.stringify(report,null,2),{mode:0o600});if(report.status==='PASS')await rm(fixture,{recursive:true});}
console.log(JSON.stringify({output,status:report.status,error:report.error,stages:report.stages}));
