import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium }=createRequire(import.meta.url)('../ui/node_modules/playwright');
const output=process.env.WEBTERM_QA_OUTPUT || 'runtime/geometry-20260929/claude-idle-hard';
const health=()=>JSON.parse(execFileSync('curl',['-ks','https://192.168.11.87:9444/api/health'],{encoding:'utf8'}));
const candidate=health();
assert.equal(candidate.environment,'release-test');
await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:false,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:3440,height:1440},ignoreHTTPSErrors:true,recordVideo:{dir:output,size:{width:1720,height:720}}});
const page=await context.newPage();
const events=[],rounds=[],errors=[];
page.on('pageerror',error=>errors.push(error.message));
let target,status='FAIL';
page.on('websocket',ws=>{
  if(!ws.url().includes('/ws/ssh/')) return;
  const id=new URL(ws.url()).searchParams.get('terminal_id');
  ws.on('framesent',({payload})=>{
    try { const m=JSON.parse(String(payload)); if(m.cols || m.action==='take_size_control') events.push({time:Date.now(),id,send:m}); } catch {}
  });
  ws.on('framereceived',({payload})=>{
    try {
      const m=JSON.parse(String(payload)); if(!m.data) return;
      const bytes=m.b64 ? Buffer.from(m.data,'base64') : Buffer.from(m.data);
      const text=bytes.toString();
      const grids=[...text.matchAll(/\x1b\]2;webterm-grid:(\d+)x(\d+)\x07/g)].map(m=>m[1]+'x'+m[2]);
      events.push({time:Date.now(),id,receive:{length:bytes.length,grids,snapshot:text.startsWith('\x1b]2;webterm-grid:') && text.includes('\x1b[2J')}});
    } catch {}
  });
});
const tab=()=>page.locator('[data-tab-id]').filter({hasText:/^6:/}).first();
const surface=()=>tab().locator('xpath=ancestor::*[contains(@class,"terminal-grid-cell")]').locator('.terminal-surface:visible');
const inspect=()=>surface().evaluate(e=>{
  // Read the existing public xterm API via its React ref, without adding
  // production diagnostics or touching terminal input/state.
  let fiber=e[Object.keys(e).find(k=>k.startsWith('__reactFiber$'))],term;
  for(let depth=0;fiber && depth<25 && !term;depth++,fiber=fiber.return) {
    let hook=fiber.memoizedState;
    for(let n=0;hook && n<120;n++,hook=hook.next) {
      const value=hook.memoizedState?.current;
      if(value?.buffer?.active && value.element?.closest('.terminal-surface')===e) { term=value; break; }
    }
  }
  if(!term) throw new Error('Terminal public API ref not found');
  const b=term.buffer.active;
  const lines=Array.from({length:term.rows},(_,i)=>b.getLine(b.baseY+i)?.translateToString(true) || '');
  const rules=lines.filter(line=>/^─{5}/.test(line.trimStart())).map(line=>line.length);
  return {focus:document.hasFocus(),visibility:document.visibilityState,dataset:{...e.dataset},cols:term.cols,rows:term.rows,rules,lines};
});
try {
  await page.goto('https://192.168.11.87:9444/',{waitUntil:'networkidle'});
  await tab().click(); await surface().scrollIntoViewIfNeeded();
  target=await tab().getAttribute('data-tab-id');
  const cdp=await context.newCDPSession(page);
  await cdp.send('Emulation.setFocusEmulationEnabled',{enabled:false});
  await page.bringToFront(); await page.waitForTimeout(3000);
  const before=await inspect(); rounds.push({phase:'before',state:before});
  await surface().screenshot({path:`${output}/before.png`});
  for(let i=0;i<Number(process.env.WEBTERM_QA_ROUNDS || 5);i++) {
    assert.equal(health().version,candidate.version,'Candidate changed during native reload verification');
    await page.evaluate(()=>{document.title='WebTerm-Claude-idle-hard-QA';});
    // This runner owns a separate Xvfb display and exactly one Chrome window.
    // The app may replace document.title during output, so resolve that owned
    // window by class rather than racing the terminal's OSC title updates.
    const windows=execFileSync('xdotool',['search','--onlyvisible','--class','google-chrome'],{encoding:'utf8'}).trim().split('\n');
    assert.equal(windows.length,1,'Native shortcut must target only the isolated QA browser');
    const window=windows[0];
    execFileSync('xdotool',['windowfocus','--sync',window]);
    const navigation=page.waitForEvent('framenavigated',f=>f===page.mainFrame());
    execFileSync('xdotool',['key','--clearmodifiers','ctrl+shift+r']);
    await navigation; await page.waitForLoadState('domcontentloaded');
    // No tab click, terminal focus, mouse movement or key after navigation.
    await cdp.send('Emulation.setFocusEmulationEnabled',{enabled:false});
    await surface().waitFor();
    for(const delay of [1000,3000,6000]) {
      await page.waitForTimeout(delay===1000 ? 1000 : delay===3000 ? 2000 : 3000);
      const state=await inspect(); rounds.push({phase:`hard-${i}`,delay,state});
      console.log(JSON.stringify({round:i,delay,focus:state.focus,cols:state.cols,requested:state.dataset.requestedCols,rules:state.rules}));
      await surface().screenshot({path:`${output}/hard-${i}-${delay}.png`});
    }
    const last=rounds.at(-1).state;
    assert.equal(last.cols,+last.dataset.requestedCols,'No-input hard reload does not fill the local grid');
    assert.equal(last.rows,+last.dataset.requestedRows,'No-input hard reload does not fill height');
    assert(last.rules.length>=2,'Claude composer/status boundaries missing');
    assert(last.rules.slice(-2).every(width=>width>=last.cols-2),'Claude rendered composer remains narrower than its grid');
    assert.equal(await tab().getAttribute('data-tab-id'),target,'Hard reload changed the selected terminal identity');
  }
  assert.deepEqual(errors,[]);
  status='PASS';
} finally {
  const browserVersion=browser.version();
  await browser.close();
  await writeFile(`${output}/results.json`,JSON.stringify({candidate,browserVersion,viewport:{width:3440,height:1440},nativeShortcut:'Ctrl+Shift+R on owned Xvfb Chrome window',postNavigationInput:false,status,rounds,errors,events:events.filter(e=>e.id===target)},null,2));
}
