import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require('../ui/node_modules/playwright');
const output = process.env.WEBTERM_QA_OUTPUT || 'runtime/terminal-grid-diagnosis';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath:'/usr/bin/google-chrome',headless:false,args:['--no-sandbox'] });
try {
 const page = await browser.newPage({viewport:{width:1920,height:1080},ignoreHTTPSErrors:true});
 await page.goto('https://192.168.11.87:9444/',{waitUntil:'networkidle'});
 const panels=page.locator('.terminal-surface:visible');
 await panels.nth(5).waitFor();
 await page.waitForTimeout(3000);
 const shell=await panels.nth(1).evaluate(e=>({...e.dataset}));
 const frames=await page.evaluate(async()=>{
   const grid=document.querySelector('.terminal-grid');
   const panel=Array.from(document.querySelectorAll('.terminal-surface')).filter(e=>e.offsetWidth>0)[5];
   const samples=[];
   for(let round=0;round<3;round++) {
     grid.scrollTop=0;
     await new Promise(r=>setTimeout(r,300));
     panel.scrollIntoView({block:'center'});
     for(let i=0;i<90;i++) {
       await new Promise(requestAnimationFrame);
       const rect=panel.querySelector('.xterm-screen').getBoundingClientRect();
       samples.push({round,width:rect.width,height:rect.height,font:panel.dataset.fittedFontSize,rows:panel.dataset.sharedRows});
     }
   }
   return samples;
 });
 await panels.nth(5).screenshot({path:`${output}/claude.png`});
 await writeFile(`${output}/frames.json`,JSON.stringify({shell,frames},null,2));
 console.log(JSON.stringify({shell,uniqueSizes:[...new Set(frames.map(f=>`${f.width}x${f.height}`))]}));
} finally { await browser.close(); }
