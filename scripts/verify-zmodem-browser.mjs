import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {chromium} from '../ui/node_modules/playwright/index.mjs';
import {terminalViewportProbe} from './terminal-viewport-probe.mjs';
const output=resolve(process.env.WEBTERM_QA_OUTPUT||'runtime/zmodem-browser');await mkdir(output,{recursive:true,mode:0o700});
const expectedVersion=process.env.WEBTERM_QA_EXPECT_VERSION||'e388c5a-strict-diagnostic13';
const fixture=await mkdtemp(join(tmpdir(),'webterm-owned-zmodem-'));
// Terminal creation is deliberately explicit. Do not synthesize a legacy
// panel session: reconnecting an unknown ID must fail closed under R9.
let id='', session='', authToken='';
const tmux=resolve('runtime/tmux-fixed/bin/tmux'),tools=resolve('runtime/zmodem-tools/extracted/usr/bin');
const bytes=Buffer.from(Array.from({length:65536},(_,i)=>i%256));const payload=join(fixture,'payload.bin');await writeFile(payload,bytes,{mode:0o600});
const expected= createHash('sha256').update(bytes).digest('hex');
const browser=await chromium.launch();const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true,viewport:{width:1440,height:1000},recordVideo:{dir:join(output,'video')}});
const errors=[],checks=[];let candidate,failure;
const pane='qa-zmodem-pane';
await context.routeWebSocket(/\/ws\/control/,r=>r.close());
const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));
const frames=[];const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');cdp.on('Network.webSocketFrameReceived',e=>frames.push({direction:'received',data:e.response.payloadData}));cdp.on('Network.webSocketFrameSent',e=>frames.push({direction:'sent',data:e.response.payloadData}));
const surface=page.locator('.terminal-surface');
async function command(text){await surface.click({position:{x:80,y:60}});await page.keyboard.insertText(text);await page.keyboard.press('Enter');}
async function waitText(text){for(let n=0;n<100;n++){const p=await surface.evaluate(terminalViewportProbe,true);if(p.diagnostic.lines.some(l=>l.text.startsWith(text)))return p;await page.waitForTimeout(100);}throw new Error(`terminal marker absent: ${text}`);}
try{
 const testSession=await (await fetch('http://127.0.0.1:8889/api/auth/test-session',{method:'POST'})).json();
 assert.equal(typeof testSession.token,'string');authToken=testSession.token;
 // The authenticated terminal API expects a Bearer token.  Keep this explicit
 // so a failed setup is reported as an API failure rather than a misleading
 // terminal-ID type assertion.
 const createResponse=await fetch('http://127.0.0.1:8889/api/terminal-sessions/2',{method:'POST',headers:{Authorization:`Bearer ${authToken}`,'Content-Type':'application/json'},body:'{}'});
 const createBody=await createResponse.text();
 assert.equal(createResponse.ok,true,`QA terminal create returned ${createResponse.status}: ${createBody}`);
 const created=JSON.parse(createBody);
 assert.equal(typeof created.terminal_id,'string',`QA terminal create response lacks terminal_id: ${createBody}`);
 id=created.terminal_id;assert.match(id,/^terminal-[a-f0-9]{32}$/);
 session=`wt-1-2-${createHash('sha256').update(id).digest('hex').slice(0,16)}`;
 const layout={schema_version:2,revision:1,layout:{workspaceTabs:[{id:'qa-zmodem-workspace',index:99,name:'Owned ZMODEM QA',layout:{tree:{type:'leaf',id:pane},panes:{[pane]:{tabs:[{id,type:'ssh',title:'Owned ZMODEM QA',connId:2,labelNumber:1}],activeTabId:id}},focusedPaneId:pane}}]}};
 await context.addInitScript(({token,user})=>{localStorage.setItem('token',token);localStorage.setItem('webterm-user',JSON.stringify(user));},{token:authToken,user:testSession.user});
 await context.route('**/api/layout',r=>r.fulfill({json:layout}));
 await context.route('**/api/ws-tickets',r=>{const p=r.request().postDataJSON();return p.endpoint==='ssh'&&p.terminal_id===id?r.continue():r.fulfill({status:403,body:'{}'});});
 await page.goto('https://192.168.11.87:9444');candidate=await page.evaluate(async()=>await(await fetch('/api/health')).json());assert.equal(candidate.version,expectedVersion);assert.equal(candidate.environment,'release-test');
 await surface.waitFor();await page.waitForTimeout(1500);
 const actual=execFileSync(tmux,['-L','webterm-release-test-fixed','display-message','-p','-t',session,'#{session_name}'],{encoding:'utf8'}).trim();assert.equal(actual,session);
 await command(`printf '\nQA_READY_ZMODEM\n'`);await waitText('QA_READY_ZMODEM');
 if(process.env.WEBTERM_QA_ZMODEM_MODE!=='rz-only'){
 const downloadPromise=page.waitForEvent('download',{timeout:30000});
 await command(`${tools}/sz -b '${payload}'; printf '\nQA_SZ_DONE\n'`);
 const download=await downloadPromise;const downloaded=join(output,'download.bin');await download.saveAs(downloaded);assert.equal(await download.failure(),null);
 const actualHash=createHash('sha256').update(await readFile(downloaded)).digest('hex');assert.equal(actualHash,expected);await waitText('QA_SZ_DONE');checks.push({name:'real SSH sz to browser download',status:'PASS',size:bytes.length,sha256:actualHash});
 }
 await command(`cd '${fixture}' && ${tools}/rz; printf '\nQA_RZ_RETURNED\n'`);
 await waitText('QA_RZ_RETURNED');const probe=await surface.evaluate(terminalViewportProbe,true);assert(probe.diagnostic.lines.some(l=>l.text.includes('upload unavailable; use SFTP')));
 await command(`printf '\nQA_AFTER_RZ_ALIVE\n'`);await waitText('QA_AFTER_RZ_ALIVE');checks.push({name:'rz unsupported upload safely aborted, notice and shell usable',status:'PASS',uploadSupport:'NOT SUPPORTED'});
 assert.deepEqual(errors,[]);await page.screenshot({path:join(output,'result.png')});
}catch(e){failure=String(e);try{await page.screenshot({path:join(output,'failure.png')});await writeFile(join(output,'terminal.json'),JSON.stringify(await surface.evaluate(terminalViewportProbe,true),null,2));}catch{}}
finally{
 await context.close();await browser.close();
 await writeFile(join(output,'qa-terminal-frames.json'),JSON.stringify(frames,null,2),{mode:0o600});
 let cleanup='no terminal was created';try{if(id){const response=await fetch(`http://127.0.0.1:8889/api/terminal-sessions/2?terminal_id=${encodeURIComponent(id)}&terminate=1`,{method:'DELETE',headers:{Authorization:`Bearer ${authToken}`}});assert(response.ok,`exact QA terminal cleanup returned ${response.status}`);cleanup='only exact API-created QA session removed';}}catch(e){cleanup=`exact-session cleanup failed: ${e.message}`;}
 await writeFile(join(output,'report.json'),JSON.stringify({status:failure?'FAIL':'PASS',failure,candidate,session,fixture,checks,errors,cleanup,isolation:'unique terminalID workspace99, HTTP layout fixture no writes, SSH ticket only owned ID, private test tmux socket; browser real ThemedTerminal/Zmodem handler; no production/user session'},null,2),{mode:0o600});
 if(!failure)await rm(fixture,{recursive:true});
}
if(failure){console.error(failure);process.exitCode=1;}else console.log(`PASS: ${checks.map(c=>c.name).join('; ')}`);
