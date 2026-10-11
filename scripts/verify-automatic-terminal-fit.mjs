import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const { chromium } = createRequire(import.meta.url)('../ui/node_modules/playwright');
const origin=process.env.WEBTERM_QA_URL || 'https://192.168.11.87:9444';
const health=()=>JSON.parse(execFileSync('curl',['-ks',`${origin}/api/health`],{encoding:'utf8'}));
const candidate=health(); assert.equal(candidate.environment,'release-test');
const output=process.env.WEBTERM_QA_OUTPUT || 'runtime/geometry-20260929/automatic';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:false,args:['--no-sandbox']});
const errors=[],results=[],events=[];
let status='FAIL';
const realFocus=async(client)=>{
  const cdp=await client.context.newCDPSession(client.page);
  await cdp.send('Emulation.setFocusEmulationEnabled',{enabled:false});
};
const open=async(width,height)=>{
  const context=await browser.newContext({viewport:{width,height},ignoreHTTPSErrors:true,recordVideo:{dir:output,size:{width:1280,height:720}}});
  const page=await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
  page.on('websocket',ws=>{
    if(!ws.url().includes('/ws/ssh/')) return;
    const id=new URL(ws.url()).searchParams.get('terminal_id');
    ws.on('framesent',({payload})=>{try{const message=JSON.parse(String(payload)); if(message.cols || message.action==='take_size_control') events.push({time:Date.now(),width,id,send:message});}catch{}});
    ws.on('framereceived',({payload})=>{try{const message=JSON.parse(String(payload)); if(!message.data)return; const data=message.b64 ? Buffer.from(message.data,'base64').toString() : message.data; const grids=[...data.matchAll(/webterm-grid:(\d+)x(\d+)/g)].map(m=>m[1]+'x'+m[2]); if(grids.length)events.push({time:Date.now(),width,id,grids});}catch{}});
  });
  // Playwright otherwise reports hasFocus=true on every page, including peers.
  await page.bringToFront(); await page.goto(origin);
  await realFocus({context,page});
  return {page,context};
};
const panel=async(page,n)=>{
  const tab=page.locator('[data-tab-id]').filter({hasText:new RegExp(`^${n}:`)}).first();
  await tab.click();
  const surface=tab.locator('xpath=ancestor::*[contains(@class,"terminal-grid-cell")]').locator('.terminal-surface:visible');
  await surface.scrollIntoViewIfNeeded();
  return surface;
};
const measure=surface=>surface.evaluate(e=>{
  const r=e.querySelector('.xterm-screen').getBoundingClientRect();
  return {cols:+e.dataset.sharedCols,rows:+e.dataset.sharedRows,font:+e.dataset.fittedFontSize,
    requestedCols:+e.dataset.requestedCols,requestedRows:+e.dataset.requestedRows,
    rightGap:e.clientWidth-parseFloat(getComputedStyle(e).paddingLeft)-r.width,bottomGap:e.clientHeight-r.height};
});
const filled=async(page,surface)=>{
  try {
  await surface.evaluate(e=>{delete e.__qaAutomaticFillStable;});
  await page.waitForFunction(e=>{
    if(!(e.dataset.gridAuthority==='server' && e.dataset.rendererReady==='true' && +e.dataset.outputBatches>0 && e.dataset.sharedCols===e.dataset.requestedCols && e.dataset.sharedRows===e.dataset.requestedRows)) {
      delete e.__qaAutomaticFillStable; return false;
    }
    const r=e.querySelector('.xterm-screen').getBoundingClientRect(),width=e.clientWidth-parseFloat(getComputedStyle(e).paddingLeft);
    if(!(width-r.width>=-1 && width-r.width<r.width/Number(e.dataset.sharedCols)+1 && e.clientHeight-r.height>=-1 && e.clientHeight-r.height<r.height/Number(e.dataset.sharedRows)+1)) {
      delete e.__qaAutomaticFillStable; return false;
    }
    // A peer's queued announcement can follow a momentarily matching cached
    // grid. Require sustained rendered readiness, not one matching RAF.
    const key=[e.dataset.sharedCols,e.dataset.sharedRows,width,e.clientHeight,r.width,r.height].join(':');
    if(e.__qaAutomaticFillStable?.key!==key) { e.__qaAutomaticFillStable={key,since:performance.now()}; return false; }
    return performance.now()-e.__qaAutomaticFillStable.since>=500;
  },await surface.elementHandle());
  assert.equal(await page.locator('.terminal-fit-button').count(),0);
  const m=await measure(surface); assert.equal(m.font,16); return m;
  } catch(error) {
    console.log('FAIL automatic fit state',JSON.stringify(await surface.evaluate(e=>({dataset:{...e.dataset},focus:document.hasFocus(),visibility:document.visibilityState,rect:e.getBoundingClientRect().toJSON()}))));
    await surface.screenshot({path:`${output}/failure.png`});
    throw error;
  }
};
try {
  const large=await open(3440,1440),small=await open(1920,1080);
  for(const phase of ['fresh','normal','hard']) {
    assert.equal(health().version,candidate.version,'Candidate changed during automatic-fit verification');
    if(phase!=='fresh') {
      if(phase==='hard') for(const client of [large,small]) {
        const cdp=await client.context.newCDPSession(client.page); await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
      }
      await large.page.bringToFront(); await large.page.reload();
      await realFocus(large);
      await small.page.bringToFront(); await small.page.reload();
      await realFocus(small);
    }
    for(const n of [3,6,7]) {
      await large.page.bringToFront(); let big=await panel(large.page,n);
      await large.page.waitForFunction(()=>document.hasFocus());
      await small.page.waitForFunction(()=>!document.hasFocus());
      const first=await filled(large.page,big);
      await big.screenshot({path:`${output}/${phase}-panel${n}-big.png`});
      await small.page.bringToFront(); let peer=await panel(small.page,n);
      const second=await filled(small.page,peer);
      // The focused page alone changes size; passive render updates must settle.
      for(let i=0;i<3;i++) {
        await large.page.bringToFront(); await filled(large.page,big);
        await small.page.bringToFront(); await filled(small.page,peer);
      }
      await large.page.bringToFront(); await filled(large.page,big);
      const before=await measure(big);
      await small.page.setViewportSize({width:2860,height:988});
      await large.page.waitForTimeout(1000);
      const after=await measure(big);
      if(after.cols!==before.cols || after.rows!==before.rows) {
        const detail={phase,panel:n,before,after,largeFocus:await large.page.evaluate(()=>document.hasFocus()),smallFocus:await small.page.evaluate(()=>document.hasFocus()),events};
        console.log('Background control mismatch',JSON.stringify({...detail,events:events.slice(-30)}));
        await writeFile(`${output}/background-mismatch.json`,JSON.stringify(detail,null,2));
      }
      assert.equal(after.cols,before.cols,'background resize stole columns');
      assert.equal(after.rows,before.rows,'background resize stole rows');
      assert.equal(after.font,before.font,'background resize changed local font');
      await small.page.bringToFront(); const resized=await filled(small.page,peer);
      await small.page.waitForTimeout(1000);
      assert.deepEqual(await measure(peer),resized,'inactive peer caused repeated size changes');
      await peer.screenshot({path:`${output}/${phase}-panel${n}-resized-peer.png`});
      await small.page.setViewportSize({width:1920,height:1080});
      // Responsive reflow can move lower panels below the viewport. The
      // product intentionally activates only intersecting surfaces: bring the
      // target back into view before asserting foreground-controller fill.
      // This is a page scroll, not terminal input or a manual Fit action.
      const restoreWasOffscreen=await peer.evaluate(e=>{const r=e.getBoundingClientRect(); return r.top>=innerHeight || r.bottom<=0;});
      await peer.scrollIntoViewIfNeeded();
      await small.page.waitForFunction(e=>{const r=e.getBoundingClientRect(); return r.top<innerHeight && r.bottom>0;},await peer.elementHandle());
      const restored=await filled(small.page,peer);
      results.push({phase,panel:n,first,second,resized,restored,restoreWasOffscreen,focusCycles:3});
      console.log('PASS',phase,n,'automatic open/focus/resize and passive mirror');
    }
  }
  assert.equal(health().version,candidate.version);
  assert.deepEqual(errors,[]); status='PASS';
} finally {
  await browser.close();
  await writeFile(`${output}/results.json`,JSON.stringify({candidate,status,results,errors,events},null,2));
}
