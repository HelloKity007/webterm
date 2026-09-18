import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readFile,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium} from '../ui/node_modules/playwright/index.mjs';
const output=resolve(process.env.WEBTERM_QA_OUTPUT||'runtime/large-directory-browser');
const transport=process.env.WEBTERM_QA_WS_TRANSPORT||'routed';assert(['routed','native'].includes(transport));
await mkdir(output,{recursive:true,mode:0o700});await chmod(output,0o700);
const fixture=await mkdtemp(join(tmpdir(),'webterm-owned-browser-directory-'));await chmod(fixture,0o700);
const browser=await chromium.launch(); const results=[],errors=[],requests=[];let candidate,failure;
const browserCDP=await browser.newBrowserCDPSession();
async function rss(){const {processInfo}=await browserCDP.send('SystemInfo.getProcessInfo');const processes=[];for(const p of processInfo){try{const s=await readFile(`/proc/${p.id}/status`,'utf8');processes.push({pid:p.id,type:p.type,rssKiB:Number(s.match(/^VmRSS:\s+(\d+)/m)?.[1]||0)});}catch{}}return {processes,sumRSSKiB:processes.reduce((n,p)=>n+p.rssKiB,0)};}
try {
 for(const count of [10000,50000]){
  const dir=join(fixture,String(count));await mkdir(dir,{mode:0o700});
  for(let i=0;i<count;i++)await writeFile(join(dir,`entry-${String(i).padStart(6,'0')}.txt`),'',{flag:'wx',mode:0o600});
  for(let round=1;round<=3;round++){
   const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000}});
   let received=0;const wire=[];
   try{
    await context.addInitScript(()=>localStorage.setItem('webterm:file-workbench:v1',JSON.stringify({version:1,connectionId:2,tabs:[],active:{primary:null,secondary:null},focusedGroup:'primary',split:false})));
    if(transport==='native')await context.addInitScript(({dir})=>{
      window.__directoryProbe={events:[],received:0,errors:[]};
      const Native=window.WebSocket;
      window.WebSocket=class extends Native {
        constructor(url,protocols){
          if(!/\/ws\/sftp\//.test(String(url)))throw new Error('QA blocked non-SFTP native WebSocket');
          super(url,protocols);
          this.addEventListener('message',event=>{
            const at=performance.now();const message=JSON.parse(event.data);
            if(message.type==='file_list')window.__directoryProbe.received=message.files.length;
            if(message.type==='file_list_chunk')window.__directoryProbe.received+=message.files.length;
            if(message.type?.startsWith('file_list'))window.__directoryProbe.events.push({type:message.type,at,bytes:new TextEncoder().encode(event.data).length,entries:message.files?.length});
            if(message.type==='error')window.__directoryProbe.errors.push(message.error);
          });
        }
        send(raw){const m=JSON.parse(String(raw));if(!['list','ping','getwd'].includes(m.action)){window.__directoryProbe.errors.push(`blocked action ${m.action}`);this.close();return;}if(m.action==='list'){m.path=dir;window.__directoryProbe.events.push({type:'list_send',at:performance.now()});}super.send(JSON.stringify(m));}
      };
    },{dir});
    await context.route('**/api/layout',r=>r.fulfill({json:{schema_version:2,revision:1,layout:{workspaceTabs:[{id:'qa-directory',index:1,name:'Directory QA',layout:{tree:{type:'leaf',id:'qa-empty'},panes:{'qa-empty':{tabs:[],activeTabId:null}},focusedPaneId:'qa-empty'}}]}}}));
    await context.route('**/api/ws-tickets',r=>r.request().postDataJSON().endpoint==='sftp'?r.continue():r.fulfill({status:403,body:'{}'}));
    if(transport==='routed'){
      await context.routeWebSocket(/\/ws\/(?!sftp\/)/,r=>r.close());
      await context.routeWebSocket(/\/ws\/sftp\//,r=>{const upstream=r.connectToServer();r.onMessage(raw=>{const m=JSON.parse(String(raw));if(!['list','ping','getwd'].includes(m.action)){errors.push(`blocked action ${m.action}`);r.close();return;}if(m.action==='list'){m.path=dir;requests.push({count,round,path:dir});wire.push({type:'list_send',at:performance.now()});}upstream.send(JSON.stringify(m));});upstream.onMessage(raw=>{const at=performance.now();const m=JSON.parse(String(raw));if(m.type==='file_list')received=m.files.length;if(m.type==='file_list_chunk')received+=m.files.length;if(m.type?.startsWith('file_list'))wire.push({type:m.type,at,bytes:Buffer.byteLength(raw),entries:m.files?.length});if(m.type==='error')errors.push(m.error);r.send(raw);});});
    }
    const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));
    await page.goto('https://192.168.11.87:9444');
    const health=await page.evaluate(async()=>await(await fetch('/api/health')).json());assert.equal(health.environment,'release-test');if(process.env.WEBTERM_QA_EXPECT_VERSION)assert.equal(health.version,process.env.WEBTERM_QA_EXPECT_VERSION);if(candidate)assert.deepEqual(health,candidate);else candidate=health;
    const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');await cdp.send('Network.enable');cdp.on('Network.webSocketFrameReceived',e=>wire.push({type:'browser_frame',at:performance.now(),bytes:e.response.payloadData.length}));const before=await cdp.send('Runtime.getHeapUsage');
    const browserStart=await page.evaluate(()=>performance.now());const start=performance.now();await page.locator('.activity-files').click();
    await page.locator('[data-file-row][data-index="0"]').waitFor({timeout:60000});
    const firstVisibleMs=performance.now()-start;
    await page.waitForFunction(()=>document.querySelector('.sftp-file-list')?.getAttribute('aria-busy')==='false');
    const usableMs=performance.now()-start;
    if(transport==='native'){const probe=await page.evaluate(()=>window.__directoryProbe);received=probe.received;errors.push(...probe.errors);wire.push(...probe.events.map(e=>({...e,at:e.at-browserStart+start})));}
    assert.equal(received,count);
    const rows=await page.locator('[data-file-row][data-index]').count();assert(rows<200,'virtualization must bound rendered rows');
    const list=page.locator('.sftp-file-list');await list.evaluate(e=>{e.scrollTop=e.scrollHeight;});
    const last=`entry-${String(count-1).padStart(6,'0')}.txt`;await page.locator('[data-file-row]').filter({hasText:last}).waitFor();
    await page.screenshot({path:join(output,`${count}-${round}-bottom.png`)});
    await page.locator('.sftp-filter input').fill(last);await page.waitForFunction(()=>document.querySelectorAll('[data-file-row][data-index]').length===1);assert.equal(await page.locator('[data-file-row][data-index]').innerText(),`${last}\n0 B\n${await page.locator('[data-file-row][data-index] .sftp-col-time').innerText()}`);
    await page.locator('.sftp-filter input').fill('');await page.locator('.sftp-table-head button').first().click();await list.evaluate(e=>{e.scrollTop=0;});await page.waitForFunction(last=>document.querySelector('[data-file-row][data-index="0"]')?.textContent.includes(last),last);
    const after=await cdp.send('Runtime.getHeapUsage');results.push({count,round,usableMs,firstVisibleMs,wire:wire.map(e=>({...e,at:e.at-start})),received,renderedRows:rows,heapBefore:before,heapAfter:after,browserRSS:await rss(),search:'exact filename yields one row',bottom:last});
    assert.deepEqual(errors,[]);
   }finally{await context.close();}
  }
 }
}catch(e){failure=String(e);}finally{
 await browser.close();
 await writeFile(join(output,'report.json'),JSON.stringify({status:failure?'FAIL':'PASS',failure,candidate,transport,fixture,results,errors,requests,memoryMethod:'CDP Runtime.getHeapUsage renderer JS heap; RSS sum from /proc for CDP SystemInfo process list of owned browser, instantaneous not peak, shared pages may double-count; excludes sshd/server',isolation:'fresh context; layout intercepted; terminal sockets denied; SFTP only list/ping/getwd; initial list redirected to owned real directory; upstream data unmodified',instrumentation:'native adds one JSON.parse and UTF8 byte count per message in browser; browserStart/Node start sampled sequentially, small timing offset; routed parses and forwards through Playwright'},null,2),{mode:0o600});
 if(!failure)await rm(fixture,{recursive:true});
}
if(failure){console.error(failure);process.exitCode=1;}else console.log('PASS real directory browser listing/search/virtualized bottom, six runs');
