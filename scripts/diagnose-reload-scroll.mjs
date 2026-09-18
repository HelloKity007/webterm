import { chromium } from '../ui/node_modules/playwright/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const output = process.env.WEBTERM_QA_OUTPUT || 'runtime/reload-scroll-diagnostic';
await mkdir(output, {recursive:true});
const browser = await chromium.launch({headless:true});
const results=[];
try {
 for (const number of [2,14]) {
  const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1920,height:1080}});
  const page=await context.newPage();
  const controls=[];
  page.on('websocket', ws=>ws.on('framesent',({payload})=>{
   try {const value=JSON.parse(payload);if(value.data==='\u0012')controls.push({ctrlR:true});} catch {}
  }));
  await page.goto('https://192.168.11.87:9444',{waitUntil:'networkidle'});
  const tab=page.locator('[data-tab-id]').filter({hasText:new RegExp(`^${number}:`)}).first();
  await tab.click();
  const surface=tab.locator('xpath=ancestor::*[contains(@class,"terminal-grid-cell")]').locator('.terminal-surface:visible');
  await surface.hover();
  await surface.locator('textarea').evaluate(e=>e.focus({preventScroll:true}));
  for(let i=0;i<Number(process.env.WEBTERM_QA_WHEELS || 27);i++){await page.mouse.wheel(0,-120);await page.waitForTimeout(80);}
  await page.waitForTimeout(2500);
  const state=()=>surface.evaluate(e=>{
   const bar=e.querySelector('.scrollbar.vertical'),slider=bar?.firstElementChild;
   const b=bar?.getBoundingClientRect(),s=slider?.getBoundingClientRect();
   return {outerTop:e.scrollTop,mode:e.dataset.terminalMode,sliderTop:s&&b?s.top-b.top:null,travel:s&&b?b.height-s.height:null,storage:Object.fromEntries(Object.entries(sessionStorage).filter(([k])=>/history/i.test(k)))};
  });
  const before=await state();
  await surface.screenshot({path:`${output}/${number}-before.png`});
  await surface.locator('textarea').evaluate(e=>{
   e.focus({preventScroll:true});
   for(const [key,code,keyCode,ctrlKey,shiftKey] of [['Control','ControlLeft',17,true,false],['Shift','ShiftLeft',16,true,true],['R','KeyR',82,true,true]])
    e.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key,code,keyCode,which:keyCode,ctrlKey,shiftKey}));
  });
  await page.waitForTimeout(500);
  const afterKeys=await state();
  await surface.screenshot({path:`${output}/${number}-keys.png`});
  const cdp=await context.newCDPSession(page);
  await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
  await page.reload({waitUntil:'networkidle'});
  await page.waitForTimeout(2500);
  const afterReload=await state();
  await surface.screenshot({path:`${output}/${number}-reload.png`});
  results.push({number,before,afterKeys,afterReload,controls});
  assert(before.sliderTop < before.travel, `Panel ${number}: fixture must be reading history`);
  for(const [phase,value] of [['keys',afterKeys],['reload',afterReload]]) {
   assert.equal(value.outerTop,before.outerTop,`Panel ${number}: outer viewport moved after ${phase}`);
   assert.equal(value.sliderTop,before.sliderTop,`Panel ${number}: history moved after ${phase}`);
  }
  assert.equal(controls.length,0,`Panel ${number}: reload sent Ctrl+R to terminal`);
  await context.close();
 }
} finally {await browser.close();await writeFile(`${output}/results.json`,JSON.stringify(results,null,2));}
console.log(JSON.stringify(results));
