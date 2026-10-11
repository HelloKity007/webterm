import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const { chromium } = createRequire(import.meta.url)('../ui/node_modules/playwright');
const origin = process.env.WEBTERM_QA_URL || 'https://192.168.11.87:9444';
const health=()=>JSON.parse(execFileSync('curl',['-ks',`${origin}/api/health`],{encoding:'utf8'}));
const candidate=health(); assert.equal(candidate.environment,'release-test');
const output = process.env.WEBTERM_QA_OUTPUT || 'runtime/geometry-20260929/browser';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: false, args: ['--no-sandbox'] });
const results = [];
const events = [];
const phases=(process.env.WEBTERM_QA_GEOMETRY_PHASES || 'fresh,normal,hard').split(',');
const panels=(process.env.WEBTERM_QA_GEOMETRY_PANELS || '3,6,7').split(',').map(Number);
assert(phases.length && phases.every(p=>['fresh','normal','hard'].includes(p)));
assert(panels.length && panels.every(p=>[3,6,7].includes(p)));
const errors = [];
let status = 'FAIL';
const open = async (width, height) => {
  const context = await browser.newContext({ viewport: { width, height }, ignoreHTTPSErrors: true, recordVideo: { dir: output, size: { width: 1280, height: 720 } } });
  const page = await context.newPage();
  page.on('websocket',ws=>{
    if(!ws.url().includes('/ws/ssh/'))return;
    const id=new URL(ws.url()).searchParams.get('terminal_id');
    ws.on('framesent',({payload})=>{try{const m=JSON.parse(String(payload));if(m.cols || m.action==='take_size_control')events.push({time:Date.now(),width,id,send:m});}catch{}});
    ws.on('framereceived',({payload})=>{try{const m=JSON.parse(String(payload));if(m.type==='error')events.push({time:Date.now(),width,id,error:m.code}); if(!m.data)return;const data=m.b64?Buffer.from(m.data,'base64').toString():m.data;const grids=[...data.matchAll(/webterm-grid:(\d+)x(\d+)/g)].map(m=>m[1]+'x'+m[2]);events.push({time:Date.now(),width,id,receive:{grids,length:data.length,snapshot:data.includes('\x1b[2J') && data.startsWith('\x1b]2;webterm-grid:')}});}catch{}});
  });
  const cdp=await context.newCDPSession(page);
  await cdp.send('Emulation.setFocusEmulationEnabled',{enabled:false});
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin);
  await cdp.send('Emulation.setFocusEmulationEnabled',{enabled:false});
  await page.locator('.terminal-surface:visible').first().waitFor({ timeout: 30000 });
  return { page, context };
};
const panel = async (page, n, passive = false) => {
  const tab = page.locator('[data-tab-id]').filter({ hasText: new RegExp(`^${n}:`) }).first();
  if (passive) await page.waitForFunction(e => e.dataset.active === 'true', await tab.elementHandle());
  else await tab.click();
  const surface = tab.locator('xpath=ancestor::*[contains(@class,"terminal-grid-cell")]').locator('.terminal-surface:visible');
  if (!passive) await surface.scrollIntoViewIfNeeded();
  try {
    await page.waitForFunction(el => el.dataset.gridAuthority === 'server' && el.dataset.scrollOwner === 'surface' && Number(el.dataset.outputBatches) > 0 && el.dataset.terminalMode && el.dataset.rendererReady === 'true', await surface.elementHandle());
  } catch(error) {
    const id=await tab.getAttribute('data-tab-id');
    const failure=await surface.evaluate(el=>({dataset:{...el.dataset},rect:el.getBoundingClientRect().toJSON(),focus:document.hasFocus(),viewport:{width:innerWidth,height:innerHeight}}));
    console.log('Panel readiness failed',JSON.stringify({panel:n,passive,id,failure,events:events.filter(e=>e.id===id).slice(-20)}));
    await writeFile(`${output}/panel-readiness-failure.json`,JSON.stringify({candidate,panel:n,passive,id,failure,events:events.filter(e=>e.id===id)},null,2));
    await surface.screenshot({path:`${output}/panel-readiness-failure.png`});
    throw error;
  }
  return surface;
};
const measure = surface => surface.evaluate(e => {
  const screen = e.querySelector('.xterm-screen').getBoundingClientRect();
  const box = e.getBoundingClientRect();
  const style = getComputedStyle(e);
  return { cols: +e.dataset.sharedCols, rows: +e.dataset.sharedRows, requestedCols: +e.dataset.requestedCols, requestedRows: +e.dataset.requestedRows,
    font: +e.dataset.fittedFontSize, width: e.clientWidth, height: e.clientHeight,
    rightGap: e.clientWidth - parseFloat(style.paddingLeft) - screen.width,
    bottomGap: e.clientHeight - screen.height,
    screenTop: screen.top - box.top, screenHeight: screen.height,
    verticalRails: [...e.querySelectorAll('.scrollbar.vertical')].filter(el => getComputedStyle(el).display !== 'none').length,
    scrollTop: e.scrollTop, scrollHeight: e.scrollHeight, scrollWidth: e.scrollWidth, mode: e.dataset.terminalMode };
});
const takeControl = async (page, surface) => {
  await page.bringToFront();
  await surface.locator('.xterm-helper-textarea').focus();
  await page.keyboard.press('Shift'); // ordinary input activation; no draft text
  assert.equal(await page.locator('.terminal-fit-button').count(),0,'Fit must be automatic, without a persistent button');
  await page.waitForFunction(e => e.dataset.sharedCols === e.dataset.requestedCols && e.dataset.sharedRows === e.dataset.requestedRows, await surface.elementHandle());
  // Require rendered dimensions to match their advertised grid too.
  await page.waitForFunction(e => {
    const r=e.querySelector('.xterm-screen').getBoundingClientRect();
    const width=e.clientWidth-parseFloat(getComputedStyle(e).paddingLeft);
    return r.width<=width+1 && r.height<=e.clientHeight+1 && width-r.width<r.width/Number(e.dataset.sharedCols)+1 && e.clientHeight-r.height<r.height/Number(e.dataset.sharedRows)+1;
  }, await surface.elementHandle());
};
try {
  const big = await open(3440, 1440);
  for (const phase of phases) {
    assert.equal(health().version,candidate.version,'Candidate changed during geometry verification');
    if (phase !== 'fresh') {
      if (phase === 'hard') { const cdp = await big.context.newCDPSession(big.page); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }); }
      await big.page.reload();
      const focusCDP=await big.context.newCDPSession(big.page);
      await focusCDP.send('Emulation.setFocusEmulationEnabled',{enabled:false});
      await big.page.locator('.terminal-surface:visible').first().waitFor();
    }
    for (const n of panels) {
      const surface = await panel(big.page, n);
      await takeControl(big.page, surface);
      const before = await measure(surface);
      results.push({ phase, panel: n, event: 'big-controller', ...before });
      console.log(phase, n, 'controller', before.cols, before.rows, before.rightGap, before.bottomGap);
      assert.equal(before.verticalRails, 0, 'duplicate xterm rail');
      assert(before.rightGap >= -1 && before.rightGap < 16, `large grid does not fill width: ${JSON.stringify(before)}`);
      assert(before.bottomGap >= -1 && before.bottomGap < 24, `large grid does not fill height: ${JSON.stringify(before)}`);
      await surface.screenshot({ path: `${output}/${phase}-panel${n}-big.png` });
      for (const [width,height] of [[1920,1080],[2860,988]]) {
        const small = await open(width,height);
        let peer = await panel(small.page,n);
        await small.page.waitForFunction((e) => +e.dataset.sharedCols > 0, await peer.elementHandle());
        const after = await measure(surface);
        const peerBefore = await measure(peer);
        results.push({ phase, panel:n, event:`peer-${width}`, ...peerBefore });
        assert.equal(after.font,before.font,'peer shrank controller font');
        // Opening an active foreground peer now automatically transfers size.
        // Background controllers retain their font and do not fight that user.
        await takeControl(small.page,peer);
        const peerAfter=await measure(peer);
        assert.equal(peerAfter.font,peerBefore.font,'takeover changed local font');
        assert.equal((await measure(surface)).font,before.font,'takeover shrank mirror font');
        await small.page.waitForTimeout(800);
        assert.equal((await measure(peer)).cols,peerAfter.cols,'background mirror reclaimed dimensions');
        assert.equal((await measure(peer)).rows,peerAfter.rows,'background mirror reclaimed rows');
        await peer.screenshot({path:`${output}/${phase}-panel${n}-${width}.png`});
        if (phase !== 'fresh') {
          if (phase === 'hard') { const cdp=await small.context.newCDPSession(small.page); await cdp.send('Network.setCacheDisabled',{cacheDisabled:true}); }
          await small.page.reload();
          const smallFocusCDP=await small.context.newCDPSession(small.page);
          await smallFocusCDP.send('Emulation.setFocusEmulationEnabled',{enabled:false});
          peer=await panel(small.page,n);
          const controllerInitial=await measure(peer);
          console.log(phase,n,'reload initial',JSON.stringify(controllerInitial));
          await small.page.waitForFunction(({e,cols,rows}) => +e.dataset.sharedCols===cols && +e.dataset.sharedRows===rows && +e.dataset.requestedCols===cols && +e.dataset.requestedRows===rows,
            {e:await peer.elementHandle(),cols:peerAfter.cols,rows:peerAfter.rows});
          const restored=await measure(peer);
          assert.equal(restored.font,peerAfter.font,'controller reload changed its font');
          assert.equal(restored.cols,peerAfter.cols,'controller reload lost its dimensions');
          // Refresh the inactive mirror while the controller stays foreground.
          await small.page.bringToFront();
          await big.page.reload();
          const bigFocusCDP=await big.context.newCDPSession(big.page);
          await bigFocusCDP.send('Emulation.setFocusEmulationEnabled',{enabled:false});
          await panel(big.page,n,true);
          await big.page.waitForFunction(()=>!document.hasFocus());
          await small.page.waitForFunction(()=>document.hasFocus());
          try {
            await big.page.waitForFunction(({e,cols,rows}) => +e.dataset.sharedCols===cols && +e.dataset.sharedRows===rows,
              {e:await surface.elementHandle(),cols:peerAfter.cols,rows:peerAfter.rows});
          } catch(error) {
            console.log('mirror reload failure',JSON.stringify({mirror:await measure(surface),controller:await measure(peer),bigFocus:await big.page.evaluate(()=>document.hasFocus()),smallFocus:await small.page.evaluate(()=>document.hasFocus())}));
            await surface.screenshot({path:`${output}/${phase}-panel${n}-mirror-failure.png`});
            throw error;
          }
          const mirror=await measure(surface);
          assert.equal(mirror.cols,peerAfter.cols,'mirror reload stole size control');
          assert.equal(mirror.font,before.font,'mirror reload changed its font');
          results.push({phase,panel:n,event:`dual-reload-${width}`,controllerInitial,controller:restored,mirror});
        }
        await small.context.close();
        await takeControl(big.page,surface);
      }
      for(let i=0;i<5;i++) {
        await surface.hover();
        await big.page.mouse.wheel(0,-480);
        await surface.screenshot({path:`${output}/${phase}-panel${n}-history${i}.png`});
        await big.page.mouse.wheel(0,480);
      }
    }
  }
  await big.context.close();
  assert.equal(health().version,candidate.version);
  assert.deepEqual(errors,[]);
  status = 'PASS';
} finally {
  await writeFile(`${output}/results.json`,JSON.stringify({candidate,phases,panels,scope:phases.length===3 && panels.length===3?'full matrix':'selected diagnosis only',status,results,errors,events},null,2));
  await browser.close();
}
console.log('PASS: geometry, single rail, peer ownership, takeover and refresh');
